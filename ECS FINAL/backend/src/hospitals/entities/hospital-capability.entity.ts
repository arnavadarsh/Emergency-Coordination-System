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
import { HospitalCapability as HospitalCapabilityEnum } from '../../common/enums';
import { Hospital } from './hospital.entity';

/**
 * Hospital capability entity
 * Stores the capabilities/specializations of each hospital
 */
@Entity('hospital_capabilities')
@Index(['hospitalId', 'capabilityType'], { unique: true })
export class HospitalCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'hospital_id' })
  hospitalId: string;

  @ManyToOne(() => Hospital, (hospital) => hospital.capabilities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hospital_id' })
  hospital: Hospital;

  @Column({
    type: 'enum',
    enum: HospitalCapabilityEnum,
    name: 'capability_type',
  })
  capabilityType: HospitalCapabilityEnum;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'ACCEPTING' })
  status: string;

  @Column({ type: 'int', default: 0 })
  capacity: number;

  @Column({ type: 'int', default: 0, name: 'current_load' })
  currentLoad: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
