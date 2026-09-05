import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { timestampColumnType } from '../../common/column-types';

/**
 * TrackingNotification entity
 *
 * One row per (case, contact) — the record that this contact has already been
 * told about this case. The unique index is what enforces "messaged once per
 * case": the row is inserted *before* the SMS is handed to the provider, so two
 * concurrent dispatch events cannot both get past it and double-text a family
 * member during an emergency.
 *
 * A FAILED row therefore also blocks a retry. That is deliberate for now: a
 * duplicate alert is worse than a missed one here, and the patient can still
 * share the link by hand from the app.
 */
@Entity('tracking_notifications')
@Index(['bookingId', 'contactId'], { unique: true })
@Index(['bookingId'])
export class TrackingNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'booking_id' })
  bookingId: string;

  @Column({ type: 'uuid', name: 'contact_id' })
  contactId: string;

  @Column({ type: 'uuid', nullable: true, name: 'tracking_link_id' })
  trackingLinkId: string | null;

  /** The number as dialled, kept even if the contact is later edited or deleted. */
  @Column({ type: 'varchar', length: 20, name: 'phone_number' })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 10, default: 'SMS' })
  channel: string;

  /** QUEUED → SENT | FAILED */
  @Column({ type: 'varchar', length: 12, default: 'QUEUED' })
  status: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'provider_message_id' })
  providerMessageId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: timestampColumnType(), nullable: true, name: 'sent_at' })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
