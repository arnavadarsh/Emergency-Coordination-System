import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { timestampColumnType } from '../../common/column-types';

/**
 * EmergencyContact entity
 *
 * The people a patient wants told when an ambulance is assigned to them. Each
 * row is one relative or friend: who they are, the number to text, and how they
 * are related to the patient. A patient may save any number of them and edit
 * them at any time.
 *
 * Two independent switches decide whether a contact is texted:
 *
 *   - `notifyBySms` belongs to the patient — "stop including this contact".
 *   - `optedOutAt`  belongs to the contact — set when they opt out from the
 *     tracking page. The patient cannot clear it by editing the contact; only
 *     the contact's own opt-in can, so an unsubscribe stays honoured.
 */
@Entity('emergency_contacts')
@Index(['userId'])
export class EmergencyContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Stored in dialable form (leading "+" and digits only) — see SmsService.normalizeNumber. */
  @Column({ type: 'varchar', length: 20, name: 'phone_number' })
  phoneNumber: string;

  /** How this person relates to the patient: Parent, Spouse, Sibling, Friend, … */
  @Column({ type: 'varchar', length: 40 })
  relation: string;

  /** Patient's switch: include this contact in the automatic alert. */
  @Column({ type: 'boolean', default: true, name: 'notify_by_sms' })
  notifyBySms: boolean;

  /** Contact's own switch: set when they opt out; null while they are subscribed. */
  @Column({ type: timestampColumnType(), nullable: true, name: 'opted_out_at' })
  optedOutAt: Date | null;

  /**
   * Unguessable id carried in the contact's own tracking link, so the opt-out
   * control on that page can identify them without any login.
   */
  @Column({ type: 'varchar', length: 64, unique: true, name: 'opt_out_token' })
  optOutToken: string;

  /** Last time an alert was actually delivered to this contact. */
  @Column({ type: timestampColumnType(), nullable: true, name: 'last_notified_at' })
  lastNotifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
