import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital, HospitalCapability } from './entities';
import { UpdateCapabilityDto } from './dto';
import { HospitalStatus } from '../common/enums';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * Hospitals Service
 * Hospital management with status updates
 */
@Injectable()
export class HospitalsService implements OnModuleInit {
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
      await this.divertInFlightDispatches(savedHospital);
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
    return this.hospitalRepository.save(hospital);
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

    return this.capabilityRepository.save(capability);
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
