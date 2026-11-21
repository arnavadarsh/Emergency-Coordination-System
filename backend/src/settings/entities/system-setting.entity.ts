import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * One runtime switch an admin can flip without a redeploy. The value is stored
 * as JSON text so booleans and numbers round-trip unchanged.
 */
@Entity('system_settings')
export class SystemSetting {
  @PrimaryColumn({ type: 'varchar', length: 60 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'uuid', nullable: true, name: 'updated_by' })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
