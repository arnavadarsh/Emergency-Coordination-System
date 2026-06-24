import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** Cached translation of a message into a target language. */
@Entity('booking_message_translations')
@Index(['messageId', 'lang'], { unique: true })
export class MessageTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'message_id' })
  messageId: string;

  /** Target language name, e.g. "English", "Hindi". */
  @Column({ type: 'varchar', length: 40 })
  lang: string;

  @Column({ type: 'text' })
  text: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
