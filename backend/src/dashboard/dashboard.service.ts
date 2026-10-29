import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { HospitalCapability } from '../hospitals/entities/hospital-capability.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { DriverIdentityService } from '../users/driver-identity.service';
import { MedicalProfileService } from '../users/medical-profile.service';
import { BookingStatus, UserRole } from '../common/enums';
import { isSqlite } from '../config/env';

const EARTH_RADIUS_KM = 6371;

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Hospital)
    private hospitalRepository: Repository<Hospital>,
    @InjectRepository(HospitalCapability)
    private capabilityRepository: Repository<HospitalCapability>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private auditRepository: Repository<AuditLog>,
    private readonly driverIdentityService: DriverIdentityService,
    private readonly medicalProfileService: MedicalProfileService,
  ) {}

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /** Patient's display name, falling back to the email local part. */
  private patientDisplayName(patient?: User | null): string {
    if (!patient) return 'Patient';
    const fullName = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim();
    return fullName || patient.email?.split('@')[0] || 'Patient';
  }

  private calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  private buildFallbackEta(originLat: number, originLng: number, destinationLat: number, destinationLng: number) {
    const distanceKm = this.calculateDistanceKm(originLat, originLng, destinationLat, destinationLng);
    const assumedCitySpeedKmh = 35;
    const etaMinutes = Math.max(1, Math.round((distanceKm / assumedCitySpeedKmh) * 60));
    const expectedAt = new Date(Date.now() + etaMinutes * 60 * 1000);

    return {
      source: 'fallback',
      etaMinutes,
      etaText: `${etaMinutes} min`,
      expectedArrivalIso: expectedAt.toISOString(),
      distanceKm: Number(distanceKm.toFixed(2)),
    };
  }

  async getLiveEta(originLat: number, originLng: number, destinationLat: number, destinationLng: number) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return this.buildFallbackEta(originLat, originLng, destinationLat, destinationLng);
    }

    const origins = `${originLat},${originLng}`;
    const destinations = `${destinationLat},${destinationLng}`;
    const params = new URLSearchParams({
      origins,
      destinations,
      mode: 'driving',
      departure_time: 'now',
      traffic_model: 'best_guess',
      key: apiKey,
    });

    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`);
      if (!response.ok) {
        return this.buildFallbackEta(originLat, originLng, destinationLat, destinationLng);
      }

      const data: any = await response.json();
      const element = data?.rows?.[0]?.elements?.[0];
      const durationInTraffic = element?.duration_in_traffic;
      const duration = element?.duration;
      const distance = element?.distance;

      if (data?.status !== 'OK' || !element || element.status !== 'OK' || (!durationInTraffic && !duration)) {
        return this.buildFallbackEta(originLat, originLng, destinationLat, destinationLng);
      }

      const durationValueSec = Number(durationInTraffic?.value ?? duration?.value);
      if (!Number.isFinite(durationValueSec) || durationValueSec <= 0) {
        return this.buildFallbackEta(originLat, originLng, destinationLat, destinationLng);
      }

      const etaMinutes = Math.max(1, Math.round(durationValueSec / 60));
      const expectedAt = new Date(Date.now() + etaMinutes * 60 * 1000);

      return {
        source: 'google',
        etaMinutes,
        etaText: durationInTraffic?.text || duration?.text || `${etaMinutes} min`,
        expectedArrivalIso: expectedAt.toISOString(),
        distanceText: distance?.text,
      };
    } catch {
      return this.buildFallbackEta(originLat, originLng, destinationLat, destinationLng);
    }
  }

  /**
   * Get hospital dashboard stats.
   *
   * Everything is filtered to this hospital in the database: it used to load
   * every hospital, every booking and every dispatch in the system and filter
   * them in memory, so the page slowed down with every case anyone ever raised.
   */
  async getHospitalStats(hospitalId?: string, userEmail?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const normalizedEmail = userEmail?.trim().toLowerCase();
    const hospital = hospitalId
      ? await this.hospitalRepository.findOne({ where: { id: hospitalId }, relations: ['capabilities'] })
      : normalizedEmail
        ? await this.hospitalRepository
            .createQueryBuilder('hospital')
            .leftJoinAndSelect('hospital.capabilities', 'capability')
            .where('LOWER(hospital.email) = :email', { email: normalizedEmail })
            .getOne()
        : null;

    if (!hospital) {
      throw new NotFoundException(
        'No hospital is linked to this account. Ask an administrator to assign a hospital to this login.',
      );
    }

    const liveStatuses = [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS];
    const openStatuses = [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS];

    const [alertDispatches, recentDispatches, counts] = await Promise.all([
      this.dispatchRepository
        .createQueryBuilder('dispatch')
        .innerJoinAndSelect('dispatch.booking', 'booking')
        .leftJoinAndSelect('dispatch.ambulance', 'ambulance')
        .where('dispatch.hospitalId = :hospitalId', { hospitalId: hospital.id })
        .andWhere('booking.status IN (:...liveStatuses)', { liveStatuses })
        .orderBy('dispatch.createdAt', 'DESC')
        .getMany(),
      this.dispatchRepository
        .createQueryBuilder('dispatch')
        .innerJoinAndSelect('dispatch.booking', 'booking')
        .where('dispatch.hospitalId = :hospitalId', { hospitalId: hospital.id })
        .orderBy('booking.createdAt', 'DESC')
        .limit(10)
        .getMany(),
      this.dispatchRepository
        .createQueryBuilder('dispatch')
        .innerJoin('dispatch.booking', 'booking')
        .select('SUM(CASE WHEN booking.status IN (:...openStatuses) THEN 1 ELSE 0 END)', 'active')
        .addSelect(
          'SUM(CASE WHEN booking.status = :completed AND booking.completedAt >= :today THEN 1 ELSE 0 END)',
          'completedToday',
        )
        .where('dispatch.hospitalId = :hospitalId', { hospitalId: hospital.id })
        .setParameters({ openStatuses, completed: BookingStatus.COMPLETED, today })
        .getRawOne(),
    ]);

    // Resolve every alert's driver, and each incoming patient's Medical Profile,
    // in one batch each — straight from their profiles, so the pre-alert always
    // carries the latest saved information.
    const [alertDrivers, alertMedicalProfiles] = await Promise.all([
      this.driverIdentityService.resolveMany(
        alertDispatches.map(d => ({
          driverId: d.driverId,
          ambulanceId: d.ambulanceId,
          vehicleNumber: d.ambulance?.vehicleNumber ?? null,
        })),
      ),
      this.medicalProfileService.resolveMany(alertDispatches.map(d => d.booking?.userId)),
    ]);

    const preArrivalAlerts = alertDispatches
      .map(d => ({
        dispatchId: d.id,
        bookingId: d.bookingId,
        ambulanceId: d.ambulanceId,
        ambulanceVehicleNumber: d.ambulance?.vehicleNumber ?? 'N/A',
        driver: alertDrivers.get(
          this.driverIdentityService.refKey({ driverId: d.driverId, ambulanceId: d.ambulanceId }),
        ) ?? null,
        ambulanceLocation: {
          latitude: d.ambulance?.currentLatitude ?? null,
          longitude: d.ambulance?.currentLongitude ?? null,
        },
        patientSeverity: d.booking?.severity ?? 'MEDIUM',
        emergencyType: null,
        triage: null,
        medicalProfile: this.medicalProfileService.fromMap(alertMedicalProfiles, d.booking?.userId),
        etaMinutes: d.estimatedPickupTime ?? null,
        status: d.status,
        alertedAt: d.dispatchedAt?.toISOString() ?? d.createdAt?.toISOString() ?? new Date().toISOString(),
      }));

    return {
      hospital: {
        id: hospital.id,
        name: hospital.name,
        status: hospital.status,
        address: hospital.address,
        phoneNumber: hospital.phoneNumber,
      },
      capabilities: hospital.capabilities || [],
      stats: {
        totalBeds: hospital.totalBeds || 0,
        availableBeds: hospital.availableBeds || 0,
        occupiedBeds: (hospital.totalBeds || 0) - (hospital.availableBeds || 0),
        incomingAmbulances: alertDispatches.length,
        activeEmergencies: Number(counts?.active ?? 0),
        completedToday: Number(counts?.completedToday ?? 0),
      },
      recentBookings: recentDispatches.map(({ booking: b }) => ({
        id: b.id,
        status: b.status,
        severity: b.severity,
        description: b.description,
        pickupAddress: b.pickupAddress,
        createdAt: b.createdAt,
      })),
      preArrivalAlerts,
    };
  }

  /**
   * Live Operations Map — every ambulance and hospital in the system, with the
   * work currently tying them together.
   *
   * Read-only snapshot for the admin map. The map keeps itself current from
   * realtime events (ambulance_location_updated, ambulance_status_updated,
   * hospital_status_updated) and re-fetches this endpoint as a fallback, so the
   * shape here is the same one those events patch into.
   *
   * Units with no coordinates on record are still returned, flagged
   * `hasLocation: false`, so the map can report "3 ambulances not shown"
   * rather than silently dropping them.
   */
  async getOperationsMap() {
    // Only dispatches still in flight matter to an operations view, so only
    // those are read — not every dispatch ever made.
    const [ambulances, hospitals, liveDispatches] = await Promise.all([
      this.ambulanceRepository.find({ order: { vehicleNumber: 'ASC' } }),
      this.hospitalRepository.find({ relations: ['capabilities'], order: { name: 'ASC' } }),
      this.dispatchRepository
        .createQueryBuilder('dispatch')
        .innerJoinAndSelect('dispatch.booking', 'booking')
        .leftJoinAndSelect('dispatch.hospital', 'hospital')
        .where('booking.status IN (:...live)', { live: [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS] })
        .getMany(),
    ]);

    const drivers = await this.driverIdentityService.resolveMany(
      liveDispatches.map(d => ({
        driverId: d.driverId,
        ambulanceId: d.ambulanceId,
        vehicleNumber: ambulances.find(a => a.id === d.ambulanceId)?.vehicleNumber ?? null,
      })),
    );

    const dispatchByAmbulance = new Map<string, typeof liveDispatches[number]>();
    for (const d of liveDispatches) {
      // If an ambulance somehow has two live dispatches, the newest one wins.
      const existing = dispatchByAmbulance.get(d.ambulanceId);
      if (!existing || (d.dispatchedAt ?? d.createdAt) > (existing.dispatchedAt ?? existing.createdAt)) {
        dispatchByAmbulance.set(d.ambulanceId, d);
      }
    }

    const num = (v: any): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const mappedAmbulances = ambulances.map(a => {
      const latitude = num(a.currentLatitude);
      const longitude = num(a.currentLongitude);
      const dispatch = dispatchByAmbulance.get(a.id) ?? null;

      return {
        id: a.id,
        vehicleNumber: a.vehicleNumber,
        vehicleType: a.vehicleType,
        status: a.status,
        latitude,
        longitude,
        hasLocation: latitude !== null && longitude !== null,
        lastLocationUpdate: a.lastLocationUpdate?.toISOString() ?? null,
        driver: dispatch
          ? drivers.get(this.driverIdentityService.refKey({ driverId: dispatch.driverId, ambulanceId: dispatch.ambulanceId })) ?? null
          : null,
        assignment: dispatch ? {
          dispatchId: dispatch.id,
          bookingId: dispatch.bookingId,
          dispatchStatus: dispatch.status,
          bookingStatus: dispatch.booking?.status ?? null,
          severity: dispatch.booking?.severity ?? null,
          etaMinutes: dispatch.estimatedPickupTime ?? null,
          pickup: {
            latitude: num(dispatch.booking?.pickupLatitude),
            longitude: num(dispatch.booking?.pickupLongitude),
            address: dispatch.booking?.pickupAddress ?? null,
          },
          destination: dispatch.hospital ? {
            id: dispatch.hospital.id,
            name: dispatch.hospital.name,
            latitude: num(dispatch.hospital.latitude),
            longitude: num(dispatch.hospital.longitude),
          } : null,
        } : null,
      };
    });

    const incomingByHospital = new Map<string, number>();
    for (const d of liveDispatches) {
      if (d.hospitalId) incomingByHospital.set(d.hospitalId, (incomingByHospital.get(d.hospitalId) ?? 0) + 1);
    }

    const mappedHospitals = hospitals.map(h => {
      const latitude = num(h.latitude);
      const longitude = num(h.longitude);
      const totalBeds = h.totalBeds ?? 0;
      const availableBeds = h.availableBeds ?? 0;

      return {
        id: h.id,
        name: h.name,
        address: h.address ?? null,
        phoneNumber: h.phoneNumber ?? null,
        status: h.status,
        latitude,
        longitude,
        hasLocation: latitude !== null && longitude !== null,
        totalBeds,
        availableBeds,
        occupiedBeds: Math.max(0, totalBeds - availableBeds),
        // Guard against a zero bed count so the map never shows NaN%.
        occupancyPercent: totalBeds > 0 ? Math.round(((totalBeds - availableBeds) / totalBeds) * 100) : null,
        capabilities: (h.capabilities ?? []).map(c => ({
          type: c.capabilityType,
          status: c.status,
        })),
        incomingAmbulances: incomingByHospital.get(h.id) ?? 0,
      };
    });

    const countBy = (rows: { status: any }[], status: string) =>
      rows.filter(r => String(r.status).toUpperCase() === status).length;

    return {
      generatedAt: new Date().toISOString(),
      ambulances: mappedAmbulances,
      hospitals: mappedHospitals,
      summary: {
        ambulances: {
          total: mappedAmbulances.length,
          available: countBy(mappedAmbulances, 'AVAILABLE'),
          busy: countBy(mappedAmbulances, 'BUSY'),
          maintenance: countBy(mappedAmbulances, 'MAINTENANCE'),
          offline: countBy(mappedAmbulances, 'OFFLINE'),
          withoutLocation: mappedAmbulances.filter(a => !a.hasLocation).length,
        },
        hospitals: {
          total: mappedHospitals.length,
          accepting: countBy(mappedHospitals, 'ACCEPTING'),
          limited: countBy(mappedHospitals, 'LIMITED'),
          divert: countBy(mappedHospitals, 'DIVERT'),
          withoutLocation: mappedHospitals.filter(h => !h.hasLocation).length,
          totalBeds: mappedHospitals.reduce((s, h) => s + h.totalBeds, 0),
          availableBeds: mappedHospitals.reduce((s, h) => s + h.availableBeds, 0),
        },
        activeDispatches: liveDispatches.length,
      },
    };
  }

  /**
   * Get admin dashboard stats.
   *
   * Six queries, run together: user counts grouped by role, one aggregate over
   * bookings, and the lists the console renders. It used to be fourteen
   * sequential round trips plus a full read of every booking — and each round
   * trip to the database costs the full network latency between the server and
   * the database region.
   */
  async getAdminStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const responseSeconds = isSqlite()
      ? '(julianday(booking.completedAt) - julianday(booking.createdAt)) * 86400'
      : 'EXTRACT(EPOCH FROM (booking.completedAt - booking.createdAt))';

    const [roleRows, bookingTotals, ambulances, hospitals, auditLogs, users] = await Promise.all([
      this.userRepository
        .createQueryBuilder('u')
        .select('u.role', 'role')
        .addSelect('COUNT(*)', 'total')
        .addSelect('SUM(CASE WHEN u.isActive = :active THEN 1 ELSE 0 END)', 'active')
        .setParameter('active', true)
        .groupBy('u.role')
        .getRawMany(),
      this.bookingRepository
        .createQueryBuilder('booking')
        .select('COUNT(*)', 'total')
        .addSelect('SUM(CASE WHEN booking.status IN (:...open) THEN 1 ELSE 0 END)', 'active')
        .addSelect('SUM(CASE WHEN booking.status = :completed THEN 1 ELSE 0 END)', 'completed')
        .addSelect('SUM(CASE WHEN booking.status = :cancelled THEN 1 ELSE 0 END)', 'cancelled')
        .addSelect(
          'SUM(CASE WHEN booking.status = :completed AND booking.completedAt >= :today THEN 1 ELSE 0 END)',
          'completedToday',
        )
        .addSelect('SUM(CASE WHEN booking.severity IN (:...urgent) THEN 1 ELSE 0 END)', 'emergencies')
        .addSelect(
          `AVG(CASE WHEN booking.status = :completed AND booking.completedAt IS NOT NULL THEN ${responseSeconds} END)`,
          'avgResponseSeconds',
        )
        .setParameters({
          open: [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS],
          completed: BookingStatus.COMPLETED,
          cancelled: BookingStatus.CANCELLED,
          urgent: ['HIGH', 'CRITICAL'],
          today,
        })
        .getRawOne(),
      this.ambulanceRepository.find(),
      this.hospitalRepository.find({ relations: ['capabilities'] }),
      this.auditRepository.find({ order: { createdAt: 'DESC' }, take: 20 }),
      this.userRepository.find({ order: { createdAt: 'DESC' } }),
    ]);

    const byRole = (role: UserRole) => Number(roleRows.find(row => row.role === role)?.total ?? 0);
    const totalUsers = roleRows.reduce((sum, row) => sum + Number(row.total), 0);
    const activeUsers = roleRows.reduce((sum, row) => sum + Number(row.active ?? 0), 0);

    const totalBookings = Number(bookingTotals?.total ?? 0);
    const activeBookings = Number(bookingTotals?.active ?? 0);
    const completedTotal = Number(bookingTotals?.completed ?? 0);
    const cancelledTotal = Number(bookingTotals?.cancelled ?? 0);
    const avgResponseTime = Math.round(Number(bookingTotals?.avgResponseSeconds ?? 0)) || 0; // seconds

    const totalAmbulances = ambulances.length;
    const availableAmbulances = ambulances.filter(a => a.status === 'AVAILABLE').length;
    const busyAmbulances = ambulances.filter(a => a.status === 'BUSY').length;
    const maintenanceAmbulances = ambulances.filter(a => a.status === 'MAINTENANCE').length;
    const verifiedAmbulances = ambulances.filter(a => a.status !== 'PENDING').length;

    const totalBeds = hospitals.reduce((sum, h) => sum + (h.totalBeds || 0), 0);
    const availableBeds = hospitals.reduce((sum, h) => sum + (h.availableBeds || 0), 0);
    const occupiedBeds = totalBeds - availableBeds;
    const capacityUtilization = totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : '0';

    return {
      stats: {
        totalUsers,
        totalHospitals: hospitals.length,
        totalAmbulances,
        activeBookings,
        completedToday: Number(bookingTotals?.completedToday ?? 0),
        emergenciesHandled: Number(bookingTotals?.emergencies ?? 0),
        avgResponseTime, // in seconds
        usersByRole: {
          admin: byRole(UserRole.ADMIN),
          hospital: byRole(UserRole.HOSPITAL),
          driver: byRole(UserRole.DRIVER),
          user: byRole(UserRole.USER),
        },
        activeUsers,
        bookingStats: {
          total: totalBookings,
          active: activeBookings,
          completed: completedTotal,
          cancelled: cancelledTotal,
          completionRate: totalBookings > 0
            ? ((completedTotal / totalBookings) * 100).toFixed(1)
            : '0',
        },
        ambulanceStats: {
          total: totalAmbulances,
          available: availableAmbulances,
          busy: busyAmbulances,
          maintenance: maintenanceAmbulances,
          verified: verifiedAmbulances,
          utilization: totalAmbulances > 0
            ? ((busyAmbulances / totalAmbulances) * 100).toFixed(1)
            : '0',
        },
        hospitalCapacity: {
          totalBeds,
          availableBeds,
          occupiedBeds,
          utilization: capacityUtilization,
        },
      },
      recentAudit: auditLogs.map(log => ({
        id: log.id,
        action: log.action,
        entity: log.entityType,
        entityId: log.entityId,
        actor: log.userId,
        changes: log.changes,
        beforeState: log.beforeState,
        afterState: log.afterState,
        createdAt: log.createdAt,
      })),
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        firstName: u.firstName,
        lastName: u.lastName,
        phoneNumber: u.phoneNumber,
        createdAt: u.createdAt,
      })),
      hospitals,
      ambulances,
    };
  }

  /**
   * Get driver dashboard stats.
   *
   * Strictly this driver's own trips: ones they claimed, and unclaimed ones
   * given to the ambulance linked to their account. A driver with no ambulance
   * sees no ambulance and no trips. (It used to fall back to the first
   * ambulance in the table and, failing a match, to every dispatch in the
   * system — patient names, phone numbers and Medical Profiles included.)
   */
  async getDriverStats(driverId: string) {
    const driver = await this.userRepository.findOne({
      where: { id: driverId },
    });
    const ambulanceId = driver?.ambulanceId ?? null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [assignedAmbulance, dispatches, counts] = await Promise.all([
      ambulanceId ? this.ambulanceRepository.findOne({ where: { id: ambulanceId } }) : Promise.resolve(null),
      this.dispatchRepository.find({
        where: ambulanceId ? [{ driverId }, { driverId: IsNull(), ambulanceId }] : [{ driverId }],
        relations: ['booking', 'hospital', 'ambulance'],
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.dispatchRepository
        .createQueryBuilder('dispatch')
        .innerJoin('dispatch.booking', 'booking')
        .select('SUM(CASE WHEN booking.status = :completed THEN 1 ELSE 0 END)', 'totalCompleted')
        .addSelect(
          'SUM(CASE WHEN booking.status = :completed AND booking.completedAt >= :today THEN 1 ELSE 0 END)',
          'completedToday',
        )
        .where(
          ambulanceId
            ? '(dispatch.driverId = :driverId OR (dispatch.driverId IS NULL AND dispatch.ambulanceId = :ambulanceId))'
            : 'dispatch.driverId = :driverId',
          { driverId, ambulanceId },
        )
        .setParameters({ completed: BookingStatus.COMPLETED, today })
        .getRawOne(),
    ]);

    // The responder triages the patient from this screen, so each dispatch carries
    // the patient's identity and Medical Profile — read live from the patient's
    // profile — alongside the emergency details.
    const patientIds = [...new Set(
      dispatches.map(d => d.booking?.userId).filter((id): id is string => !!id),
    )];
    const patients = patientIds.length > 0
      ? await this.userRepository.find({ where: { id: In(patientIds) } })
      : [];
    const patientsById = new Map(patients.map(p => [p.id, p]));

    return {
      driver: driver ? {
        id: driver.id,
        name: driver.firstName && driver.lastName ? `${driver.firstName} ${driver.lastName}` : driver.email.split('@')[0],
        email: driver.email,
        phoneNumber: driver.phoneNumber || 'N/A',
        photoUrl: driver.profilePhotoUrl || null,
        licenseNumber: driver.emergencyContact || 'DL-12345',
        ambulanceId: assignedAmbulance?.id,
      } : null,
      ambulance: assignedAmbulance ? {
        id: assignedAmbulance.id,
        vehicleNumber: assignedAmbulance.vehicleNumber,
        type: assignedAmbulance.vehicleType,
        status: assignedAmbulance.status,
        currentLatitude: assignedAmbulance.currentLatitude,
        currentLongitude: assignedAmbulance.currentLongitude,
      } : null,
      dispatches: dispatches.map(d => ({
        id: d.id,
        bookingId: d.bookingId,
        ambulanceId: d.ambulanceId,
        driverId: driverId,
        status: d.status || d.booking?.status || 'ASSIGNED',
        assignedAt: d.dispatchedAt || d.createdAt,
        completedAt: d.completedAt,
        booking: d.booking ? {
          id: d.booking.id,
          userId: d.booking.userId,
          patientName: this.patientDisplayName(patientsById.get(d.booking.userId)),
          patientPhone: patientsById.get(d.booking.userId)?.phoneNumber || null,
          medicalProfile: this.medicalProfileService.fromUser(patientsById.get(d.booking.userId)),
          pickupLocation: d.booking.pickupAddress,
          pickupLatitude: d.booking.pickupLatitude,
          pickupLongitude: d.booking.pickupLongitude,
          dropoffLocation: d.booking.destinationAddress || d.hospital?.name || 'Hospital',
          destinationLatitude: d.booking.destinationLatitude || d.hospital?.latitude,
          destinationLongitude: d.booking.destinationLongitude || d.hospital?.longitude,
          selectedHospitalName: d.booking.destinationAddress || d.hospital?.name || 'Hospital',
          selectedHospitalAddress: d.hospital?.address || d.booking.destinationAddress || 'Address unavailable',
          bookingType: d.booking.severity === 'CRITICAL' || d.booking.severity === 'HIGH' ? 'EMERGENCY' : 'SCHEDULED',
          severity: d.booking.severity,
          status: d.booking.status,
          createdAt: d.booking.createdAt,
        } : undefined,
      })),
      stats: {
        completedToday: Number(counts?.completedToday ?? 0),
        totalCompleted: Number(counts?.totalCompleted ?? 0),
      },
    };
  }

  /**
   * Get user dashboard stats
   */
  async getUserStats(userId: string) {
    const [user, bookings] = await Promise.all([
      this.userRepository.findOne({ where: { id: userId } }),
      this.bookingRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const activeBooking = bookings.find(b => 
      [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(b.status)
    );

    // Only this patient's dispatches — it used to read every dispatch in the
    // system and filter them here.
    const bookingIds = bookings.map(b => b.id);
    const dispatches = bookingIds.length > 0
      ? await this.dispatchRepository.find({
          where: { bookingId: In(bookingIds) },
          relations: ['ambulance', 'hospital'],
        })
      : [];

    // Resolve the driver behind each dispatch once, so the tracking view can name the person driving.
    const dispatchDrivers = await this.driverIdentityService.resolveMany(
      dispatches.map(d => ({
        driverId: d.driverId,
        ambulanceId: d.ambulanceId,
        vehicleNumber: d.ambulance?.vehicleNumber ?? null,
      })),
    );

    // Build bookings with dispatch info
    const bookingsWithDispatch = bookings.map(b => {
      const dispatch = dispatches.find(d => d.bookingId === b.id);
      return {
        id: b.id,
        userId: b.userId,
        pickupLocation: b.pickupAddress,
        pickupLatitude: b.pickupLatitude,
        pickupLongitude: b.pickupLongitude,
        dropoffLocation: b.destinationAddress,
        destinationLatitude: b.destinationLatitude || dispatch?.hospital?.latitude,
        destinationLongitude: b.destinationLongitude || dispatch?.hospital?.longitude,
        bookingType: b.severity === 'CRITICAL' || b.severity === 'HIGH' ? 'EMERGENCY' : 'SCHEDULED',
        severity: b.severity,
        status: b.status,
        createdAt: b.createdAt,
        description: b.description,
        dispatch: dispatch ? {
          status: dispatch.status || b.status,
          hospital: dispatch?.hospital ? {
            id: dispatch.hospital.id,
            name: b.destinationAddress || dispatch.hospital.name,
            address: dispatch.hospital.address,
            latitude: b.destinationLatitude || dispatch.hospital.latitude,
            longitude: b.destinationLongitude || dispatch.hospital.longitude,
          } : undefined,
          ambulance: dispatch.ambulance ? {
            vehicleNumber: dispatch.ambulance.vehicleNumber,
            type: dispatch.ambulance.vehicleType,
            currentLatitude: dispatch.ambulance.currentLatitude,
            currentLongitude: dispatch.ambulance.currentLongitude,
          } : undefined,
          driver: dispatchDrivers.get(
            this.driverIdentityService.refKey({
              driverId: dispatch.driverId,
              ambulanceId: dispatch.ambulanceId,
            }),
          ) ?? null,
        } : undefined,
        hospital: dispatch?.hospital ? {
          id: dispatch.hospital.id,
          name: b.destinationAddress || dispatch.hospital.name,
          address: dispatch.hospital.address,
        } : undefined,
      };
    });

    return {
      user: user ? {
        id: user.id,
        email: user.email,
        name: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email.split('@')[0],
        phoneNumber: user.phoneNumber || 'N/A',
        firstName: user.firstName,
        lastName: user.lastName,
        address: user.address,
        dateOfBirth: user.dateOfBirth,
        emergencyContact: user.emergencyContact,
        bloodType: user.bloodType,
        medicalHistory: user.medicalNotes,
        // Single source of truth for the patient's standing clinical background.
        medicalProfile: this.medicalProfileService.fromUser(user),
      } : null,
      bookings: bookingsWithDispatch,
      activeBooking: activeBooking ? bookingsWithDispatch.find(b => b.id === activeBooking.id) : null,
      stats: {
        totalBookings: bookings.length,
        completedBookings: bookings.filter(b => b.status === BookingStatus.COMPLETED).length,
        cancelledBookings: bookings.filter(b => b.status === BookingStatus.CANCELLED).length,
      },
    };
  }
}
