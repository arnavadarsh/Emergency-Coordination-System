import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital, HospitalCapability } from './entities';
import { UpdateCapabilityDto } from './dto';
import { BookingStatus, HospitalCapability as CapabilityType, HospitalStatus, SeverityLevel } from '../common/enums';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { HospitalRankingService } from './hospital-ranking.service';
import { AuditService } from '../audit/audit.service';

/**
 * Hospitals Service
 * Hospital management with status updates
 */
@Injectable()
export class HospitalsService implements OnModuleInit {
  private readonly logger = new Logger(HospitalsService.name);
  private readonly pendingRerouteRetries = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(Hospital)
    private hospitalRepository: Repository<Hospital>,
    @InjectRepository(HospitalCapability)
    private capabilityRepository: Repository<HospitalCapability>,
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly hospitalRankingService: HospitalRankingService,
    private readonly auditService: AuditService,
  ) {}

  private isHospitalAccepting(status?: string): boolean {
    const normalized = (status || '').toUpperCase();
    return normalized === 'ACTIVE' || normalized === 'ACCEPTING';
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private estimateTravelMinutes(fromLat: number, fromLng: number, hospital: Hospital): number {
    const distanceKm = this.calculateDistance(fromLat, fromLng, Number(hospital.latitude), Number(hospital.longitude));
    return Math.max(1, Math.round(distanceKm * 3));
  }

  private resolveEmergencyType(booking: Booking): string | null {
    return (booking as any).triageReport?.emergencyType ?? null;
  }

  private resolveRequiredCapability(booking: Booking): CapabilityType | null {
    const emergencyType = this.resolveEmergencyType(booking)?.toLowerCase() ?? '';
    if (!emergencyType) return null;

    const matches: Array<[string, CapabilityType]> = [
      ['cardiac', CapabilityType.CARDIAC],
      ['heart', CapabilityType.CARDIAC],
      ['chest', CapabilityType.CARDIAC],
      ['trauma', CapabilityType.TRAUMA],
      ['accident', CapabilityType.TRAUMA],
      ['injury', CapabilityType.TRAUMA],
      ['neuro', CapabilityType.NEURO],
      ['stroke', CapabilityType.NEURO],
      ['seizure', CapabilityType.NEURO],
      ['pregnancy', CapabilityType.OB],
      ['obstetric', CapabilityType.OB],
      ['maternity', CapabilityType.OB],
    ];

    return matches.find(([keyword]) => emergencyType.includes(keyword))?.[1] ?? null;
  }

  private capabilityCanAccept(hospital: Hospital, capabilityType: CapabilityType): boolean {
    const capability = (hospital.capabilities ?? []).find(cap => cap.capabilityType === capabilityType);
    if (!capability) return false;
    if (capability.status !== 'ACCEPTING') return false;
    if (capability.capacity > 0 && capability.currentLoad >= capability.capacity) return false;
    return true;
  }

  private isDuplicateHospital(candidate: Hospital, closedHospital: Hospital): boolean {
    const candidateName = (candidate.name || '').trim().toLowerCase();
    const closedName = (closedHospital.name || '').trim().toLowerCase();
    const candidateLat = Number(candidate.latitude);
    const candidateLng = Number(candidate.longitude);
    const closedLat = Number(closedHospital.latitude);
    const closedLng = Number(closedHospital.longitude);

    if (candidate.id === closedHospital.id) return true;
    if (candidateName && candidateName === closedName) return true;
    return (
      Number.isFinite(candidateLat) &&
      Number.isFinite(candidateLng) &&
      Number.isFinite(closedLat) &&
      Number.isFinite(closedLng) &&
      Math.abs(candidateLat - closedLat) < 0.0001 &&
      Math.abs(candidateLng - closedLng) < 0.0001
    );
  }

  private async findBestRerouteHospital(
    dispatch: Dispatch,
    closedHospital: Hospital,
  ): Promise<{ hospital: Hospital; rankedHospitalIds: string[]; etaMinutes: number } | null> {
    const booking = dispatch.booking;
    if (!booking) return null;

    const sourceLat = Number(dispatch.ambulance?.currentLatitude ?? booking.pickupLatitude ?? closedHospital.latitude);
    const sourceLng = Number(dispatch.ambulance?.currentLongitude ?? booking.pickupLongitude ?? closedHospital.longitude);
    const requiredCapability = this.resolveRequiredCapability(booking);

    const hospitals = await this.hospitalRepository.find({ relations: ['capabilities'] });
    const eligibleHospitals = hospitals.filter(hospital => {
      if (this.isDuplicateHospital(hospital, closedHospital)) return false;
      if (!this.isHospitalAccepting(hospital.status as any)) return false;
      if ((hospital.availableBeds ?? 0) <= 0) return false;
      if (requiredCapability && !this.capabilityCanAccept(hospital, requiredCapability)) return false;
      return true;
    });

    const ranking = this.hospitalRankingService.selectBest(eligibleHospitals, {
      pickupLatitude: sourceLat,
      pickupLongitude: sourceLng,
      severity: booking.severity as SeverityLevel | undefined,
      emergencyType: this.resolveEmergencyType(booking),
    });

    if (!ranking?.best) return null;

    return {
      hospital: ranking.best,
      rankedHospitalIds: ranking.rankedList.map(score => score.hospital.id),
      etaMinutes: this.estimateTravelMinutes(sourceLat, sourceLng, ranking.best),
    };
  }

  private buildReroutePayload(data: {
    dispatch: Dispatch;
    booking: Booking;
    oldHospital: Hospital;
    newHospital?: Hospital;
    reason: string;
    etaMinutes?: number | null;
    rankedHospitalIds?: string[];
  }) {
    const { dispatch, booking, oldHospital, newHospital, reason, etaMinutes, rankedHospitalIds } = data;
    return {
      dispatchId: dispatch.id,
      bookingId: booking.id,
      ambulanceId: dispatch.ambulanceId,
      userId: booking.userId,
      reason,
      message: newHospital
        ? `Assigned hospital is currently unable to accept the patient. Reassigned from ${oldHospital.name} to ${newHospital.name}.`
        : 'Assigned hospital is currently unable to accept the patient. Searching for the next best hospital.',
      oldHospital: {
        id: oldHospital.id,
        name: oldHospital.name,
        address: oldHospital.address,
        latitude: Number(oldHospital.latitude),
        longitude: Number(oldHospital.longitude),
      },
      newHospital: newHospital ? {
        id: newHospital.id,
        name: newHospital.name,
        address: newHospital.address,
        latitude: Number(newHospital.latitude),
        longitude: Number(newHospital.longitude),
        phoneNumber: newHospital.phoneNumber,
      } : null,
      etaMinutes: etaMinutes ?? null,
      rankedHospitalIds: rankedHospitalIds ?? [],
      timestamp: new Date().toISOString(),
    };
  }

  private emitRerouteEvent(
    event: string,
    payload: any,
    _oldHospitalId?: string,
    _newHospitalId?: string,
  ): void {
    this.realtimeGateway.server.emit(event, payload);
  }

  private async logReroute(data: {
    dispatch: Dispatch;
    reason: string;
    oldHospital: Hospital;
    newHospital?: Hospital | null;
    status: 'COMPLETED' | 'ESCALATED';
    etaMinutes?: number | null;
  }): Promise<void> {
    await this.auditService.log({
      entityType: 'DISPATCH',
      entityId: data.dispatch.id,
      action: data.status === 'COMPLETED' ? 'HOSPITAL_REROUTE' : 'HOSPITAL_REROUTE_ESCALATED',
      changes: {
        reason: data.reason,
        oldHospitalId: data.oldHospital.id,
        oldHospitalName: data.oldHospital.name,
        newHospitalId: data.newHospital?.id ?? null,
        newHospitalName: data.newHospital?.name ?? null,
        etaMinutes: data.etaMinutes ?? null,
      },
      beforeState: { hospitalId: data.oldHospital.id },
      afterState: { hospitalId: data.newHospital?.id ?? null },
    });
  }

  private scheduleRerouteRetry(dispatchId: string, hospitalId: string, reason: string): void {
    if (this.pendingRerouteRetries.has(dispatchId)) return;

    const timeout = setTimeout(async () => {
      this.pendingRerouteRetries.delete(dispatchId);
      try {
        const hospital = await this.findById(hospitalId);
        if (hospital) {
          await this.rerouteDispatchesForHospital(hospital, reason, dispatchId);
        }
      } catch (error) {
        this.logger.error(`Reroute retry failed for dispatch ${dispatchId}`, (error as Error).stack);
      }
    }, 60_000);

    this.pendingRerouteRetries.set(dispatchId, timeout);
  }

  private async rerouteDispatchesForHospital(
    closedHospital: Hospital,
    reason: string,
    dispatchId?: string,
  ): Promise<void> {
    const activeStatuses = ['DISPATCHED', 'ASSIGNED', 'EN_ROUTE', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_HOSPITAL', 'AT_HOSPITAL'];

    const dispatches = await this.dispatchRepository.find({
      where: dispatchId ? { id: dispatchId } : undefined,
      relations: ['booking', 'hospital', 'ambulance'],
    });

    for (const dispatch of dispatches) {
      if (!activeStatuses.includes(dispatch.status)) continue;
      if (!dispatch.booking) continue;

      const destinationMatchesClosedHospital =
        dispatch.hospitalId === closedHospital.id ||
        dispatch.booking.destinationAddress === closedHospital.name ||
        (
          dispatch.booking.destinationLatitude != null &&
          dispatch.booking.destinationLongitude != null &&
          Math.abs(Number(dispatch.booking.destinationLatitude) - Number(closedHospital.latitude)) < 0.0001 &&
          Math.abs(Number(dispatch.booking.destinationLongitude) - Number(closedHospital.longitude)) < 0.0001
        );

      if (!destinationMatchesClosedHospital) continue;

      const searchPayload = this.buildReroutePayload({
        dispatch,
        booking: dispatch.booking,
        oldHospital: closedHospital,
        reason,
      });
      this.emitRerouteEvent('hospital_reroute_search_started', searchPayload, closedHospital.id);

      const reroute = await this.findBestRerouteHospital(dispatch, closedHospital);
      if (!reroute) {
        const escalationPayload = this.buildReroutePayload({
          dispatch,
          booking: dispatch.booking,
          oldHospital: closedHospital,
          reason,
        });
        this.emitRerouteEvent('hospital_reroute_escalated', escalationPayload, closedHospital.id);
        await this.logReroute({
          dispatch,
          oldHospital: closedHospital,
          reason,
          status: 'ESCALATED',
        });
        this.scheduleRerouteRetry(dispatch.id, closedHospital.id, reason);
        continue;
      }

      dispatch.hospitalId = reroute.hospital.id;
      dispatch.hospital = reroute.hospital;
      dispatch.estimatedHospitalTime = reroute.etaMinutes;
      await this.dispatchRepository.save(dispatch);

      const booking = dispatch.booking;
      booking.destinationAddress = reroute.hospital.name;
      booking.destinationLatitude = Number(reroute.hospital.latitude);
      booking.destinationLongitude = Number(reroute.hospital.longitude);
      await this.bookingRepository.save(booking);

      const payload = this.buildReroutePayload({
        dispatch,
        booking,
        oldHospital: closedHospital,
        newHospital: reroute.hospital,
        reason,
        etaMinutes: reroute.etaMinutes,
        rankedHospitalIds: reroute.rankedHospitalIds,
      });

      const pendingRetry = this.pendingRerouteRetries.get(dispatch.id);
      if (pendingRetry) clearTimeout(pendingRetry);
      this.pendingRerouteRetries.delete(dispatch.id);
      this.emitRerouteEvent('dispatch_diverted', payload, closedHospital.id, reroute.hospital.id);
      this.emitRerouteEvent('hospital_reroute_completed', payload, closedHospital.id, reroute.hospital.id);

      this.realtimeGateway.server.emit('dispatch_status_updated', {
        dispatchId: dispatch.id,
        bookingId: booking.id,
        ambulanceId: dispatch.ambulanceId,
        hospitalId: reroute.hospital.id,
        hospitalName: reroute.hospital.name,
        status: dispatch.status,
        estimatedHospitalTime: dispatch.estimatedHospitalTime,
      });

      this.realtimeGateway.emitToHospital(reroute.hospital.id, 'pre_arrival_alert', {
        dispatchId: dispatch.id,
        bookingId: booking.id,
        ambulanceId: dispatch.ambulanceId,
        ambulanceVehicleNumber: dispatch.ambulance?.vehicleNumber ?? 'N/A',
        ambulanceLocation: {
          latitude: dispatch.ambulance?.currentLatitude ?? null,
          longitude: dispatch.ambulance?.currentLongitude ?? null,
        },
        patientSeverity: booking.severity ?? 'MEDIUM',
        emergencyType: this.resolveEmergencyType(booking),
        triage: null,
        etaMinutes: reroute.etaMinutes,
        status: dispatch.status,
        alertedAt: new Date().toISOString(),
      });

      await this.logReroute({
        dispatch,
        oldHospital: closedHospital,
        newHospital: reroute.hospital,
        reason,
        etaMinutes: reroute.etaMinutes,
        status: 'COMPLETED',
      });
    }
  }

  private async findNearestAlternativeHospital(
    latitude: number,
    longitude: number,
    closedHospital: Hospital,
  ): Promise<Hospital | null> {
    const hospitals = await this.hospitalRepository.find();

    let nearest: Hospital | null = null;
    let minDistance = Number.MAX_VALUE;

    const closedName = (closedHospital.name || '').trim().toLowerCase();
    const closedLat = Number(closedHospital.latitude);
    const closedLng = Number(closedHospital.longitude);

    for (const hospital of hospitals) {
      const candidateName = (hospital.name || '').trim().toLowerCase();
      const candidateLat = Number(hospital.latitude);
      const candidateLng = Number(hospital.longitude);

      // Exclude the same hospital record and any duplicate clone of the same hospital.
      if (hospital.id === closedHospital.id) continue;
      if (candidateName && candidateName === closedName) continue;
      if (
        Number.isFinite(candidateLat) &&
        Number.isFinite(candidateLng) &&
        Number.isFinite(closedLat) &&
        Number.isFinite(closedLng) &&
        Math.abs(candidateLat - closedLat) < 0.0001 &&
        Math.abs(candidateLng - closedLng) < 0.0001
      ) {
        continue;
      }
      if ((hospital.availableBeds || 0) <= 0) continue;
      if (!this.isHospitalAccepting(hospital.status as any)) continue;

      const distance = this.calculateDistance(
        latitude,
        longitude,
        Number(hospital.latitude),
        Number(hospital.longitude),
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearest = hospital;
      }
    }

    return nearest;
  }

  private async divertInFlightDispatches(closedHospital: Hospital): Promise<void> {
    const activeStatuses = ['AT_PICKUP', 'EN_ROUTE_HOSPITAL'];

    const dispatches = await this.dispatchRepository.find({
      relations: ['booking', 'hospital'],
    });

    for (const dispatch of dispatches) {
      if (!activeStatuses.includes(dispatch.status)) continue;
      if (!dispatch.booking) continue;

      const destinationMatchesClosedHospital =
        dispatch.hospitalId === closedHospital.id ||
        dispatch.booking.destinationAddress === closedHospital.name ||
        (
          dispatch.booking.destinationLatitude != null &&
          dispatch.booking.destinationLongitude != null &&
          Number(dispatch.booking.destinationLatitude) === Number(closedHospital.latitude) &&
          Number(dispatch.booking.destinationLongitude) === Number(closedHospital.longitude)
        );

      if (!destinationMatchesClosedHospital) continue;

      const sourceLat = dispatch.booking.pickupLatitude || Number(closedHospital.latitude);
      const sourceLng = dispatch.booking.pickupLongitude || Number(closedHospital.longitude);
      const alternative = await this.findNearestAlternativeHospital(sourceLat, sourceLng, closedHospital);
      if (!alternative) continue;

      dispatch.hospitalId = alternative.id;
      await this.dispatchRepository.save(dispatch);

      const booking = dispatch.booking;
      booking.destinationAddress = alternative.name;
      booking.destinationLatitude = Number(alternative.latitude);
      booking.destinationLongitude = Number(alternative.longitude);
      await this.bookingRepository.save(booking);

      this.realtimeGateway.server.emit('dispatch_diverted', {
        dispatchId: dispatch.id,
        bookingId: booking.id,
        userId: booking.userId,
        oldHospital: {
          id: closedHospital.id,
          name: closedHospital.name,
        },
        newHospital: {
          id: alternative.id,
          name: alternative.name,
          address: alternative.address,
          latitude: Number(alternative.latitude),
          longitude: Number(alternative.longitude),
        },
        reason: 'Hospital stopped accepting patients',
        message: `Destination changed from ${closedHospital.name} to ${alternative.name}`,
      });

      this.realtimeGateway.server.emit('dispatch_status_updated', {
        dispatchId: dispatch.id,
        bookingId: booking.id,
        ambulanceId: dispatch.ambulanceId,
        status: dispatch.status,
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.ensureDelhiHospitals();
  }

  private async ensureDelhiHospitals(): Promise<void> {
    const seedHospitals = [
      {
        name: 'AIIMS New Delhi',
        address: 'Sri Aurobindo Marg, Ansari Nagar, New Delhi',
        phoneNumber: '+91-11-26588500',
        email: 'er@aiims.edu',
        latitude: 28.5672,
        longitude: 77.2100,
        totalBeds: 2200,
        availableBeds: 240,
      },
      {
        name: 'Safdarjung Hospital',
        address: 'Ansari Nagar West, New Delhi',
        phoneNumber: '+91-11-26730000',
        email: 'emergency@safdarjung.in',
        latitude: 28.5706,
        longitude: 77.2078,
        totalBeds: 1600,
        availableBeds: 180,
      },
      {
        name: 'RML Hospital',
        address: 'Baba Kharak Singh Marg, Connaught Place, New Delhi',
        phoneNumber: '+91-11-23404300',
        email: 'casualty@rmlh.nic.in',
        latitude: 28.6289,
        longitude: 77.2103,
        totalBeds: 1300,
        availableBeds: 150,
      },
      {
        name: 'Lok Nayak Hospital',
        address: 'Jawaharlal Nehru Marg, Delhi Gate, New Delhi',
        phoneNumber: '+91-11-23232400',
        email: 'trauma@lnjp.delhi.gov.in',
        latitude: 28.6417,
        longitude: 77.2388,
        totalBeds: 1700,
        availableBeds: 210,
      },
    ];

    const rows: Hospital[] = [];
    for (const hospital of seedHospitals) {
      const exists = await this.hospitalRepository.findOne({
        where: { name: hospital.name },
      });
      if (!exists) {
        rows.push(this.hospitalRepository.create(hospital));
      }
    }

    if (rows.length > 0) {
      await this.hospitalRepository.save(rows);
    }
  }

  /**
   * Find all hospitals
   */
  async findAll(): Promise<Hospital[]> {
    return this.hospitalRepository.find({
      relations: ['capabilities'],
    });
  }

  /**
   * Find hospital by ID
   */
  async findById(id: string): Promise<Hospital | null> {
    return this.hospitalRepository.findOne({
      where: { id },
      relations: ['capabilities'],
    });
  }

  /**
   * Update hospital
   */
  async update(id: string, data: {
    serviceStatus?: string;
    availableBeds?: number;
    totalBeds?: number;
  }): Promise<Hospital> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    if (data.serviceStatus) {
      hospital.status = data.serviceStatus as any;
    }
    if (data.availableBeds !== undefined) {
      hospital.availableBeds = data.availableBeds;
    }
    if (data.totalBeds !== undefined) {
      hospital.totalBeds = data.totalBeds;
    }

    return this.hospitalRepository.save(hospital);
  }

  /**
   * Update hospital status
   */
  async updateStatus(id: string, serviceStatus: string): Promise<Hospital> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    hospital.status = serviceStatus as any;
    const savedHospital = await this.hospitalRepository.save(hospital);

    if (!this.isHospitalAccepting(serviceStatus)) {
      await this.rerouteDispatchesForHospital(savedHospital, `Hospital status changed to ${serviceStatus}`);
    }

    return savedHospital;
  }

  /**
   * Update available beds
   */
  async updateBeds(id: string, availableBeds: number): Promise<Hospital> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    hospital.availableBeds = availableBeds;
    const savedHospital = await this.hospitalRepository.save(hospital);

    if (availableBeds <= 0) {
      await this.rerouteDispatchesForHospital(savedHospital, 'Hospital reached full capacity');
    }

    return savedHospital;
  }

  /**
   * Update hospital capability status
   */
  async updateCapability(id: string, data: UpdateCapabilityDto): Promise<HospitalCapability> {
    const capability = await this.capabilityRepository.findOne({
      where: {
        hospitalId: id,
        capabilityType: data.capabilityType,
      },
    });

    if (!capability) {
      throw new NotFoundException(`Capability ${data.capabilityType} not found for hospital`);
    }

    if (data.status !== undefined) {
      capability.status = data.status;
    }
    if (data.capacity !== undefined) {
      capability.capacity = data.capacity;
    }
    if (data.currentLoad !== undefined) {
      capability.currentLoad = data.currentLoad;
    }

    const savedCapability = await this.capabilityRepository.save(capability);

    const resourceUnavailable =
      savedCapability.status !== 'ACCEPTING' ||
      (savedCapability.capacity > 0 && savedCapability.currentLoad >= savedCapability.capacity);

    if (resourceUnavailable) {
      const hospital = await this.findById(id);
      if (hospital) {
        await this.rerouteDispatchesForHospital(
          hospital,
          `${savedCapability.capabilityType} resource is unavailable`,
        );
      }
    }

    return savedCapability;
  }

  async rejectIncomingDispatch(hospitalId: string, dispatchId: string, user: any): Promise<{ message: string }> {
    const hospital = await this.findById(hospitalId);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    const dispatch = await this.dispatchRepository.findOne({
      where: { id: dispatchId },
      relations: ['booking', 'hospital', 'ambulance'],
    });
    if (!dispatch) {
      throw new NotFoundException('Dispatch not found');
    }
    if (dispatch.hospitalId !== hospitalId) {
      throw new ForbiddenException('This dispatch is not assigned to this hospital');
    }
    if (user?.hospitalId && user.hospitalId !== hospitalId) {
      throw new ForbiddenException('You can only reject dispatches assigned to your hospital');
    }

    await this.rerouteDispatchesForHospital(hospital, 'Hospital manually rejected incoming patient', dispatchId);
    return { message: 'Reroute initiated for rejected incoming patient' };
  }

  /**
   * Find nearby hospitals using Haversine formula
   */
  async findNearby(latitude: number, longitude: number, radiusKm: number = 10): Promise<Hospital[]> {
    const hospitals = await this.hospitalRepository.find({
      relations: ['capabilities'],
    });

    return hospitals
      .filter((hospital) => this.isHospitalAccepting(hospital.status as any))
      .filter((hospital) => {
        const distance = this.calculateDistance(
          latitude,
          longitude,
          Number(hospital.latitude),
          Number(hospital.longitude),
        );
        return distance <= radiusKm;
      })
      .sort((a, b) => {
        const distA = this.calculateDistance(latitude, longitude, Number(a.latitude), Number(a.longitude));
        const distB = this.calculateDistance(latitude, longitude, Number(b.latitude), Number(b.longitude));
        return distA - distB;
      });
  }

  /**
   * Get hospital statistics
   */
  async getHospitalStats(id: string): Promise<any> {
    const hospital = await this.findById(id);
    if (!hospital) {
      throw new NotFoundException('Hospital not found');
    }

    const bedUtilization = hospital.totalBeds > 0 
      ? ((hospital.totalBeds - hospital.availableBeds) / hospital.totalBeds) * 100 
      : 0;

    return {
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      totalBeds: hospital.totalBeds,
      availableBeds: hospital.availableBeds,
      occupiedBeds: hospital.totalBeds - hospital.availableBeds,
      bedUtilization: Math.round(bedUtilization),
      status: hospital.status,
      capabilities: hospital.capabilities || [],
    };
  }
}
