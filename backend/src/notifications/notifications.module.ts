import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';

/**
 * Notifications Module
 * Outbound messaging channels. Global because delivery is a cross-cutting
 * concern — dispatch, tracking and future alerting all reach for the same
 * gateway rather than each configuring their own.
 */
@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class NotificationsModule {}
