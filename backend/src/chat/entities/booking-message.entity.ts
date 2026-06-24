import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * BookingMessage
 * A single chat message exchanged between the patient (booking owner) and the
 * assigned ambulance driver, scoped to a booking. May carry a media attachment
 * (image / voice note) and a read receipt.
 */
@Entity('booking_messages')
@Index(['bookingId', 'createdAt'])
export class BookingMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'booking_id' })
  bookingId: string;

  /** 'USER' (patient), 'DRIVER', or 'SYSTEM' (auto status updates). */
  @Column({ type: 'varchar', length: 16, name: 'sender_role' })
  senderRole: string;

  @Column({ type: 'uuid', name: 'sender_id' })
  senderId: string;

  @Column({ type: 'varchar', length: 120, nullable: true, name: 'sender_name' })
  senderName: string | null;

  @Column({ type: 'text', default: '' })
  text: string;

  /** 'image' | 'audio' | null. */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'media_type' })
  mediaType: string | null;

  /** base64 data URL for the attachment. */
  @Column({ type: 'text', nullable: true, name: 'media_data' })
  mediaData: string | null;

  /** Set when the OTHER party has read this message. */
  @Column({ type: 'timestamp', nullable: true, name: 'read_at' })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
