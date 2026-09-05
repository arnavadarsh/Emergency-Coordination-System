import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A message exchanged between a patient and driver for an emergency case. */
@Entity('case_chat_messages')
@Index(['roomId', 'createdAt'])
@Index(['bookingId'])
@Index(['dispatchId'])
export class CaseChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80, name: 'room_id' })
  roomId: string;

  @Column({ type: 'uuid', nullable: true, name: 'booking_id' })
  bookingId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'dispatch_id' })
  dispatchId: string | null;

  @Column({ type: 'varchar', length: 20, name: 'sender_role' })
  senderRole: 'patient' | 'driver';

  @Column({ type: 'varchar', length: 80, name: 'sender_name' })
  senderName: string;

  /** Empty string for image-only messages. */
  @Column({ type: 'varchar', length: 500 })
  message: string;

  /** Relative URL of an attached image, e.g. /uploads/chat/<uuid>.jpg */
  @Column({ type: 'text', nullable: true, name: 'attachment_url' })
  attachmentUrl: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'attachment_type' })
  attachmentType: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'attachment_name' })
  attachmentName: string | null;

  @Column({ type: 'int', nullable: true, name: 'attachment_size' })
  attachmentSize: number | null;

  /** Intrinsic pixel size, so the bubble can reserve space and avoid reflow on load. */
  @Column({ type: 'int', nullable: true, name: 'attachment_width' })
  attachmentWidth: number | null;

  @Column({ type: 'int', nullable: true, name: 'attachment_height' })
  attachmentHeight: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
