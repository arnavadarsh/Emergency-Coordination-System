import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TrackingLink } from './entities/tracking-link.entity';
import { TrackingNotification } from './entities/tracking-notification.entity';
import { EmergencyContact } from '../users/entities/emergency-contact.entity';
import { User } from '../users/entities/user.entity';
import { SmsService } from '../notifications/sms.service';
import { TrackingService } from './tracking.service';

/**
 * Tracking Notifier
 *
 * Tells a patient's emergency contacts that help is on the way, the moment an
 * ambulance is assigned — so nobody at the scene has to stop and make phone
 * calls, and relatives can follow the ambulance themselves.
 *
 * The guarantees it is built around:
 *
 *   - **Once per case.** The (booking, contact) row is written before the
 *     message is handed to the gateway, so a retried or duplicated dispatch
 *     event cannot text a family member twice about the same emergency.
 *   - **Opt-outs are honoured.** A contact who has opted out is never messaged
 *     again, for this case or any future one.
 *   - **Never blocks a dispatch.** Every failure is caught and recorded. An SMS
 *     gateway being down must not stop an ambulance being sent.
 */
@Injectable()
export class TrackingNotifierService {
  private readonly logger = new Logger(TrackingNotifierService.name);

  constructor(
    @InjectRepository(EmergencyContact)
    private readonly contactRepository: Repository<EmergencyContact>,
    @InjectRepository(TrackingNotification)
    private readonly notificationRepository: Repository<TrackingNotification>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly smsService: SmsService,
    private readonly trackingService: TrackingService,
  ) {}

  /**
   * Alert every eligible emergency contact for this case.
   *
   * Returns a small tally rather than throwing: the caller is an in-flight
   * dispatch, and its job is done whether or not the family could be reached.
   */
  async notifyContactsForCase(
    patientId: string,
    bookingId: string,
    link: TrackingLink,
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    const tally = { sent: 0, skipped: 0, failed: 0 };

    const contacts = await this.contactRepository.find({
      where: { userId: patientId, notifyBySms: true, optedOutAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    if (contacts.length === 0) {
      this.logger.log(`[tracking] No emergency contacts to alert for booking ${bookingId}`);
      return tally;
    }

    const patient = await this.userRepository.findOne({ where: { id: patientId } });
    const patientName = this.patientFirstName(patient);

    for (const contact of contacts) {
      const phoneNumber = this.smsService.normalizeNumber(contact.phoneNumber);
      if (!phoneNumber) {
        this.logger.warn(
          `[tracking] Skipping contact ${contact.id}: "${contact.phoneNumber}" is not a usable phone number`,
        );
        tally.skipped += 1;
        continue;
      }

      // Claim this contact for this case first. A unique index on
      // (booking_id, contact_id) makes the claim atomic, so a concurrent
      // dispatch event loses the race here instead of sending a second SMS.
      let record: TrackingNotification;
      try {
        record = await this.notificationRepository.save(
          this.notificationRepository.create({
            bookingId,
            contactId: contact.id,
            trackingLinkId: link.id,
            phoneNumber,
            channel: 'SMS',
            status: 'QUEUED',
            provider: this.smsService.providerName,
          }),
        );
      } catch (error: any) {
        // Almost always the unique constraint doing its job. Any other write
        // failure lands here too, and skipping is still the right call: a
        // duplicate alert during an emergency is worse than a missed one.
        this.logger.log(
          `[tracking] Not alerting contact ${contact.id} for booking ${bookingId} ` +
            `(already claimed, or the claim failed: ${error?.message ?? error})`,
        );
        tally.skipped += 1;
        continue;
      }

      const body = this.composeMessage(patientName, this.trackingService.buildPublicUrl(link, contact.optOutToken));

      try {
        const result = await this.smsService.send({ to: phoneNumber, body });
        record.status = 'SENT';
        record.sentAt = new Date();
        record.provider = result.provider;
        record.providerMessageId = result.providerMessageId;
        await this.notificationRepository.save(record);

        contact.lastNotifiedAt = record.sentAt;
        await this.contactRepository.save(contact);

        tally.sent += 1;
      } catch (error: any) {
        record.status = 'FAILED';
        record.error = String(error?.message ?? error).slice(0, 500);
        await this.notificationRepository.save(record);
        this.logger.error(`[tracking] Could not alert contact ${contact.id} for booking ${bookingId}: ${record.error}`);
        tally.failed += 1;
      }
    }

    this.logger.log(
      `[tracking] Emergency contact alerts for booking ${bookingId}: ` +
        `${tally.sent} sent, ${tally.skipped} skipped, ${tally.failed} failed`,
    );
    return tally;
  }

  /**
   * The message itself. Kept to the point: what happened, the link, and how to
   * stop future messages.
   *
   * The patient's first name is included here — unlike on the tracking page,
   * which any onward recipient of the link can open. These messages go only to
   * the contacts the patient chose, and a text that does not say who it is about
   * is useless to a relative. Nothing about their condition is included.
   */
  private composeMessage(patientName: string, url: string): string {
    const subject = patientName ? `for ${patientName}` : 'for someone who listed you as an emergency contact';
    return (
      `ECS Emergency: an ambulance has been dispatched ${subject}. ` +
      `Follow it live — no app or login needed: ${url} ` +
      `The link stops working when the case ends. Tap "Stop alerts" on that page to opt out.`
    );
  }

  private patientFirstName(patient: User | null): string {
    if (!patient) return '';
    return (patient.firstName || '').trim() || (patient.lastName || '').trim() || '';
  }

  // ── Contact-side opt-out ──────────────────────────────────────────────────

  /** Whether this contact is currently subscribed. Drives the page's control. */
  async getOptOutState(optOutToken: string): Promise<{ optedOut: boolean }> {
    const contact = await this.requireContactByToken(optOutToken);
    return { optedOut: contact.optedOutAt !== null };
  }

  /**
   * The contact's own switch, exercised from the tracking page without a login.
   *
   * Opting out is permanent until the same person opts back in from the same
   * link — the patient cannot undo it by editing the contact, which is what
   * makes it a real unsubscribe rather than a suggestion.
   */
  async setOptOut(optOutToken: string, optOut: boolean): Promise<{ optedOut: boolean }> {
    const contact = await this.requireContactByToken(optOutToken);
    contact.optedOutAt = optOut ? (contact.optedOutAt ?? new Date()) : null;
    await this.contactRepository.save(contact);
    this.logger.log(`[tracking] Contact ${contact.id} ${optOut ? 'opted out of' : 'resubscribed to'} future alerts`);
    return { optedOut: contact.optedOutAt !== null };
  }

  private async requireContactByToken(optOutToken: string): Promise<EmergencyContact> {
    const contact = await this.contactRepository.findOne({ where: { optOutToken } });
    if (!contact) {
      throw new NotFoundException('This alert preference link is not valid.');
    }
    return contact;
  }
}
