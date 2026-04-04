import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking } from './entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { TriageReport, EmergencyType } from '../triage/entities/triage.entity';
import { User } from '../users/entities/user.entity';
import { BookingStatus, SeverityLevel, UserRole, AmbulanceStatus } from '../common/enums';
import { FindBookingsDto } from './dto/find-bookings.dto';
import { CreateEmergencyBookingDto } from './dto/create-emergency-booking.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * Bookings Service
 * Booking management with CRUD operations and auto-dispatch
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(Hospital)
    private hospitalRepository: Repository<Hospital>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createEmergencyBooking(createBookingDto: CreateEmergencyBookingDto): Promise<{ bookingId: string; status: BookingStatus }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { userId, location, emergencyType, answers } = createBookingDto;

      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const triageReport = new TriageReport();
      triageReport.emergencyType = emergencyType as EmergencyType;
      triageReport.breathing = answers.breathing === 'true';
      triageReport.bleeding = answers.bleeding === 'true';
      triageReport.conscious = answers.conscious === 'true';
      triageReport.painLevel = answers.painLevel;
      triageReport.pregnancy = answers.pregnancy || false;

      const savedTriageReport = await queryRunner.manager.save(triageReport);

      const booking = new Booking();
      booking.userId = userId;
      booking.pickupLatitude = location.lat;
      booking.pickupLongitude = location.lng;
      booking.status = BookingStatus.PENDING;
      booking.triageReport = savedTriageReport;

      const savedBooking = await queryRunner.manager.save(booking);

      await queryRunner.commitTransaction();

      this.logger.log(`New emergency booking created: ${savedBooking.id}`);
      this.realtimeGateway.server.emit('booking_created', savedBooking);
      this.eventEmitter.emit('booking.created', savedBooking.id);

      return {
        bookingId: savedBooking.id,
        status: savedBooking.status,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to create emergency booking', error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Find all bookings
   */
  findAll(findBookingsDto: FindBookingsDto): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: findBookingsDto,
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find booking by ID
   */
  async findById(id: string): Promise<Booking | null> {
    return this.bookingRepository.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  /**
   * Find bookings by user
   */
  async findByUser(userId: string): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Create a new booking and auto-dispatch nearest ambulance
   */
  async create(userId: string, data: {
    pickupLatitude: number;
    pickupLongitude: number;
    pickupAddress: string;
    destinationLatitude?: number;
    destinationLongitude?: number;
    destinationAddress?: string;
    severity?: SeverityLevel;
    description?: string;
    bookingType?: string;
  }): Promise<Booking> {
    const booking = this.bookingRepository.create({
      userId,
      pickupLatitude: data.pickupLatitude,
      pickupLongitude: data.pickupLongitude,
      pickupAddress: data.pickupAddress,
      destinationLatitude: data.destinationLatitude,
      destinationLongitude: data.destinationLongitude,
      destinationAddress: data.destinationAddress,
      severity: data.severity || SeverityLevel.MEDIUM,
      description: data.description,
      status: BookingStatus.CREATED,
      bookingType: data.bookingType || 'EMERGENCY',
    });
    const savedBooking = await this.bookingRepository.save(booking);

    // Auto-dispatch: Find nearest available ambulance
    await this.autoDispatch(savedBooking);

    return savedBooking;
  }

  /**
   * Auto-dispatch nearest available ambulance to booking
   */
  private async autoDispatch(booking: Booking): Promise<void> {
    // Find all available ambulances with location
    const availableAmbulances = await this.ambulanceRepository.find({
      where: { status: AmbulanceStatus.AVAILABLE },
    });

    if (availableAmbulances.length === 0) {
      console.log('No available ambulances for booking:', booking.id);
      return;
    }

    // Find nearest ambulance using Haversine formula
    let nearestAmbulance = availableAmbulances[0];
    let minDistance = this.calculateDistance(
      booking.pickupLatitude,
      booking.pickupLongitude,
      nearestAmbulance.currentLatitude || booking.pickupLatitude,
      nearestAmbulance.currentLongitude || booking.pickupLongitude,
    );

    for (const ambulance of availableAmbulances) {
      if (ambulance.currentLatitude && ambulance.currentLongitude) {
        const distance = this.calculateDistance(
          booking.pickupLatitude,
          booking.pickupLongitude,
          ambulance.currentLatitude,
          ambulance.currentLongitude,
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearestAmbulance = ambulance;
        }
      }
    }

    // Find nearest active hospital with available beds.
    const hospitals = await this.hospitalRepository.find();

    let selectedHospital: Hospital | null = null;
    let minHospitalDistance = Number.MAX_VALUE;

    for (const hospital of hospitals) {
      if ((hospital.availableBeds || 0) <= 0) continue;
      const distance = this.calculateDistance(
        booking.pickupLatitude,
        booking.pickupLongitude,
        Number(hospital.latitude),
        Number(hospital.longitude),
      );
      if (distance < minHospitalDistance) {
        minHospitalDistance = distance;
        selectedHospital = hospital;
      }
    }

    if (selectedHospital) {
      booking.destinationLatitude = Number(selectedHospital.latitude);
      booking.destinationLongitude = Number(selectedHospital.longitude);
      booking.destinationAddress = selectedHospital.name;
    }

    // Create dispatch
    const dispatch = this.dispatchRepository.create({
      bookingId: booking.id,
      ambulanceId: nearestAmbulance.id,
      hospitalId: selectedHospital?.id,
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
      estimatedPickupTime: Math.round(minDistance * 3), // Rough ETA: 3 min per km
    });
    await this.dispatchRepository.save(dispatch);

    // Update ambulance status
    nearestAmbulance.status = AmbulanceStatus.BUSY;
    await this.ambulanceRepository.save(nearestAmbulance);

    // Update booking status
    booking.status = BookingStatus.ASSIGNED;
    await this.bookingRepository.save(booking);

    // Notify connected dashboards (driver/admin/hospital) immediately
    this.realtimeGateway.server.emit('dispatch_assigned', {
      dispatchId: dispatch.id,
      bookingId: booking.id,
      ambulanceId: nearestAmbulance.id,
      hospitalId: selectedHospital?.id,
      hospitalName: selectedHospital?.name,
      status: dispatch.status,
      assignedAt: dispatch.dispatchedAt,
    });

    console.log(`Dispatched ambulance ${nearestAmbulance.vehicleNumber} to booking ${booking.id}`);
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Update a booking
   */
  async update(id: string, data: {
    status?: BookingStatus;
    description?: string;
  }, user: any): Promise<Booking> {
    const booking = await this.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Users can only update their own bookings
    if (user.role === UserRole.USER && booking.userId !== user.id) {
      throw new ForbiddenException('You can only update your own bookings');
    }

    if (data.status) {
      booking.status = data.status;
      if (data.status === BookingStatus.COMPLETED) {
        booking.completedAt = new Date();
      } else if (data.status === BookingStatus.CANCELLED) {
        booking.cancelledAt = new Date();
      }
    }

    if (data.description) {
      booking.description = data.description;
    }

    return this.bookingRepository.save(booking);
  }

  /**
   * Cancel a booking
   */
  async cancel(id: string, user: any): Promise<Booking> {
    const booking = await this.findById(id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Users can only cancel their own bookings
    if (user.role === UserRole.USER && booking.userId !== user.id) {
      throw new ForbiddenException('You can only cancel your own bookings');
    }

    // Can only cancel if not completed or already cancelled
    if (booking.status === BookingStatus.COMPLETED) {
      throw new ForbiddenException('Cannot cancel a completed booking');
    }

    // Idempotent cancel: return current state instead of throwing when already cancelled.
    if (booking.status === BookingStatus.CANCELLED) {
      return booking;
    }

    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    const savedBooking = await this.bookingRepository.save(booking);

    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId: id },
      order: { createdAt: 'DESC' },
    });

    if (dispatch && dispatch.status !== 'CANCELLED') {
      dispatch.status = 'CANCELLED';
      await this.dispatchRepository.save(dispatch);
    }

    if (dispatch?.ambulanceId) {
      const ambulance = await this.ambulanceRepository.findOne({
        where: { id: dispatch.ambulanceId },
      });
      if (ambulance && ambulance.status !== AmbulanceStatus.AVAILABLE) {
        ambulance.status = AmbulanceStatus.AVAILABLE;
        await this.ambulanceRepository.save(ambulance);
      }
    }

    return savedBooking;
  }

  /**
   * Get booking tracking information
   */
  async getTrackingInfo(id: string): Promise<any> {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Get dispatch information
    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId: id },
      relations: ['ambulance'],
      order: { createdAt: 'DESC' },
    });

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        severity: booking.severity,
        pickupLocation: {
          latitude: booking.pickupLatitude,
          longitude: booking.pickupLongitude,
          address: booking.pickupAddress,
        },
        destinationLocation: booking.destinationLatitude ? {
          latitude: booking.destinationLatitude,
          longitude: booking.destinationLongitude,
          address: booking.destinationAddress,
        } : null,
        createdAt: booking.createdAt,
        completedAt: booking.completedAt,
      },
      dispatch: dispatch ? {
        id: dispatch.id,
        status: dispatch.status,
        dispatchedAt: dispatch.dispatchedAt,
        arrivedAtPickup: dispatch.arrivedAtPickup,
        completedAt: dispatch.completedAt,
        estimatedPickupTime: dispatch.estimatedPickupTime,
        ambulance: dispatch.ambulance ? {
          id: dispatch.ambulance.id,
          vehicleNumber: dispatch.ambulance.vehicleNumber,
          vehicleType: dispatch.ambulance.vehicleType,
          currentLocation: {
            latitude: dispatch.ambulance.currentLatitude,
            longitude: dispatch.ambulance.currentLongitude,
          },
          status: dispatch.ambulance.status,
        } : null,
      } : null,
    };
  }

  /**
   * Get booking statistics for admin
   */
  async getBookingStats(): Promise<any> {
    const totalBookings = await this.bookingRepository.count();
    const completedBookings = await this.bookingRepository.count({
      where: { status: BookingStatus.COMPLETED },
    });
    const cancelledBookings = await this.bookingRepository.count({
      where: { status: BookingStatus.CANCELLED },
    });
    const activeBookings = await this.bookingRepository.count({
      where: [
        { status: BookingStatus.CREATED },
        { status: BookingStatus.ASSIGNED },
        { status: BookingStatus.IN_PROGRESS },
      ],
    });

    // Get bookings by severity
    const criticalBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.CRITICAL },
    });
    const highBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.HIGH },
    });
    const mediumBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.MEDIUM },
    });
    const lowBookings = await this.bookingRepository.count({
      where: { severity: SeverityLevel.LOW },
    });

    return {
      total: totalBookings,
      completed: completedBookings,
      cancelled: cancelledBookings,
      active: activeBookings,
      completionRate: totalBookings > 0 ? ((completedBookings / totalBookings) * 100).toFixed(2) : 0,
      bySeverity: {
        critical: criticalBookings,
        high: highBookings,
        medium: mediumBookings,
        low: lowBookings,
      },
    };
  }
}
