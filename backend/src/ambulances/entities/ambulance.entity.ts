import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { AmbulanceStatus } from '../../common/enums';
import { Booking } from '../../bookings/entities/booking.entity';

/**
 * Ambulance entity
 * Stores ambulance information
 * Driver assignments are managed via ambulance_assignments table
 */
@Entity('ambulances')
@Index(['status'])
export class Ambulance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true, name: 'vehicle_number' })
  vehicleNumber: string;

  @Column({ type: 'varchar', length: 30, default: 'BASIC', name: 'vehicle_type' })
  vehicleType: string;

  @Column({
    type: 'enum',
    enum: AmbulanceStatus,
    default: AmbulanceStatus.AVAILABLE,
  })
  status: AmbulanceStatus;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, name: 'current_latitude' })
  currentLatitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, name: 'current_longitude' })
  currentLongitude: number;

  @Column({ type: 'timestamp', nullable: true, name: 'last_location_update' })
  lastLocationUpdate: Date;

  @Column({ type: 'jsonb', nullable: true, name: 'equipment_list' })
  equipmentList: any;

  @OneToMany(() => Booking, booking => booking.ambulance)
  bookings: Booking[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
