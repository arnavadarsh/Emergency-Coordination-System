/**
 * The narrow contract every SMS backend implements. Keeping it this small is
 * what lets the system run end-to-end in development (messages printed to the
 * log) and in production (a real gateway) without the notification code
 * knowing which one it is talking to.
 */
export interface SmsMessage {
  /** Dialable destination, e.g. "+919876543210". */
  to: string;
  body: string;
}

export interface SmsSendResult {
  provider: string;
  /** Gateway's own id for the message, when it returns one. */
  providerMessageId: string | null;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}
