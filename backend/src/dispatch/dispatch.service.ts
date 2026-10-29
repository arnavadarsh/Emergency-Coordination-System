import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Dispatch } from './entities';
import { Booking } from '../bookings/entities/booking.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { UserRole, BookingStatus, AmbulanceStatus } from '../common/enums';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackingService } from '../tracking/tracking.service';
import { CaseAccessService } from '../access/case-access.service';
import { canonicalDispatchStatus, checkDriverTransition, isKnownDispatchStatus } from './dispatch-status';

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
    private readonly realtimeGateway: RealtimeGateway,
    private readonly trackingService: TrackingService,
    private readonly caseAccess: CaseAccessService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Admins see every dispatch; a hospital only the ones coming to it.
   */
  async findAll(user: any): Promise<Dispatch[]> {
    if (user.role !== UserRole.ADMIN && !user.hospitalId) return [];
    return this.dispatchRepository.find({
      where: user.role === UserRole.ADMIN ? undefined : { hospitalId: user.hospitalId },
      relations: ['booking', 'ambulance', 'hospital'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * One dispatch, for its driver, its receiving hospital, or an admin.
   */
  async findById(id: string, user: any): Promise<Dispatch> {
    const { dispatch } = await this.caseAccess.assertDispatchAccess(user, id);
    return dispatch;
  }

  /**
   * The driver's own trips: ones they claimed, and unclaimed ones given to the
   * ambulance they drive.
   */
  async findByDriver(user: any): Promise<Dispatch[]> {
    const where: any[] = [{ driverId: user.id }];
    if (user.ambulanceId) where.push({ driverId: IsNull(), ambulanceId: user.ambulanceId });
    return this.dispatchRepository.find({
      where,
      relations: ['booking', 'ambulance', 'hospital'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Edit a dispatch. The assigned driver and the receiving hospital may add
   * notes; a driver's status change goes through the same ordered flow as the
   * status endpoint. Only an admin may override a status directly.
   */
  async update(id: string, data: { status?: string; notes?: string }, user: any): Promise<Dispatch> {
    const { dispatch, role } = await this.caseAccess.assertDispatchAccess(user, id);

    if (data.status && role === 'driver') {
      if (data.notes) {
        dispatch.notes = data.notes;
        await this.dispatchRepository.save(dispatch);
      }
      return this.updateStatus(id, data.status, user);
    }
    if (data.status && role !== 'admin') {
      throw new ForbiddenException('Only the assigned driver or an admin can change a trip status');
    }

    if (data.notes) {
      dispatch.notes = data.notes;
    }

    if (data.status) {
      if (!isKnownDispatchStatus(data.status)) {
        throw new BadRequestException(`Unknown dispatch status "${data.status}"`);
      }
      return this.applyStatus(dispatch, canonicalDispatchStatus(data.status));
    }

    return this.dispatchRepository.save(dispatch);
  }

  /**
   * The driver moves their trip on one stage.
   *
   * Only the driver assigned to this dispatch may, and only to the next stage:
   * any driver could previously set any status on any trip, in any order.
   */
  async updateStatus(id: string, status: string, user: any): Promise<Dispatch> {
    const dispatch = await this.dispatchRepository.findOne({
      where: { id },
      relations: ['booking', 'ambulance', 'hospital'],
    });
    if (!dispatch || !this.caseAccess.isAssignedDriver(user, dispatch)) {
      // Same answer for "no such trip" and "not your trip".
      throw new NotFoundException('Dispatch not found');
    }

    if (dispatch.booking?.status === BookingStatus.CANCELLED) {
      throw new ConflictException('This case was cancelled.');
    }

    const check = checkDriverTransition(dispatch.status, status);
    if (!check.ok) {
      throw new ConflictException(check.reason);
    }
    if (check.noop) {
      return dispatch;
    }

    // The first driver to act on the trip owns it from here on, so a second
    // driver sharing the ambulance cannot also drive it forward.
    if (!dispatch.driverId) {
      dispatch.driverId = user.id;
    }

    return this.applyStatus(dispatch, check.status);
  }

  /**
   * Record a status and everything that follows from it: the stage
   * timestamps, the booking and ambulance states, the tracking link, and the
   * live update to the people on the case.
   */
  private async applyStatus(dispatch: Dispatch, status: string): Promise<Dispatch> {
    dispatch.status = status;
    this.updateTimestamps(dispatch, status);

    // Update booking status based on dispatch status
    if (dispatch.bookingId) {
      await this.updateBookingStatus(dispatch.bookingId, status);
    }

    // Update ambulance status
    if (dispatch.ambulanceId) {
      await this.updateAmbulanceStatus(dispatch.ambulanceId, status);
    }

    const savedDispatch = await this.dispatchRepository.save(dispatch);

    // Once the case is over the shared tracking link stops working, for the
    // family and for anyone the link was forwarded to.
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      await this.trackingService.closeForBooking(savedDispatch.bookingId, status);
    }

    this.realtimeGateway.emitToCase(
      {
        patientId: savedDispatch.booking?.userId,
        ambulanceId: savedDispatch.ambulanceId,
        driverId: savedDispatch.driverId,
        hospitalIds: [savedDispatch.hospitalId],
      },
      'dispatch_status_updated',
      {
        dispatchId: savedDispatch.id,
        bookingId: savedDispatch.bookingId,
        ambulanceId: savedDispatch.ambulanceId,
        status: savedDispatch.status,
        completedAt: savedDispatch.completedAt,
      },
    );

    return savedDispatch;
  }

  /**
   * Update booking status based on dispatch status
   */
  private async updateBookingStatus(bookingId: string, dispatchStatus: string): Promise<void> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) return;

    switch (dispatchStatus) {
      case 'EN_ROUTE_PICKUP':
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
      case 'EN_ROUTE_PICKUP':
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

    // A booking may be waiting for exactly this unit — the retry worker
    // dispatches it straight away instead of on its next timed pass.
    if (ambulance.status === AmbulanceStatus.AVAILABLE) {
      this.eventEmitter.emit('ambulance.available', ambulance.id);
    }
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
