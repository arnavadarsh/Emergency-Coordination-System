import { randomBytes } from 'crypto';
import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { TrackingLink } from './entities/tracking-link.entity';
import { TrackingNotification } from './entities/tracking-notification.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { EmergencyContact } from '../users/entities/emergency-contact.entity';
import { BookingStatus, UserRole } from '../common/enums';
import { estimateMinutes, haversineKm } from '../common/geo';
import {
  PublicTrackingView,
  TrackingStage,
  TrackingStageCode,
} from './tracking.types';

const STAGES: Record<TrackingStageCode, Omit<TrackingStage, 'totalSteps'>> = {
  ASSIGNED: {
    code: 'ASSIGNED',
    label: 'Ambulance assigned',
    description: 'An ambulance has been assigned and is preparing to move.',
    step: 1,
  },
  EN_ROUTE_PICKUP: {
    code: 'EN_ROUTE_PICKUP',
    label: 'On the way to the patient',
    description: 'The ambulance is travelling to the patient right now.',
    step: 2,
  },
  AT_PICKUP: {
    code: 'AT_PICKUP',
    label: 'With the patient',
    description: 'The crew has reached the patient and is preparing to move them.',
    step: 3,
  },
  EN_ROUTE_HOSPITAL: {
    code: 'EN_ROUTE_HOSPITAL',
    label: 'On the way to hospital',
    description: 'The patient is on board and the ambulance is heading to hospital.',
    step: 4,
  },
  AT_HOSPITAL: {
    code: 'AT_HOSPITAL',
    label: 'Arrived at hospital',
    description: 'The ambulance has reached the hospital and is handing over.',
    step: 5,
  },
};

const TOTAL_STAGE_STEPS = 5;

/**
 * Tracking Service
 *
 * Owns the private, login-free link that lets a family member watch an
 * ambulance without an account, an app, or a phone call to anyone.
 *
 * Two rules shape everything here:
 *
 *   1. The link shows the response, not the patient. No name, no phone number,
 *      no triage answer, no severity, no medical profile ever reaches the public
 *      view — only the ambulance, the stage, the ETA and the hospital.
 *   2. The link is live only while the case is. Every read re-checks the booking
 *      and the dispatch, so a completed or cancelled case goes dark immediately
 *      even if no close hook ever ran.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectRepository(TrackingLink)
    private readonly linkRepository: Repository<TrackingLink>,
    @InjectRepository(TrackingNotification)
    private readonly notificationRepository: Repository<TrackingNotification>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch)
    private readonly dispatchRepository: Repository<Dispatch>,
    @InjectRepository(EmergencyContact)
    private readonly contactRepository: Repository<EmergencyContact>,
    private readonly configService: ConfigService,
  ) {}

  // ── Link lifecycle ────────────────────────────────────────────────────────

  /**
   * Mint (or return) the tracking link for a case.
   *
   * Called the moment an ambulance is assigned. Idempotent by booking: a case
   * has exactly one link for its whole life, so a re-dispatch or a retried event
   * never invalidates a link that has already been texted out.
   */
  async issueForCase(bookingId: string, dispatchId?: string | null): Promise<TrackingLink> {
    const existing = await this.linkRepository.findOne({ where: { bookingId } });
    if (existing) {
      // A re-dispatch keeps the same link but should point at the current run.
      if (dispatchId && existing.dispatchId !== dispatchId) {
        existing.dispatchId = dispatchId;
        await this.linkRepository.save(existing);
      }
      return existing;
    }

    const ttlHours = this.configService.get<number>('tracking.linkTtlHours', 24);
    const link = this.linkRepository.create({
      token: randomBytes(24).toString('base64url'),
      bookingId,
      dispatchId: dispatchId ?? null,
      expiresAt: new Date(Date.now() + ttlHours * 3600_000),
    });

    try {
      return await this.linkRepository.save(link);
    } catch (error) {
      // Another dispatch event won the race — use the link it created rather
      // than handing out a second one for the same case.
      const raced = await this.linkRepository.findOne({ where: { bookingId } });
      if (raced) return raced;
      throw error;
    }
  }

  /** The address a family member opens. `contactToken` carries the opt-out identity. */
  buildPublicUrl(link: TrackingLink, contactToken?: string | null): string {
    const base = this.configService.get<string>('tracking.publicBaseUrl', 'http://localhost:3001/track');
    const url = `${base}/${link.token}`;
    return contactToken ? `${url}?c=${contactToken}` : url;
  }

  /**
   * Stop a link working, because the case ended or the patient revoked it.
   * Safe to call more than once, and safe to call for a case with no link.
   */
  async closeForBooking(bookingId: string, reason: 'COMPLETED' | 'CANCELLED' | 'REVOKED'): Promise<void> {
    const result = await this.linkRepository.update(
      { bookingId, closedAt: IsNull() },
      { closedAt: new Date(), closeReason: reason },
    );
    if (result.affected) {
      this.logger.log(`[tracking] Link closed for booking ${bookingId} (${reason})`);
    }
  }

  // ── Public view ───────────────────────────────────────────────────────────

  /**
   * Build the anonymous live view for a token, or refuse it.
   *
   * Throws NotFoundException for a token that was never valid, and
   * GoneException once the case is over — the link genuinely stops working
   * rather than freezing on a stale last position.
   */
  async getPublicView(token: string): Promise<PublicTrackingView> {
    const link = await this.linkRepository.findOne({ where: { token } });
    if (!link) {
      throw new NotFoundException('This tracking link is not valid.');
    }

    const booking = await this.bookingRepository.findOne({ where: { id: link.bookingId } });
    if (!booking) {
      throw new NotFoundException('This tracking link is not valid.');
    }

    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId: link.bookingId },
      relations: ['ambulance', 'hospital'],
      order: { createdAt: 'DESC' },
    });

    const hospitalName = dispatch?.hospital?.name ?? booking.destinationAddress ?? null;
    this.assertStillLive(link, booking, dispatch, hospitalName);

    if (!dispatch) {
      // A link only exists once an ambulance was assigned, so this means the
      // dispatch row is gone — nothing left to track.
      throw new GoneException({
        statusCode: 410,
        status: 'ENDED',
        reason: 'REVOKED',
        message: 'This tracking link is no longer active.',
      });
    }

    await this.recordView(link);

    return this.buildView(booking, dispatch, hospitalName);
  }

  /**
   * The single gate on whether a link still works. Checked on every read so a
   * missed close hook cannot leave a case exposed.
   */
  private assertStillLive(
    link: TrackingLink,
    booking: Booking,
    dispatch: Dispatch | null,
    hospitalName: string | null,
  ): void {
    const ended = (
      reason: 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'REVOKED',
      message: string,
    ): never => {
      throw new GoneException({
        statusCode: 410,
        status: 'ENDED',
        reason,
        message,
        // Only for a completed trip, and only the hospital — the same fact the
        // page has been showing all along, so a relative who opens the message
        // late still knows where to go.
        hospitalName: reason === 'COMPLETED' ? hospitalName : null,
      });
    };

    if (booking.status === BookingStatus.COMPLETED || dispatch?.status === 'COMPLETED') {
      ended('COMPLETED', 'This case has ended. The ambulance completed its trip.');
    }

    if (booking.status === BookingStatus.CANCELLED || dispatch?.status === 'CANCELLED') {
      ended('CANCELLED', 'This case was cancelled, so tracking has stopped.');
    }

    if (link.closedAt) {
      const reason = link.closeReason === 'COMPLETED' || link.closeReason === 'CANCELLED'
        ? link.closeReason
        : 'REVOKED';
      ended(reason, 'This tracking link is no longer active.');
    }

    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
      ended('EXPIRED', 'This tracking link has expired.');
    }
  }

  /**
   * Note that somebody opened the page, at most once a minute per link. The
   * page polls continuously, and the patient only needs to know that family
   * followed the ambulance — not every poll.
   */
  private async recordView(link: TrackingLink): Promise<void> {
    const now = Date.now();
    if (link.lastViewedAt && now - new Date(link.lastViewedAt).getTime() < 60_000) return;

    link.lastViewedAt = new Date(now);
    link.viewCount += 1;
    await this.linkRepository.save(link).catch(error => {
      // Bookkeeping must never break the live view.
      this.logger.warn(`[tracking] Could not record view for link ${link.id}: ${error.message}`);
    });
  }

  private buildView(booking: Booking, dispatch: Dispatch, hospitalName: string | null): PublicTrackingView {
    const stageCode = this.toStageCode(dispatch.status ?? booking.status);
    const stage: TrackingStage = { ...STAGES[stageCode], totalSteps: TOTAL_STAGE_STEPS };

    const ambulanceLat = this.toNumber(dispatch.ambulance?.currentLatitude);
    const ambulanceLng = this.toNumber(dispatch.ambulance?.currentLongitude);
    const hasAmbulanceLocation = ambulanceLat !== null && ambulanceLng !== null;

    const hospitalLat = this.toNumber(dispatch.hospital?.latitude ?? booking.destinationLatitude);
    const hospitalLng = this.toNumber(dispatch.hospital?.longitude ?? booking.destinationLongitude);

    // Before the patient is on board the ambulance is heading to them; after,
    // to the hospital. The pickup point is exposed only for that first leg, and
    // never as an address — a coordinate the map needs, not the patient's home.
    const headingToHospital = stageCode === 'EN_ROUTE_HOSPITAL' || stageCode === 'AT_HOSPITAL' || stageCode === 'AT_PICKUP';
    const pickupLat = this.toNumber(booking.pickupLatitude);
    const pickupLng = this.toNumber(booking.pickupLongitude);

    let target: PublicTrackingView['target'] = null;
    if (headingToHospital && hospitalLat !== null && hospitalLng !== null) {
      target = {
        kind: 'HOSPITAL',
        label: hospitalName || 'Destination hospital',
        latitude: hospitalLat,
        longitude: hospitalLng,
      };
    } else if (!headingToHospital && pickupLat !== null && pickupLng !== null) {
      target = {
        kind: 'PICKUP',
        label: 'Patient location',
        latitude: pickupLat,
        longitude: pickupLng,
      };
    }

    return {
      caseReference: `ECS-${booking.id.slice(0, 8).toUpperCase()}`,
      stage,
      ambulance: {
        vehicleNumber: dispatch.ambulance?.vehicleNumber ?? null,
        location: hasAmbulanceLocation ? { latitude: ambulanceLat!, longitude: ambulanceLng! } : null,
        locationUpdatedAt: this.toIso(dispatch.ambulance?.lastLocationUpdate),
      },
      target,
      hospital: hospitalName
        ? {
            name: hospitalName,
            address: dispatch.hospital?.address ?? null,
            location: hospitalLat !== null && hospitalLng !== null
              ? { latitude: hospitalLat, longitude: hospitalLng }
              : null,
          }
        : null,
      eta: this.buildEta(stageCode, dispatch, target, ambulanceLat, ambulanceLng),
      timeline: {
        assignedAt: this.toIso(dispatch.dispatchedAt),
        arrivedAtPickupAt: this.toIso(dispatch.arrivedAtPickup),
        departedPickupAt: this.toIso(dispatch.departedPickup),
        arrivedAtHospitalAt: this.toIso(dispatch.arrivedAtHospital),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * ETA to whatever the ambulance is currently heading for.
   *
   * Straight-line at an assumed road speed — the same estimate the patient's own
   * tracking view shows, so the family and the patient never see two different
   * numbers. Falls back to the dispatch estimate while the ambulance has not
   * reported a position yet.
   */
  private buildEta(
    stageCode: TrackingStageCode,
    dispatch: Dispatch,
    target: PublicTrackingView['target'],
    ambulanceLat: number | null,
    ambulanceLng: number | null,
  ): PublicTrackingView['eta'] {
    const label = stageCode === 'EN_ROUTE_HOSPITAL' || stageCode === 'AT_PICKUP'
      ? 'Reaching the hospital'
      : 'Reaching the patient';

    if (stageCode === 'AT_HOSPITAL') {
      return { minutes: 0, text: 'Arrived', expectedArrivalIso: null, label: 'At the hospital' };
    }

    let minutes: number | null = null;
    if (target && ambulanceLat !== null && ambulanceLng !== null) {
      minutes = estimateMinutes(haversineKm(ambulanceLat, ambulanceLng, target.latitude, target.longitude));
    } else if (dispatch.estimatedPickupTime != null && stageCode !== 'EN_ROUTE_HOSPITAL') {
      minutes = dispatch.estimatedPickupTime;
    } else if (dispatch.estimatedHospitalTime != null) {
      minutes = dispatch.estimatedHospitalTime;
    }

    return {
      minutes,
      text: minutes == null ? 'Calculating…' : `${minutes} min`,
      expectedArrivalIso: minutes == null ? null : new Date(Date.now() + minutes * 60_000).toISOString(),
      label,
    };
  }

  /** Dispatch/booking statuses collapse into the five stages a family sees. */
  private toStageCode(status: string): TrackingStageCode {
    switch (status) {
      case 'EN_ROUTE':
      case 'EN_ROUTE_PICKUP':
      case 'IN_PROGRESS':
        return 'EN_ROUTE_PICKUP';
      case 'AT_PICKUP':
        return 'AT_PICKUP';
      case 'EN_ROUTE_HOSPITAL':
        return 'EN_ROUTE_HOSPITAL';
      case 'AT_HOSPITAL':
        return 'AT_HOSPITAL';
      default:
        return 'ASSIGNED';
    }
  }

  /** Numeric columns come back from postgres as strings. */
  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toIso(value: Date | null | undefined): string | null {
    return value ? new Date(value).toISOString() : null;
  }

  // ── Sharing from the app ──────────────────────────────────────────────────

  /**
   * The link, plus who has already been told, for the patient's own share sheet.
   * Only the patient who raised the case (or an admin) may ask.
   */
  async getShareInfo(bookingId: string, requester: { id: string; role: UserRole }): Promise<{
    available: boolean;
    reason?: string;
    url?: string;
    expiresAt?: string;
    viewCount?: number;
    lastViewedAt?: string | null;
    notifiedContacts?: { name: string; relation: string; status: string; sentAt: string | null }[];
  }> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (requester.role !== UserRole.ADMIN && booking.userId !== requester.id) {
      throw new ForbiddenException('You can only share your own cases');
    }

    const link = await this.linkRepository.findOne({ where: { bookingId } });
    if (!link) {
      return { available: false, reason: 'NO_AMBULANCE_ASSIGNED' };
    }
    if (link.closedAt || new Date(link.expiresAt).getTime() <= Date.now()) {
      return { available: false, reason: 'CASE_ENDED' };
    }

    return {
      available: true,
      url: this.buildPublicUrl(link),
      expiresAt: new Date(link.expiresAt).toISOString(),
      viewCount: link.viewCount,
      lastViewedAt: this.toIso(link.lastViewedAt),
      notifiedContacts: await this.summariseNotifications(bookingId),
    };
  }

  /** Who was texted for this case, for the patient's reassurance. */
  private async summariseNotifications(bookingId: string) {
    const notifications = await this.notificationRepository.find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
    if (notifications.length === 0) return [];

    const contacts = await this.contactRepository.find({
      where: { id: In(notifications.map(notification => notification.contactId)) },
    });
    const byId = new Map(contacts.map(contact => [contact.id, contact]));

    return notifications.map(notification => {
      const contact = byId.get(notification.contactId);
      return {
        name: contact?.name ?? 'Contact',
        relation: contact?.relation ?? '',
        status: notification.status,
        sentAt: this.toIso(notification.sentAt),
      };
    });
  }
}
