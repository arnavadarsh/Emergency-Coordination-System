import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { BookingStatus, SeverityLevel } from '../../common/enums';
import { User } from '../../users/entities/user.entity';
import { TriageReport } from '../../triage/entities/triage.entity';
import { Ambulance } from '../../ambulances/entities/ambulance.entity';
import { Hospital } from '../../hospitals/entities/hospital.entity';

/**
 * Booking entity
 * Generic structure for emergency bookings
 * Business logic will be added in later phases
 */
@Entity('bookings')
@Index(['userId'])
@Index(['status'])
@Index(['createdAt'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.PENDING,
  })
  status: BookingStatus;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'booking_type',
    default: 'EMERGENCY',
  })
  bookingType: string;

  @Column({
    type: 'enum',
    enum: SeverityLevel,
    nullable: true,
  })
  severity: SeverityLevel;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, name: 'pickup_latitude' })
  pickupLatitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, name: 'pickup_longitude' })
  pickupLongitude: number;

  @Column({ type: 'text', nullable: true, name: 'pickup_address' })
  pickupAddress: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, name: 'destination_latitude' })
  destinationLatitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, name: 'destination_longitude' })
  destinationLongitude: number;

  @Column({ type: 'text', nullable: true, name: 'destination_address' })
  destinationAddress: string;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'cancelled_at' })
  cancelledAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  requirements?: any;

  @OneToOne(() => TriageReport, triageReport => triageReport.booking)
  triageReport: TriageReport;

  // NOTE: Current deployed DB schema does not include ambulance/hospital FK columns on bookings.
  // Keep as non-persistent properties for compatibility with in-memory workflow usage.
  ambulance?: Ambulance;
  hospital?: Hospital;

  rankedHospitals?: any;
}
