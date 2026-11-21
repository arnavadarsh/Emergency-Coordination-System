import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from './entities/system-setting.entity';

/** Switches an admin can change at runtime. */
export interface RuntimeSettings {
  /** Off: new bookings wait in the admin queue and nothing is sent automatically. */
  autoDispatchEnabled: boolean;
  /** Waiting bookings older than this are left for an admin instead of auto-dispatched. */
  dispatchRetryMaxAgeMinutes: number;
  /** Off: public patient sign-up is closed (admins can still create accounts). */
  patientSignupEnabled: boolean;
  /** Off: emergency contacts are not texted tracking links (e.g. during a drill). */
  contactSmsEnabled: boolean;
}

export type SettingKey = keyof RuntimeSettings;

const defaults = (): RuntimeSettings => ({
  autoDispatchEnabled: true,
  dispatchRetryMaxAgeMinutes: parseInt(process.env.DISPATCH_RETRY_MAX_AGE_MINUTES || '120', 10),
  patientSignupEnabled: true,
  contactSmsEnabled: true,
});

/**
 * Runtime settings, backed by the system_settings table.
 *
 * Read on every use from an in-memory copy, so checking a switch in a hot path
 * costs nothing; written through to the database so a restart keeps it. The
 * copy is per process — fine for the single instance this system runs as.
 */
@Injectable()
export class SystemSettingsService implements OnModuleInit {
  private readonly logger = new Logger(SystemSettingsService.name);
  private values: RuntimeSettings = defaults();
  private meta = new Map<SettingKey, { updatedAt: Date; updatedBy: string | null }>();

  constructor(
    @InjectRepository(SystemSetting)
    private readonly repository: Repository<SystemSetting>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.repository.find();
      const next = defaults();
      for (const row of rows) {
        if (!(row.key in next)) continue;
        try {
          (next as any)[row.key] = JSON.parse(row.value);
          this.meta.set(row.key as SettingKey, { updatedAt: row.updatedAt, updatedBy: row.updatedBy });
        } catch {
          this.logger.warn(`Ignoring unreadable setting ${row.key}`);
        }
      }
      this.values = next;
    } catch (error: any) {
      // Defaults keep the system working if the table is not there yet.
      this.logger.warn(`Using default settings: ${error?.message ?? error}`);
    }
  }

  get<K extends SettingKey>(key: K): RuntimeSettings[K] {
    return this.values[key];
  }

  /** Every setting, with when and by whom each was last changed (null = default). */
  describe(): { values: RuntimeSettings; changes: Record<string, { updatedAt: Date; updatedBy: string | null } | null> } {
    const changes: Record<string, { updatedAt: Date; updatedBy: string | null } | null> = {};
    for (const key of Object.keys(this.values) as SettingKey[]) changes[key] = this.meta.get(key) ?? null;
    return { values: { ...this.values }, changes };
  }

  async update(patch: Partial<RuntimeSettings>, actorId: string | null): Promise<RuntimeSettings> {
    const known = defaults();
    for (const [key, value] of Object.entries(patch) as [SettingKey, any][]) {
      if (!(key in known) || value === undefined) continue;
      await this.repository.save(this.repository.create({ key, value: JSON.stringify(value), updatedBy: actorId }));
      (this.values as any)[key] = value;
      this.meta.set(key, { updatedAt: new Date(), updatedBy: actorId });
      this.logger.warn(`Setting ${key} = ${JSON.stringify(value)} (by ${actorId ?? 'system'})`);
    }
    return { ...this.values };
  }
}
