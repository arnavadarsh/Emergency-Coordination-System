import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SystemSettingsService, RuntimeSettings } from '../settings/system-settings.service';
import { SmsService } from '../notifications/sms.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DispatchRetryService } from '../bookings/dispatch-retry.service';
import { KeepAliveService } from '../health/keep-alive.service';
import { AdminAuditService, SYSTEM_ENTITY_ID } from './admin-audit.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminBroadcastDto } from './dto/admin.dto';

type Actor = { id: string; email?: string };

/**
 * System-wide controls: the runtime switches, a live health picture,
 * announcements to every dashboard, a test text, and an on-demand dispatch pass.
 */
@Injectable()
export class AdminSystemService {
  private readonly startedAt = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly settings: SystemSettingsService,
    private readonly smsService: SmsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly dispatchRetry: DispatchRetryService,
    private readonly keepAlive: KeepAliveService,
    private readonly operations: AdminOperationsService,
    private readonly audit: AdminAuditService,
  ) {}

  getSettings() {
    return this.settings.describe();
  }

  async updateSettings(actor: Actor, patch: Partial<RuntimeSettings>) {
    const before = this.settings.describe().values;
    const values = await this.settings.update(patch, actor.id);
    await this.audit.record(actor.id, 'SETTINGS_UPDATED', 'System', SYSTEM_ENTITY_ID, { before, changes: patch });

    // Switching auto-dispatch back on should send units to whoever has been waiting.
    if (patch.autoDispatchEnabled === true && !before.autoDispatchEnabled) {
      void this.dispatchRetry.run('auto-dispatch switched back on');
    }
    // Every dashboard can learn about it (sign-up closed, dispatch paused).
    this.realtimeGateway.emitToAdmins('settings_updated', values);
    return this.settings.describe();
  }

  /** One picture of whether the system can do its job right now. */
  async status() {
    const dbStarted = Date.now();
    let database: { ok: boolean; latencyMs?: number; error?: string };
    try {
      await this.dataSource.query('SELECT 1');
      database = { ok: true, latencyMs: Date.now() - dbStarted };
    } catch (error: any) {
      database = { ok: false, error: String(error?.message ?? error).slice(0, 200) };
    }

    const [connections, waitingBookings, fleet, activeTrips] = await Promise.all([
      this.realtimeGateway.connectionStats(),
      this.operations.waitingCount(),
      this.operations.fleetCounts(),
      this.operations.activeTripCount(),
    ]);

    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      environment: this.configService.get<string>('app.nodeEnv'),
      database: { ...database, lastHeartbeat: this.keepAlive.lastBeat?.toISOString() ?? null },
      sms: { provider: this.smsService.providerName, liveDelivery: this.smsService.isLiveDelivery },
      storage: {
        configured: Boolean(this.configService.get<string>('supabase.url') && this.configService.get<string>('supabase.serviceRoleKey')),
        bucket: this.configService.get<string>('supabase.storage.bucket', ''),
      },
      integrations: {
        gemini: Boolean(process.env.GEMINI_API_KEY),
        googleMaps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      },
      connections,
      dispatch: { ...this.dispatchRetry.status(), waitingBookings, activeTrips },
      fleet,
      settings: this.settings.describe().values,
    };
  }

  async broadcast(actor: Actor, dto: AdminBroadcastDto) {
    const payload = {
      message: dto.message.trim(),
      tone: dto.tone ?? 'info',
      from: 'ECS administration',
      at: new Date().toISOString(),
    };
    this.realtimeGateway.broadcastAnnouncement(dto.audience, payload);
    await this.audit.record(actor.id, 'ANNOUNCEMENT_SENT', 'System', SYSTEM_ENTITY_ID, { after: { ...payload, audience: dto.audience } });
    return { sent: true, audience: dto.audience };
  }

  /** Send one text through the configured gateway, to prove it works end to end. */
  async testSms(actor: Actor, phoneNumber: string) {
    const to = this.smsService.normalizeNumber(phoneNumber);
    if (!to) throw new BadRequestException('That is not a usable phone number');

    let result: { delivered: boolean; provider: string; providerMessageId?: string | null; error?: string };
    try {
      const sent = await this.smsService.send({ to, body: 'ECS test message: SMS delivery is working.' });
      result = { delivered: this.smsService.isLiveDelivery, provider: sent.provider, providerMessageId: sent.providerMessageId };
    } catch (error: any) {
      result = { delivered: false, provider: this.smsService.providerName, error: String(error?.message ?? error).slice(0, 300) };
    }
    await this.audit.record(actor.id, 'TEST_SMS_SENT', 'System', SYSTEM_ENTITY_ID, { after: { to, ...result } });
    return {
      ...result,
      to,
      note: this.smsService.isLiveDelivery ? null : 'No SMS gateway is configured, so the message was only written to the server log.',
    };
  }

  /** Dispatch every waiting booking that a free ambulance can serve, now. */
  async runDispatch(actor: Actor) {
    await this.dispatchRetry.run('admin request', true);
    await this.audit.record(actor.id, 'DISPATCH_PASS_RUN', 'System', SYSTEM_ENTITY_ID);
    return this.dispatchRetry.status();
  }
}
