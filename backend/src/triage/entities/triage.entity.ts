
import { Entity, PrimaryGeneratedColumn, Column, OneToOne } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { enumColumnType } from '../../common/column-types';

export enum EmergencyType {
  CARDIAC = 'CARDIAC',
  TRAUMA = 'TRAUMA',
  NEURO = 'NEURO',
}

@Entity('triage_reports')
export class TriageReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: enumColumnType(),
    enum: EmergencyType,
  })
  emergencyType: EmergencyType;

  @Column()
  breathing: boolean;

  @Column()
  bleeding: boolean;

  @Column()
  conscious: boolean;

  @Column()
  painLevel: number;

  @Column()
  pregnancy: boolean;

  @OneToOne(() => Booking, booking => booking.triageReport)
  booking: Booking;
}
