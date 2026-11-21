import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { User } from '../users/entities/user.entity';
import { TrackingLink } from '../tracking/entities/tracking-link.entity';
import { CaseChatMessage } from '../realtime/entities/case-chat-message.entity';
import { BookingsService } from '../bookings/bookings.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { TrackingService } from '../tracking/tracking.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { AmbulanceStatus, BookingStatus } from '../common/enums';
import { haversineKm } from '../common/geo';
import { ACTIVE_DISPATCH_STATUSES } from '../dispatch/dispatch-status';
import { AdminAuditService } from './admin-audit.service';

type Actor = { id: string; role: string };

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Live case control: the queue of bookings nobody has been sent to, and the
 * overrides an operator needs when the automatic choice is wrong — send a
 * specific ambulance, swap the ambulance, change the hospital, force a status,
 * cancel, cut off the family tracking link, read the case chat.
 */
@Injectable()
export class AdminOperationsService {
  constructor(
    @InjectRepository(Booking) private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch) private readonly dispatchRepository: Repository<Dispatch>,
    @InjectRepository(Ambulance) private readonly ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(Hospital) private readonly hospitalRepository: Repository<Hospital>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(TrackingLink) private readonly linkRepository: Repository<TrackingLink>,
    @InjectRepository(CaseChatMessage) private readonly chatRepository: Repository<CaseChatMessage>,
    private readonly bookingsService: BookingsService,
    private readonly dispatchService: DispatchService,
    private readonly trackingService: TrackingService,
    private readonly settings: SystemSettingsService,
    private readonly audit: AdminAuditService,
  ) {}

  private patientName(user?: User | null): string {
    if (!user) return 'Patient';
    return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email?.split('@')[0] || 'Patient';
  }

  /**
   * Every open booking with no ambulance — including ones too old for the
   * retry worker, which only a person should decide about. Most urgent first.
   */
  async queue() {
    const waiting = await this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin(Dispatch, 'dispatch', 'dispatch.bookingId = booking.id')
      .leftJoinAndSelect('booking.user', 'user')
      .where('booking.status IN (:...statuses)', { statuses: [BookingStatus.PENDING, BookingStatus.CREATED] })
      .andWhere('dispatch.id IS NULL')
      .orderBy('booking.createdAt', 'ASC')
      .getMany();
    const available = await this.ambulanceRepository.count({ where: { status: AmbulanceStatus.AVAILABLE } });
    const maxAge = this.settings.get('dispatchRetryMaxAgeMinutes');

    const items = waiting
      .map(booking => {
        // A scheduled transport has only been waiting since the time it was wanted.
        const waitingSince = booking.scheduledTime ?? booking.createdAt;
        const waitingMinutes = Math.max(0, Math.round((Date.now() - new Date(waitingSince).getTime()) / 60000));
        return {
          id: booking.id,
          status: booking.status,
          severity: booking.severity,
          pickupAddress: booking.pickupAddress,
          patientName: this.patientName(booking.user),
          patientPhone: booking.user?.phoneNumber ?? null,
          createdAt: booking.createdAt,
          bookingType: booking.bookingType,
          scheduledTime: booking.scheduledTime ?? null,
          waitingMinutes,
          // Past this age the retry worker no longer sends anyone by itself.
          needsDecision: waitingMinutes >= maxAge,
        };
      })
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2) || b.waitingMinutes - a.waitingMinutes);

    return {
      items,
      availableAmbulances: available,
      autoDispatchEnabled: this.settings.get('autoDispatchEnabled'),
      retryMaxAgeMinutes: maxAge,
    };
  }

  /**
   * Everything the case control panel needs in one call: the booking, its
   * trip, the tracking link, and the units and hospitals it could be given,
   * nearest first.
   */
  async controls(bookingId: string) {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId }, relations: ['user'] });
    if (!booking) throw new NotFoundException('Booking not found');

    const [dispatch, link, chatMessages, ambulances, hospitals] = await Promise.all([
      this.dispatchRepository.findOne({ where: { bookingId }, relations: ['ambulance', 'hospital'], order: { createdAt: 'DESC' } }),
      this.linkRepository.findOne({ where: { bookingId } }),
      this.chatRepository.count({ where: [{ bookingId }, { roomId: bookingId }] }),
      this.ambulanceRepository.find({ where: { status: AmbulanceStatus.AVAILABLE } }),
      this.hospitalRepository.find({ order: { name: 'ASC' } }),
    ]);

    const pickup = { lat: Number(booking.pickupLatitude), lng: Number(booking.pickupLongitude) };
    const km = (lat: unknown, lng: unknown) =>
      lat != null && lng != null ? Math.round(haversineKm(pickup.lat, pickup.lng, Number(lat), Number(lng)) * 10) / 10 : null;
    const byDistance = <T extends { distanceKm: number | null }>(a: T, b: T) =>
      (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);

    return {
      booking: {
        id: booking.id,
        status: booking.status,
        severity: booking.severity,
        pickupAddress: booking.pickupAddress,
        destinationAddress: booking.destinationAddress,
        patientName: this.patientName(booking.user),
        patientPhone: booking.user?.phoneNumber ?? null,
        createdAt: booking.createdAt,
      },
      dispatch: dispatch ? {
        id: dispatch.id,
        status: dispatch.status,
        driverId: dispatch.driverId ?? null,
        ambulance: dispatch.ambulance ? { id: dispatch.ambulance.id, vehicleNumber: dispatch.ambulance.vehicleNumber } : null,
        hospital: dispatch.hospital ? { id: dispatch.hospital.id, name: dispatch.hospital.name } : null,
        dispatchedAt: dispatch.dispatchedAt,
      } : null,
      tracking: link ? {
        active: !link.closedAt && new Date(link.expiresAt).getTime() > Date.now(),
        closeReason: link.closeReason,
        expiresAt: link.expiresAt,
        viewCount: link.viewCount,
      } : null,
      chatMessages,
      availableAmbulances: ambulances
        .map(a => ({ id: a.id, vehicleNumber: a.vehicleNumber, vehicleType: a.vehicleType, distanceKm: km(a.currentLatitude, a.currentLongitude) }))
        .sort(byDistance),
      hospitals: hospitals
        .map(h => ({ id: h.id, name: h.name, status: h.status, availableBeds: h.availableBeds, distanceKm: km(h.latitude, h.longitude) }))
        .sort(byDistance),
    };
  }

  async dispatch(actor: Actor, bookingId: string, ambulanceId?: string) {
    const dispatch = await this.bookingsService.dispatchManually(bookingId, ambulanceId);
    await this.audit.record(actor.id, 'MANUAL_DISPATCH', 'Booking', bookingId, {
      after: { dispatchId: dispatch.id, ambulanceId: dispatch.ambulanceId, hospitalId: dispatch.hospitalId },
    });
    return dispatch;
  }

  async reassign(actor: Actor, dispatchId: string, ambulanceId: string) {
    const before = await this.dispatchRepository.findOne({ where: { id: dispatchId } });
    const dispatch = await this.bookingsService.reassignAmbulance(dispatchId, ambulanceId);
    await this.audit.record(actor.id, 'AMBULANCE_REASSIGNED', 'Dispatch', dispatchId, {
      before: { ambulanceId: before?.ambulanceId ?? null },
      after: { ambulanceId: dispatch.ambulanceId },
    });
    return dispatch;
  }

  async reroute(actor: Actor, dispatchId: string, hospitalId: string) {
    const before = await this.dispatchRepository.findOne({ where: { id: dispatchId } });
    const dispatch = await this.bookingsService.changeDestination(dispatchId, hospitalId);
    await this.audit.record(actor.id, 'DESTINATION_CHANGED', 'Dispatch', dispatchId, {
      before: { hospitalId: before?.hospitalId ?? null },
      after: { hospitalId: dispatch.hospitalId },
    });
    return dispatch;
  }

  /** Admin override of a trip status — out of order if need be. */
  async setStatus(actor: Actor, dispatchId: string, status: string) {
    const before = await this.dispatchRepository.findOne({ where: { id: dispatchId } });
    const dispatch = await this.dispatchService.update(dispatchId, { status }, actor);
    await this.audit.record(actor.id, 'DISPATCH_STATUS_OVERRIDDEN', 'Dispatch', dispatchId, {
      before: { status: before?.status ?? null },
      after: { status },
    });
    return dispatch;
  }

  async cancel(actor: Actor, bookingId: string) {
    const booking = await this.bookingsService.cancel(bookingId, actor);
    await this.audit.record(actor.id, 'BOOKING_CANCELLED', 'Booking', bookingId);
    return booking;
  }

  /** Stop the family tracking link working, without touching the case itself. */
  async revokeTracking(actor: Actor, bookingId: string) {
    const link = await this.linkRepository.findOne({ where: { bookingId, closedAt: IsNull() } });
    if (!link) throw new NotFoundException('This case has no active tracking link');
    await this.trackingService.closeForBooking(bookingId, 'REVOKED');
    await this.audit.record(actor.id, 'TRACKING_LINK_REVOKED', 'Booking', bookingId);
    return { message: 'The tracking link no longer works for anyone holding it.' };
  }

  /**
   * The patient–driver chat for a case, read-only. Private by nature, so each
   * read is written to the audit log.
   */
  async chat(actor: Actor, bookingId: string) {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    const messages = await this.chatRepository.find({
      where: [{ bookingId }, { roomId: bookingId }],
      order: { createdAt: 'ASC' },
    });
    await this.audit.record(actor.id, 'CASE_CHAT_VIEWED', 'Booking', bookingId);
    return messages.map(message => ({
      id: message.id,
      senderRole: message.senderRole,
      senderName: message.senderName,
      message: message.message,
      attachmentUrl: message.attachmentUrl ?? null,
      createdAt: message.createdAt,
    }));
  }

  /** Counts for the system panel. */
  async waitingCount(): Promise<number> {
    return this.bookingRepository
      .createQueryBuilder('booking')
      .leftJoin(Dispatch, 'dispatch', 'dispatch.bookingId = booking.id')
      .where('booking.status IN (:...statuses)', { statuses: [BookingStatus.PENDING, BookingStatus.CREATED] })
      .andWhere('dispatch.id IS NULL')
      .getCount();
  }

  async fleetCounts(): Promise<Record<string, number>> {
    const rows: { status: string; count: string }[] = await this.ambulanceRepository
      .createQueryBuilder('ambulance')
      .select('ambulance.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ambulance.status')
      .getRawMany();
    return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
  }

  /** Open trips right now. */
  async activeTripCount(): Promise<number> {
    return this.dispatchRepository.count({ where: { status: In(ACTIVE_DISPATCH_STATUSES) } });
  }
}
