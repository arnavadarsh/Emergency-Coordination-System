import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { HospitalCapability } from '../hospitals/entities/hospital-capability.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
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
  ) {}

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
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
  async getHospitalStats(hospitalId?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get hospital info
    const hospitals = await this.hospitalRepository.find({
      relations: ['capabilities'],
    });

    const hospital = hospitalId 
      ? hospitals.find(h => h.id === hospitalId) 
      : hospitals[0];

    // Get bookings
    const allBookings = await this.bookingRepository.find({
      order: { createdAt: 'DESC' },
    });

    const activeBookings = allBookings.filter(b => 
      [BookingStatus.CREATED, BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(b.status)
    );

    const completedToday = allBookings.filter(b => 
      b.status === BookingStatus.COMPLETED && 
      b.completedAt && 
      new Date(b.completedAt) >= today
    ).length;

    // Get dispatches
    const dispatches = await this.dispatchRepository.find({
      relations: ['booking', 'ambulance'],
    });

    const incomingAmbulances = dispatches.filter(d => 
      d.booking && 
      [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(d.booking.status)
    ).length;

    return {
      hospital: hospital ? {
        id: hospital.id,
        name: hospital.name,
        status: hospital.status,
        address: hospital.address,
        phoneNumber: hospital.phoneNumber,
      } : null,
      capabilities: hospital?.capabilities || [],
      stats: {
        totalBeds: hospital?.totalBeds || 0,
        availableBeds: hospital?.availableBeds || 0,
        occupiedBeds: (hospital?.totalBeds || 0) - (hospital?.availableBeds || 0),
        incomingAmbulances,
        activeEmergencies: activeBookings.length,
        completedToday,
      },
      recentBookings: allBookings.slice(0, 10).map(b => ({
        id: b.id,
        status: b.status,
        severity: b.severity,
        description: b.description,
        pickupAddress: b.pickupAddress,
        createdAt: b.createdAt,
      })),
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

    // Get dispatches - for now get all dispatches
    // In real app, filter by driver assignment
    const dispatches = await this.dispatchRepository.find({
      relations: ['booking', 'hospital', 'ambulance'],
      order: { createdAt: 'DESC' },
    });

    // Get ambulance assigned to driver (from assignments table or config)
    const ambulances = await this.ambulanceRepository.find();
    const assignedAmbulance = ambulances[0]; // For now, use first ambulance

    const activeDispatch = dispatches.find(d => 
      d.booking && 
      [BookingStatus.ASSIGNED, BookingStatus.IN_PROGRESS].includes(d.booking.status)
    );

    const completedDispatches = dispatches.filter(d => 
      d.booking && d.booking.status === BookingStatus.COMPLETED
    );

    return {
      driver: driver ? {
        id: driver.id,
        name: driver.firstName && driver.lastName ? `${driver.firstName} ${driver.lastName}` : driver.email.split('@')[0],
        email: driver.email,
        phoneNumber: driver.phoneNumber || 'N/A',
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
          pickupLocation: d.booking.pickupAddress,
          pickupLatitude: d.booking.pickupLatitude,
          pickupLongitude: d.booking.pickupLongitude,
          dropoffLocation: d.booking.destinationAddress || d.hospital?.name || 'Hospital',
          destinationLatitude: d.booking.destinationLatitude || d.hospital?.latitude,
          destinationLongitude: d.booking.destinationLongitude || d.hospital?.longitude,
          selectedHospitalName: d.hospital?.name || d.booking.destinationAddress || 'Hospital',
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
          hospital: dispatch.hospital ? {
            id: dispatch.hospital.id,
            name: dispatch.hospital.name,
            address: dispatch.hospital.address,
            latitude: dispatch.hospital.latitude,
            longitude: dispatch.hospital.longitude,
          } : undefined,
          ambulance: dispatch.ambulance ? {
            vehicleNumber: dispatch.ambulance.vehicleNumber,
            type: dispatch.ambulance.vehicleType,
            currentLatitude: dispatch.ambulance.currentLatitude,
            currentLongitude: dispatch.ambulance.currentLongitude,
          } : undefined,
        } : undefined,
        hospital: dispatch?.hospital ? {
          id: dispatch.hospital.id,
          name: dispatch.hospital.name,
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
        emergencyContact: user.emergencyContact,
        bloodType: user.bloodType,
        medicalHistory: user.medicalNotes,
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
