import { registerAs } from '@nestjs/config';

/**
 * SMS gateway settings.
 *
 * With nothing configured the system uses the log provider, so emergency-contact
 * alerts still run end to end in development. Setting the Twilio credentials
 * switches it to real delivery without any code change.
 */
export default registerAs('sms', () => ({
  /** 'log' | 'twilio'. Defaults to twilio once credentials are present. */
  provider: process.env.SMS_PROVIDER || (process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'log'),

  /** Prefixed onto numbers saved without one. India, matching the rest of the system. */
  defaultCountryCode: process.env.SMS_DEFAULT_COUNTRY_CODE || '+91',

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM_NUMBER || '',
  },
}));
