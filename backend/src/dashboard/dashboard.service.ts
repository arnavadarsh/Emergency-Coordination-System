import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, In } from 'typeorm';
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
   * Get hospital dashboard stats
   */
  async getHospitalStats(hospitalId?: string, userEmail?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const hospitals = await this.hospitalRepository.find({
      relations: ['capabilities'],
    });

    const normalizedEmail = userEmail?.trim().toLowerCase();
    const hospital = hospitalId
      ? hospitals.find(h => h.id === hospitalId)
      : hospitals.find(h => h.email?.trim().toLowerCase() === normalizedEmail);

    if (!hospital) {
      throw new NotFoundException(
        'No hospital is linked to this account. Ask an administrator to assign a hospital to this login.',
      );
    }

    const allBookings = await this.bookingRepository.find({
      order: { createdAt: 'DESC' },
    });

    const allDispatches = await this.dispatchRepository.find({
      relations: ['booking', 'ambulance'],
    });

    const hospitalDispatches = allDispatches.filter(d => d.hospitalId === hospital.id);
    const hospitalBookingIds = new Set(hospitalDispatches.map(d => d.bookingId));
    const hospitalBookings = allBookings.filter(b => hospitalBookingIds.has(b.id));

    const activeBookings = hospitalBookings.filter(b =>
      [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(b.status),
    );

    const completedToday = hospitalBookings.filter(b =>
      b.status === BookingStatus.COMPLETED &&
      b.completedAt &&
      new Date(b.completedAt) >= today,
    ).length;

    const incomingAmbulances = hospitalDispatches.filter(d =>
      d.booking &&
      [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(d.booking.status),
    ).length;

    const alertDispatches = hospitalDispatches.filter(d =>
      d.booking &&
      [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(d.booking.status)
    );

    // Resolve every alert's driver in one batch so the pre-arrival report can show who is driving.
    const alertDrivers = await this.driverIdentityService.resolveMany(
      alertDispatches.map(d => ({
        driverId: d.driverId,
        ambulanceId: d.ambulanceId,
        vehicleNumber: d.ambulance?.vehicleNumber ?? null,
      })),
    );

    // Batch-resolve each incoming patient's Medical Profile straight from their
    // profile, so the pre-alert always carries the latest saved information.
    const alertMedicalProfiles = await this.medicalProfileService.resolveMany(
      alertDispatches.map(d => d.booking?.userId),
    );

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
        incomingAmbulances,
        activeEmergencies: activeBookings.length,
        completedToday,
      },
      recentBookings: hospitalBookings.slice(0, 10).map(b => ({
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
    const [ambulances, hospitals, dispatches] = await Promise.all([
      this.ambulanceRepository.find({ order: { vehicleNumber: 'ASC' } }),
      this.hospitalRepository.find({ relations: ['capabilities'], order: { name: 'ASC' } }),
      this.dispatchRepository.find({ relations: ['booking', 'hospital'] }),
    ]);

    // Only dispatches still in flight matter to an operations view.
    const liveDispatches = dispatches.filter(d =>
      d.booking && [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(d.booking.status),
    );

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
   * Get admin dashboard stats
   */
  async getAdminStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count entities
    const totalUsers = await this.userRepository.count();
    const totalHospitals = await this.hospitalRepository.count();
    const totalAmbulances = await this.ambulanceRepository.count();

    // Get users by role
    const adminUsers = await this.userRepository.count({ where: { role: UserRole.ADMIN } });
    const hospitalUsers = await this.userRepository.count({ where: { role: UserRole.HOSPITAL } });
    const driverUsers = await this.userRepository.count({ where: { role: UserRole.DRIVER } });
    const regularUsers = await this.userRepository.count({ where: { role: UserRole.USER } });
    const activeUsers = await this.userRepository.count({ where: { isActive: true } });

    // Get bookings
    const allBookings = await this.bookingRepository.find();
    const activeBookings = allBookings.filter(b => 
      [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(b.status)
    ).length;

    const completedToday = allBookings.filter(b => 
      b.status === BookingStatus.COMPLETED && 
      b.completedAt && 
      new Date(b.completedAt) >= today
    ).length;

    const completedTotal = allBookings.filter(b => b.status === BookingStatus.COMPLETED).length;
    const cancelledTotal = allBookings.filter(b => b.status === BookingStatus.CANCELLED).length;

    const emergenciesHandled = allBookings.filter(b => 
      b.severity === 'HIGH' || b.severity === 'CRITICAL'
    ).length;

    // Calculate average response time (seconds)
    const completedBookings = allBookings.filter(b => b.status === BookingStatus.COMPLETED);
    let avgResponseTime = 0;
    if (completedBookings.length > 0) {
      const totalTime = completedBookings.reduce((sum, b) => {
        if (b.completedAt && b.createdAt) {
          return sum + (new Date(b.completedAt).getTime() - new Date(b.createdAt).getTime());
        }
        return sum;
      }, 0);
      avgResponseTime = Math.round((totalTime / completedBookings.length) / 1000); // Convert to seconds
    }

    // Get ambulance stats
    const ambulances = await this.ambulanceRepository.find();
    const availableAmbulances = ambulances.filter(a => a.status === 'AVAILABLE').length;
    const busyAmbulances = ambulances.filter(a => a.status === 'BUSY').length;
    const maintenanceAmbulances = ambulances.filter(a => a.status === 'MAINTENANCE').length;
    const verifiedAmbulances = ambulances.filter(a => a.status !== 'PENDING').length;

    // Get hospital capacity overview
    const hospitals = await this.hospitalRepository.find({
      relations: ['capabilities'],
    });
    const totalBeds = hospitals.reduce((sum, h) => sum + (h.totalBeds || 0), 0);
    const availableBeds = hospitals.reduce((sum, h) => sum + (h.availableBeds || 0), 0);
    const occupiedBeds = totalBeds - availableBeds;
    const capacityUtilization = totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : '0';

    // Get recent audit logs
    const auditLogs = await this.auditRepository.find({
      order: { createdAt: 'DESC' },
      take: 20,
    });

    // Get all users for management
    const users = await this.userRepository.find({
      order: { createdAt: 'DESC' },
    });

    return {
      stats: {
        totalUsers,
        totalHospitals,
        totalAmbulances,
        activeBookings,
        completedToday,
        emergenciesHandled,
        avgResponseTime, // in seconds
        usersByRole: {
          admin: adminUsers,
          hospital: hospitalUsers,
          driver: driverUsers,
          user: regularUsers,
        },
        activeUsers,
        bookingStats: {
          total: allBookings.length,
          active: activeBookings,
          completed: completedTotal,
          cancelled: cancelledTotal,
          completionRate: allBookings.length > 0 
            ? ((completedTotal / allBookings.length) * 100).toFixed(1) 
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
   * Get driver dashboard stats
   */
  async getDriverStats(driverId: string) {
    // Get driver user info
    const driver = await this.userRepository.findOne({
      where: { id: driverId },
    });

    const allDispatches = await this.dispatchRepository.find({
      relations: ['booking', 'hospital', 'ambulance'],
      order: { createdAt: 'DESC' },
    });

    const ambulances = await this.ambulanceRepository.find();
    const assignedAmbulance =
      driver?.ambulanceId
        ? ambulances.find(ambulance => ambulance.id === driver.ambulanceId)
        : ambulances[0];

    const scopedDispatches = allDispatches.filter(d => {
      if (d.driverId && d.driverId === driverId) return true;
      if (!d.driverId && assignedAmbulance?.id && d.ambulanceId === assignedAmbulance.id) return true;
      return false;
    });
    const dispatches = scopedDispatches.length > 0 ? scopedDispatches : allDispatches;

    const activeDispatch = dispatches.find(d => 
      d.booking && 
      [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(d.booking.status)
    );

    const completedDispatches = dispatches.filter(d => 
      d.booking && d.booking.status === BookingStatus.COMPLETED
    );

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
        completedToday: completedDispatches.filter(d => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return d.booking?.completedAt && new Date(d.booking.completedAt) >= today;
        }).length,
        totalCompleted: completedDispatches.length,
      },
    };
  }

  /**
   * Get user dashboard stats
   */
  async getUserStats(userId: string) {
    // Get user info
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    // Get user's bookings
    const bookings = await this.bookingRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const activeBooking = bookings.find(b => 
      [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(b.status)
    );

    // Get dispatches for user's bookings
    const bookingIds = bookings.map(b => b.id);
    let dispatches: any[] = [];
    if (bookingIds.length > 0) {
      dispatches = await this.dispatchRepository.find({
        relations: ['ambulance', 'hospital', 'booking'],
      });
      dispatches = dispatches.filter(d => bookingIds.includes(d.bookingId));
    }

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
