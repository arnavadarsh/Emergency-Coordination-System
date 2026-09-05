import { Logger } from '@nestjs/common';
import { SmsMessage, SmsProvider, SmsSendResult } from '../sms.types';

/**
 * Development provider: writes the message to the application log instead of
 * sending it.
 *
 * This is the default when no gateway is configured, so the whole flow —
 * contact fan-out, once-per-case bookkeeping, the tracking link itself — is
 * exercisable locally, and the link printed in the log can be pasted straight
 * into a browser. It never silently drops a message: an unconfigured
 * deployment is loud in the log rather than quiet in production.
 */
export class LogSmsProvider implements SmsProvider {
  readonly name = 'log';

  private readonly logger = new Logger(LogSmsProvider.name);

  async send(message: SmsMessage): Promise<SmsSendResult> {
    this.logger.log(`[SMS → ${message.to}] ${message.body}`);
    return { provider: this.name, providerMessageId: null };
  }
}
