import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemHeartbeat } from './entities/system-heartbeat.entity';

/**
 * Keeps the Supabase project from being paused.
 *
 * A free Supabase project is paused after seven days without user database
 * activity, and an open connection alone does not count. So this writes one row
 * on a timer (DB_KEEPALIVE_INTERVAL_HOURS, default 6; 0 turns it off), and the
 * readiness probe writes it too, at most once an hour.
 *
 * The timer only runs while this process is awake. A host that sleeps idle
 * services (Render's free plan does after 15 minutes) needs something outside
 * to wake it: point an uptime monitor at /api/health/ready every few minutes,
 * which both keeps the server up and lands here. See docs/deployment.md.
 */
@Injectable()
export class KeepAliveService implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly ROW_ID = 1;
  private static readonly PROBE_MIN_GAP_MS = 60 * 60 * 1000;

  private readonly logger = new Logger(KeepAliveService.name);
  private readonly intervalHours = Number(process.env.DB_KEEPALIVE_INTERVAL_HOURS ?? '6');
  private timer: NodeJS.Timeout | null = null;
  private lastBeatAt: Date | null = null;

  constructor(
    @InjectRepository(SystemHeartbeat)
    private readonly heartbeats: Repository<SystemHeartbeat>,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.intervalHours > 0)) {
      this.logger.warn('DB_KEEPALIVE_INTERVAL_HOURS is 0 — the database heartbeat is off.');
      return;
    }
    void this.beat('startup');
    this.timer = setInterval(() => void this.beat('timer'), this.intervalHours * 3600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get lastBeat(): Date | null {
    return this.lastBeatAt;
  }

  /** Called from the readiness probe; throttled so a 1-minute monitor is not a write a minute. */
  async beatIfDue(): Promise<void> {
    if (this.lastBeatAt && Date.now() - this.lastBeatAt.getTime() < KeepAliveService.PROBE_MIN_GAP_MS) return;
    await this.beat('probe');
  }

  private async beat(source: string): Promise<void> {
    try {
      const beatAt = new Date();
      await this.heartbeats.upsert({ id: KeepAliveService.ROW_ID, beatAt, source }, ['id']);
      this.lastBeatAt = beatAt;
    } catch (error: any) {
      // Never let bookkeeping break anything — the next beat will try again.
      this.logger.warn(`Database heartbeat failed: ${error?.message ?? error}`);
    }
  }
}
