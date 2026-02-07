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

    const emergenciesHandled = allBookings.filter(b => 
      b.severity === 'HIGH' || b.severity === 'CRITICAL'
    ).length;

    // Get recent audit logs
    const auditLogs = await this.auditRepository.find({
      order: { createdAt: 'DESC' },
      take: 20,
    });

    // Get all users for management
    const users = await this.userRepository.find({
      order: { createdAt: 'DESC' },
    });

    // Get all hospitals
    const hospitals = await this.hospitalRepository.find({
      relations: ['capabilities'],
    });

    // Get all ambulances
    const ambulances = await this.ambulanceRepository.find();

    return {
      stats: {
        totalUsers,
        totalHospitals,
        totalAmbulances,
        activeBookings,
        completedToday,
        emergenciesHandled,
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
      relations: ['profile'],
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
          dropoffLocation: d.booking.destinationAddress || d.hospital?.name || 'Hospital',
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
        dropoffLocation: b.destinationAddress,
        bookingType: b.severity === 'CRITICAL' || b.severity === 'HIGH' ? 'EMERGENCY' : 'SCHEDULED',
        severity: b.severity,
        status: b.status,
        createdAt: b.createdAt,
        description: b.description,
        dispatch: dispatch ? {
          status: dispatch.status || b.status,
          ambulance: dispatch.ambulance ? {
            vehicleNumber: dispatch.ambulance.vehicleNumber,
            type: dispatch.ambulance.type,
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
