import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserRole } from '../../common/enums';

/**
 * User entity
 * Merged users and user_profiles - stores all user information
 */
@Entity('users')
@Index(['email'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'boolean', default: false, name: 'email_verified' })
  emailVerified: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login' })
  lastLoginAt: Date;

  // Profile fields (merged from user_profiles)
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'phone_number' })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'emergency_contact' })
  emergencyContact: string;

  @Column({ type: 'date', nullable: true, name: 'date_of_birth' })
  dateOfBirth: Date;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude: number;

  @Column({ type: 'varchar', length: 5, nullable: true, name: 'blood_type' })
  bloodType: string;

  @Column({ type: 'text', nullable: true, name: 'medical_notes' })
  medicalNotes: string;

  @Column({ type: 'uuid', nullable: true, name: 'hospital_id' })
  hospitalId: string;

  @Column({ type: 'uuid', nullable: true, name: 'ambulance_id' })
  ambulanceId: string;

  // Notification preferences
  @Column({ type: 'boolean', default: true, name: 'email_notifications' })
  emailNotifications: boolean;

  @Column({ type: 'boolean', default: true, name: 'sms_notifications' })
  smsNotifications: boolean;

  @Column({ type: 'boolean', default: true, name: 'push_notifications' })
  pushNotifications: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
