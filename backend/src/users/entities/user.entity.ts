import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserRole } from '../../common/enums';
import { enumColumnType, timestampColumnType } from '../../common/column-types';

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

  /**
  * bcrypt hash — never the raw password.
  *
  * `select: false` keeps it out of every find()/findOne() result, so it cannot leak
  * through endpoints that return the entity directly. Auth reads it deliberately via
  * UsersService.findByEmailWithPassword().
  */
  @Column({ type: 'varchar', length: 255, select: false })
  password: string;

  @Column({
    type: enumColumnType(),
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'boolean', default: false, name: 'email_verified' })
  emailVerified: boolean;

  @Column({ type: timestampColumnType(), nullable: true, name: 'last_login' })
  lastLoginAt: Date;

  // Profile fields (merged from user_profiles)
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'phone_number' })
  phoneNumber: string;

  /** Public URL (or data URI) of the profile photo. Shown as driver identity on tracking and pre-arrival views. */
  @Column({ type: 'text', nullable: true, name: 'profile_photo_url' })
  profilePhotoUrl: string;

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

  // ── Medical Profile ───────────────────────────────────────────────────────
  // Optional standing clinical background, owned by the patient's profile and
  // treated as the single source of truth: triage, triage summaries, hospital
  // pre-alerts and reports all read these columns at request time, so an edit
  // here shows up everywhere downstream. Every field is nullable — a patient ID
  // is valid with none of them set, and a blank submission clears the field
  // back to NULL rather than storing an empty string.

  /** Blood group, e.g. "O+". Surfaced as "Blood Group" throughout the system. */
  @Column({ type: 'varchar', length: 5, nullable: true, name: 'blood_type' })
  bloodType: string;

  /** Known allergies, free text, e.g. "Penicillin, peanuts". */
  @Column({ type: 'text', nullable: true })
  allergies: string;

  /** Ongoing conditions, free text, e.g. "Asthma, Type 2 diabetes". */
  @Column({ type: 'text', nullable: true, name: 'chronic_conditions' })
  chronicConditions: string;

  /** Medication the patient is currently on, free text, e.g. "Salbutamol". */
  @Column({ type: 'text', nullable: true, name: 'current_medications' })
  currentMedications: string;

  /** Last time any Medical Profile field was saved. Null until first edited. */
  @Column({ type: timestampColumnType(), nullable: true, name: 'medical_profile_updated_at' })
  medicalProfileUpdatedAt: Date;

  /** Free-text history that predates the structured Medical Profile fields. */
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
