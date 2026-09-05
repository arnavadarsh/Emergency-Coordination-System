import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsMessage, SmsProvider, SmsSendResult } from './sms.types';
import { LogSmsProvider } from './providers/log-sms.provider';
import { TwilioSmsProvider } from './providers/twilio-sms.provider';

/**
 * Outbound SMS.
 *
 * Picks a gateway once, at startup, from configuration, and exposes a single
 * `send`. Callers never learn which gateway is in use — that is what keeps the
 * emergency-contact fan-out testable locally and unchanged when a real gateway
 * is switched on.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: SmsProvider;
  private readonly defaultCountryCode: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultCountryCode = this.configService.get<string>('sms.defaultCountryCode', '+91');
    this.provider = this.resolveProvider();
    this.logger.log(`SMS provider: ${this.provider.name}`);
  }

  private resolveProvider(): SmsProvider {
    const requested = this.configService.get<string>('sms.provider', 'log');

    if (requested === 'twilio') {
      const twilio = this.configService.get<{ accountSid: string; authToken: string; from: string }>('sms.twilio');
      if (twilio?.accountSid && twilio.authToken && twilio.from) {
        return new TwilioSmsProvider(twilio);
      }
      // Half-configured is a deployment mistake worth shouting about — but it
      // must not stop an emergency dispatch, so fall back rather than throw.
      this.logger.error(
        'SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are incomplete — ' +
          'falling back to the log provider. Emergency contacts will NOT receive real messages.',
      );
    }

    return new LogSmsProvider();
  }

  /** Name of the gateway actually in use, recorded against each notification. */
  get providerName(): string {
    return this.provider.name;
  }

  /** Whether messages are really being delivered, or only written to the log. */
  get isLiveDelivery(): boolean {
    return this.provider.name !== 'log';
  }

  /**
   * Reduce a human-typed number to something dialable: digits, with a country
   * code. Returns null when what is left cannot be a phone number, so a typo in
   * one contact is skipped instead of failing the whole fan-out.
   */
  normalizeNumber(raw: string | null | undefined): string | null {
    if (!raw) return null;

    const trimmed = String(raw).trim();
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');

    if (digits.length < 6 || digits.length > 15) return null;
    if (hasPlus) return `+${digits}`;

    // "00" is the other way of writing an international prefix.
    if (digits.startsWith('00') && digits.length > 10) return `+${digits.slice(2)}`;

    return `${this.defaultCountryCode}${digits}`;
  }

  async send(message: SmsMessage): Promise<SmsSendResult> {
    return this.provider.send(message);
  }
}
