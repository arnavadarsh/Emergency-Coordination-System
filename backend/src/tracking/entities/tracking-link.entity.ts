import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { timestampColumnType } from '../../common/column-types';

/**
 * TrackingLink entity
 *
 * One private, login-free link per case, minted the moment an ambulance is
 * assigned. The token is the only credential: anyone holding it may watch the
 * ambulance move, and nobody without it can find the case.
 *
 * A link is readable only while its case is live. `closedAt` is stamped when the
 * case ends and `expiresAt` is a backstop in case a close is ever missed — but
 * neither is the real gate: TrackingService re-checks the booking and dispatch
 * on every read, so a finished case goes dark even if nothing stamped this row.
 */
@Entity('tracking_links')
@Index(['token'], { unique: true })
export class TrackingLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** URL-safe random string (192 bits) — the shareable secret. */
  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'uuid', unique: true, name: 'booking_id' })
  bookingId: string;

  @Column({ type: 'uuid', nullable: true, name: 'dispatch_id' })
  dispatchId: string | null;

  /** Hard stop, independent of case state. */
  @Column({ type: timestampColumnType(), name: 'expires_at' })
  expiresAt: Date;

  /** Set when the case ended (or the patient revoked the link). */
  @Column({ type: timestampColumnType(), nullable: true, name: 'closed_at' })
  closedAt: Date | null;

  /** COMPLETED | CANCELLED | REVOKED — why the link stopped working. */
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'close_reason' })
  closeReason: string | null;

  /** Rough interest signal for the patient: how many times the page was opened. */
  @Column({ type: 'int', default: 0, name: 'view_count' })
  viewCount: number;

  @Column({ type: timestampColumnType(), nullable: true, name: 'last_viewed_at' })
  lastViewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
