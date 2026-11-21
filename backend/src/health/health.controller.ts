import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { KeepAliveService } from './keep-alive.service';
import { SmsService } from '../notifications/sms.service';

/**
 * Health Controller
 *
 * Unauthenticated on purpose: a load balancer, uptime monitor or container
 * orchestrator has no credentials. It reports liveness and dependency state and
 * nothing else — no counts, no identifiers, nothing about a patient or a case.
 */
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly keepAlive: KeepAliveService,
    private readonly smsService: SmsService,
  ) {}

  /** Liveness: the process is up. Never touches the database. */
  @Get()
  live() {
    return {
      status: 'ok',
      service: 'ecs-backend',
      environment: this.configService.get<string>('app.nodeEnv'),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: can this instance actually serve requests?
   *
   * Reports 200 with `status: "degraded"` rather than failing outright, so a
   * database blip shows up on a dashboard without a platform pulling every
   * instance out of rotation mid-emergency.
   */
  @Get('ready')
  async ready() {
    const database = await this.checkDatabase();
    const storage = this.checkStorage();
    const sms = this.checkSms();
    if (database.ok) await this.keepAlive.beatIfDue();

    return {
      status: database.ok && storage.configured && sms.liveDelivery ? 'ok' : 'degraded',
      checks: {
        database: { ...database, lastHeartbeat: this.keepAlive.lastBeat?.toISOString() ?? null },
        storage,
        sms,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /** Whether emergency-contact texts actually leave the building. */
  private checkSms(): { provider: string; liveDelivery: boolean } {
    return { provider: this.smsService.providerName, liveDelivery: this.smsService.isLiveDelivery };
  }

  private async checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const startedAt = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error: any) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
    }
  }

  /** Whether uploads have somewhere durable to go. */
  private checkStorage(): { configured: boolean; provider: string; bucket: string } {
    const configured = Boolean(
      this.configService.get<string>('supabase.url') &&
      this.configService.get<string>('supabase.serviceRoleKey'),
    );
    return {
      configured,
      provider: configured ? 'supabase-storage' : 'local-disk (development only)',
      bucket: this.configService.get<string>('supabase.storage.bucket', ''),
    };
  }
}
