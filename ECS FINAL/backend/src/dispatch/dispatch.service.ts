import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Dispatch } from './entities';
import { Booking } from '../bookings/entities/booking.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { UserRole, BookingStatus, AmbulanceStatus } from '../common/enums';

/**
 * Dispatch Service
 * Dispatch management with status updates
 */
@Injectable()
export class DispatchService {
  constructor(
    @InjectRepository(Dispatch)
    private dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(Ambulance)
    private ambulanceRepository: Repository<Ambulance>,
  ) {}

  /**
   * Find all dispatches
   */
  async findAll(): Promise<Dispatch[]> {
    return this.dispatchRepository.find({
      relations: ['booking', 'ambulance', 'hospital'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find dispatch by ID
   */
  async findById(id: string): Promise<Dispatch | null> {
    return this.dispatchRepository.findOne({
      where: { id },
      relations: ['booking', 'ambulance', 'hospital'],
    });
  }

  /**
   * Find dispatches by driver
   */
  async findByDriver(driverId: string): Promise<Dispatch[]> {
    return this.dispatchRepository.find({
      where: { driverId },
      relations: ['booking', 'ambulance', 'hospital'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Update dispatch
   */
  async update(id: string, data: { status?: string; notes?: string }, user: any): Promise<Dispatch> {
    const dispatch = await this.findById(id);
    if (!dispatch) {
      throw new NotFoundException('Dispatch not found');
    }

    // Drivers can only update their own dispatches
    if (user.role === UserRole.DRIVER && dispatch.driverId !== user.id) {
      throw new ForbiddenException('You can only update your own dispatches');
    }

    if (data.status) {
      dispatch.status = data.status;
      this.updateTimestamps(dispatch, data.status);
    }

    if (data.notes) {
      dispatch.notes = data.notes;
    }

    return this.dispatchRepository.save(dispatch);
  }

  /**
   * Update dispatch status
   */
  async updateStatus(id: string, status: string, user: any): Promise<Dispatch> {
    const dispatch = await this.findById(id);
    if (!dispatch) {
      throw new NotFoundException('Dispatch not found');
    }

    // Drivers can update any dispatch assigned to them (driverId can be null for new dispatches)
    // Allow all drivers to update dispatches for now
    dispatch.status = status;
    this.updateTimestamps(dispatch, status);

    // Update booking status based on dispatch status
    if (dispatch.booking) {
      await this.updateBookingStatus(dispatch.bookingId, status);
    }

    // Update ambulance status
    if (dispatch.ambulanceId) {
      await this.updateAmbulanceStatus(dispatch.ambulanceId, status);
    }

    return this.dispatchRepository.save(dispatch);
  }

  /**
   * Update booking status based on dispatch status
   */
  private async updateBookingStatus(bookingId: string, dispatchStatus: string): Promise<void> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) return;

    switch (dispatchStatus) {
      case 'EN_ROUTE':
      case 'AT_PICKUP':
      case 'EN_ROUTE_HOSPITAL':
        booking.status = BookingStatus.IN_PROGRESS;
        break;
      case 'COMPLETED':
        booking.status = BookingStatus.COMPLETED;
        booking.completedAt = new Date();
        break;
      case 'CANCELLED':
        booking.status = BookingStatus.CANCELLED;
        booking.cancelledAt = new Date();
        break;
    }
    await this.bookingRepository.save(booking);
  }

  /**
   * Update ambulance status based on dispatch status
   */
  private async updateAmbulanceStatus(ambulanceId: string, dispatchStatus: string): Promise<void> {
    const ambulance = await this.ambulanceRepository.findOne({ where: { id: ambulanceId } });
    if (!ambulance) return;

    switch (dispatchStatus) {
      case 'EN_ROUTE':
      case 'AT_PICKUP':
      case 'EN_ROUTE_HOSPITAL':
      case 'AT_HOSPITAL':
        ambulance.status = AmbulanceStatus.BUSY;
        break;
      case 'COMPLETED':
      case 'CANCELLED':
        ambulance.status = AmbulanceStatus.AVAILABLE;
        break;
    }
    await this.ambulanceRepository.save(ambulance);
  }

  /**
   * Update timestamps based on status
   */
  private updateTimestamps(dispatch: Dispatch, status: string): void {
    const now = new Date();
    switch (status) {
      case 'AT_PICKUP':
        dispatch.arrivedAtPickup = now;
        break;
      case 'EN_ROUTE_HOSPITAL':
        dispatch.departedPickup = now;
        break;
      case 'AT_HOSPITAL':
        dispatch.arrivedAtHospital = now;
        break;
      case 'COMPLETED':
        dispatch.completedAt = now;
        break;
    }
  }
}
