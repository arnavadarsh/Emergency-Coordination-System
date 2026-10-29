import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { SeverityLevel } from '../common/enums';
import { SystemSettingsService } from '../settings/system-settings.service';

const SEVERITY_RANK: Record<string, number> = {
  [SeverityLevel.CRITICAL]: 0,
  [SeverityLevel.HIGH]: 1,
  [SeverityLevel.MEDIUM]: 2,
  [SeverityLevel.LOW]: 3,
};

/**
 * Picks up bookings that found no free ambulance.
 *
 * Dispatch used to be a single attempt at booking time: with every unit busy,
 * the booking stayed PENDING forever and nobody was sent even after ambulances
 * came free. This worker retries waiting bookings — most severe first, then
 * oldest — immediately whenever an ambulance becomes available, and on a timer
 * as a safety net for anything that event missed (a restart, a unit freed by a
 * direct database edit).
 *
 * Bookings older than the dispatchRetryMaxAgeMinutes setting are left alone: an
 * ambulance turning up hours late to a request the patient has likely given up
 * on does more harm than good, so those wait for an admin. Runs never overlap;
 * a trigger that arrives mid-run queues exactly one more pass.
 */
@Injectable()
export class DispatchRetryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DispatchRetryService.name);
  private readonly intervalMs = parseInt(process.env.DISPATCH_RETRY_INTERVAL_MS || '20000', 10);
  private readonly batchSize = 50;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerunRequested = false;
  private lastRun: { at: Date; reason: string; waiting: number; dispatched: number } | null = null;

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly settings: SystemSettingsService,
  ) {}

  /** For the admin system panel. */
  status() {
    return {
      intervalMs: this.intervalMs,
      running: this.running,
      autoDispatchEnabled: this.settings.get('autoDispatchEnabled'),
      maxAgeMinutes: this.settings.get('dispatchRetryMaxAgeMinutes'),
      lastRun: this.lastRun,
    };
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) {
      this.logger.warn('DISPATCH_RETRY_INTERVAL_MS is 0 — timed dispatch retries are off; only freed ambulances trigger them.');
    } else {
      this.timer = setInterval(() => void this.run('timer'), this.intervalMs);
      // A pending timer must not hold the process open on shutdown.
      this.timer.unref();
    }
    // Catch up on anything left waiting while the server was down.
    void this.run('startup');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @OnEvent('ambulance.available')
  onAmbulanceAvailable(ambulanceId?: string): void {
    void this.run(`ambulance ${ambulanceId ?? ''} available`.trim());
  }

  /** Most severe first, then whoever has waited longest. */
  static prioritise(bookings: Booking[]): Booking[] {
    return [...bookings].sort((a, b) => {
      const bySeverity = (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2);
      if (bySeverity !== 0) return bySeverity;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  /**
   * One pass over waiting bookings. `force` runs it even with auto-dispatch
   * switched off — the admin's "dispatch waiting bookings now" button.
   */
  async run(reason: string, force = false): Promise<void> {
    // With auto-dispatch off an admin is dispatching by hand; stay out of the way.
    if (!force && !this.settings.get('autoDispatchEnabled')) return;
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;

    try {
      const waiting = await this.bookingsService.findWaitingForAmbulance(
        this.settings.get('dispatchRetryMaxAgeMinutes'),
        this.batchSize,
      );
      let dispatched = 0;
      this.lastRun = { at: new Date(), reason, waiting: waiting.length, dispatched };
      if (waiting.length === 0) return;

      this.logger.log(`[retry] ${waiting.length} booking(s) waiting for an ambulance (${reason})`);
      for (const booking of DispatchRetryService.prioritise(waiting)) {
        const assigned = await this.bookingsService.tryDispatch(booking, booking.triageReport ?? null);
        // No unit left for this one means none for the rest either.
        if (!assigned) break;
        dispatched++;
        this.logger.log(`[retry] Booking ${booking.id} dispatched after waiting`);
      }
      this.lastRun = { at: new Date(), reason, waiting: waiting.length, dispatched };
    } catch (error: any) {
      this.logger.error(`[retry] Dispatch retry failed: ${error?.message ?? error}`, error?.stack);
    } finally {
      this.running = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.run('queued trigger');
      }
    }
  }
}
