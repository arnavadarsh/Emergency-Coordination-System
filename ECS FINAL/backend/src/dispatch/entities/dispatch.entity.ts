import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { Ambulance } from '../../ambulances/entities/ambulance.entity';
import { Hospital } from '../../hospitals/entities/hospital.entity';

/**
 * Dispatch entity
 * Links bookings with ambulances and hospitals
 * Business logic will be added in later phases
 */
@Entity('dispatches')
@Index(['bookingId'])
@Index(['ambulanceId'])
@Index(['hospitalId'])
@Index(['status'])
export class Dispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'booking_id' })
  bookingId: string;

  @ManyToOne(() => Booking)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'uuid', name: 'ambulance_id' })
  ambulanceId: string;

  @ManyToOne(() => Ambulance)
  @JoinColumn({ name: 'ambulance_id' })
  ambulance: Ambulance;

  @Column({ type: 'uuid', nullable: true, name: 'hospital_id' })
  hospitalId: string;

  @ManyToOne(() => Hospital)
  @JoinColumn({ name: 'hospital_id' })
  hospital: Hospital;

  @Column({ type: 'uuid', nullable: true, name: 'driver_id' })
  driverId: string;

  @Column({ type: 'varchar', length: 30, default: 'DISPATCHED' })
  status: string;

  @Column({ type: 'timestamp', default: () => 'NOW()', name: 'dispatched_at' })
  dispatchedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'arrived_at_pickup' })
  arrivedAtPickup: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'departed_pickup' })
  departedPickup: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'arrived_at_hospital' })
  arrivedAtHospital: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt: Date;

  @Column({ type: 'int', nullable: true, name: 'estimated_pickup_time' })
  estimatedPickupTime: number;

  @Column({ type: 'int', nullable: true, name: 'estimated_hospital_time' })
  estimatedHospitalTime: number;

  @Column({ type: 'float', nullable: true, name: 'actual_distance_km' })
  actualDistanceKm: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
