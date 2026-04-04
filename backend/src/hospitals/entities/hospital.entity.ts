import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { HospitalStatus } from '../../common/enums';
import { HospitalCapability } from './hospital-capability.entity';
import { Booking } from '../../bookings/entities/booking.entity';

/**
 * Hospital entity
 * Stores hospital information
 */
@Entity('hospitals')
@Index(['status'])
export class Hospital {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text' })
  address: string;

  @Column({ type: 'varchar', length: 20, name: 'phone_number' })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  @Column({
    type: 'enum',
    enum: HospitalStatus,
    default: HospitalStatus.ACTIVE,
    name: 'service_status',
  })
  status: HospitalStatus;

  @Column({ type: 'int', default: 0, name: 'total_beds' })
  totalBeds: number;

  @Column({ type: 'int', default: 0, name: 'available_beds' })
  availableBeds: number;

  @OneToMany(() => HospitalCapability, (capability) => capability.hospital, { cascade: true })
  capabilities: HospitalCapability[];

  @OneToMany(() => Booking, booking => booking.hospital)
  bookings: Booking[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
