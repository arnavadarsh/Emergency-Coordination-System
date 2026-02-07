import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from './entities';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { BookingStatus, SeverityLevel, UserRole, AmbulanceStatus } from '../common/enums';

/**
 * Bookings Service
 * Booking management with CRUD operations and auto-dispatch
 */
@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
  ) {}

  /**
   * Find all bookings
   */
  async findAll(): Promise<Booking[]> {
    return this.bookingRepository.find({
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

    // Create dispatch
    const dispatch = this.dispatchRepository.create({
      bookingId: booking.id,
      ambulanceId: nearestAmbulance.id,
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
    if (booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.CANCELLED) {
      throw new ForbiddenException('Cannot cancel a completed or already cancelled booking');
    }

    booking.status = BookingStatus.CANCELLED;
    booking.cancelledAt = new Date();
    return this.bookingRepository.save(booking);
  }
}
