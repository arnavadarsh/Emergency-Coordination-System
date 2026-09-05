import { Logger } from '@nestjs/common';
import { SmsMessage, SmsProvider, SmsSendResult } from '../sms.types';

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  /** A Twilio number ("+1…") or a messaging service SID ("MG…"). */
  from: string;
}

/**
 * Twilio provider, spoken over plain HTTP.
 *
 * The REST call is a single form POST, so this avoids pulling in the Twilio SDK
 * for it. Any other gateway can be added the same way: implement SmsProvider
 * and register it in SmsService.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';

  private readonly logger = new Logger(TwilioSmsProvider.name);

  constructor(private readonly config: TwilioSmsConfig) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const form = new URLSearchParams({ To: message.to, Body: message.body });

    // A messaging service SID goes in a different field from a plain number.
    if (this.config.from.startsWith('MG')) {
      form.set('MessagingServiceSid', this.config.from);
    } else {
      form.set('From', this.config.from);
    }

    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const payload: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const reason = payload?.message || `HTTP ${response.status}`;
      this.logger.error(`Twilio rejected message to ${message.to}: ${reason}`);
      throw new Error(reason);
    }

    return { provider: this.name, providerMessageId: payload?.sid ?? null };
  }
}
