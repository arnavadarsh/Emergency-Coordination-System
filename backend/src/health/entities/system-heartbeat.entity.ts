import { Column, Entity, PrimaryColumn } from 'typeorm';
import { timestampColumnType } from '../../common/column-types';

/**
 * A single row the server rewrites on a schedule.
 *
 * Supabase pauses a free project after a week without database activity, and
 * an idle connection does not count — a real write does. See KeepAliveService.
 */
@Entity('system_heartbeat')
export class SystemHeartbeat {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ type: timestampColumnType(), name: 'beat_at' })
  beatAt: Date;

  /** What triggered the beat: the timer, or a readiness probe. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  source: string | null;
}
