import {
  Injectable,
  Logger,
  OnModuleInit,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { GoogleGenAI } from '@google/genai';
import { BookingMessage } from './entities/booking-message.entity';
import { ChatReport } from './entities/chat-report.entity';
import { MessageTranslation } from './entities/message-translation.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { UserRole, BookingStatus } from '../common/enums';

const SYSTEM_SENDER_ID = '00000000-0000-0000-0000-000000000000';

/** Statuses after which the chat is read-only. */
const CLOSED_BOOKING_STATUSES = new Set<string>([
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
]);

// Minimal profanity mask — replace flagged words with asterisks.
const PROFANITY = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'cunt', 'slut',
];
const PROFANITY_RE = new RegExp(`\\b(${PROFANITY.join('|')})\\b`, 'gi');

export interface ChatParticipants {
  ownerId: string;
  driverId: string | null;
  bookingStatus: string;
}

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);
  private readonly genai: GoogleGenAI | null;
  private readonly geminiModel: string;

  constructor(
    @InjectRepository(BookingMessage)
    private readonly messageRepo: Repository<BookingMessage>,
    @InjectRepository(ChatReport)
    private readonly reportRepo: Repository<ChatReport>,
    @InjectRepository(MessageTranslation)
    private readonly translationRepo: Repository<MessageTranslation>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Dispatch)
    private readonly dispatchRepo: Repository<Dispatch>,
  ) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.genai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  /**
   * Ensure backing tables/columns exist. The deployed Supabase schema is not
   * managed by the migration runner, so we create everything idempotently.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.messageRepo.query(`
        CREATE TABLE IF NOT EXISTS "booking_messages" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "booking_id" uuid NOT NULL,
          "sender_role" character varying(16) NOT NULL,
          "sender_id" uuid NOT NULL,
          "sender_name" character varying(120),
          "text" text NOT NULL DEFAULT '',
          "media_type" character varying(16),
          "media_data" text,
          "read_at" TIMESTAMP,
          "created_at" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_booking_messages" PRIMARY KEY ("id")
        )`);
      // Add columns for installs created before these features existed.
      await this.messageRepo.query(
        `ALTER TABLE "booking_messages"
           ADD COLUMN IF NOT EXISTS "media_type" character varying(16),
           ADD COLUMN IF NOT EXISTS "media_data" text,
           ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP`,
      );
      await this.messageRepo.query(
        `CREATE INDEX IF NOT EXISTS "IDX_booking_messages_booking_created" ON "booking_messages" ("booking_id", "created_at")`,
      );
      await this.messageRepo.query(`
        CREATE TABLE IF NOT EXISTS "booking_chat_reports" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "booking_id" uuid NOT NULL,
          "reporter_id" uuid NOT NULL,
          "reporter_role" character varying(16) NOT NULL,
          "reason" text,
          "created_at" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_booking_chat_reports" PRIMARY KEY ("id")
        )`);
      await this.messageRepo.query(`
        CREATE TABLE IF NOT EXISTS "booking_message_translations" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "message_id" uuid NOT NULL,
          "lang" character varying(40) NOT NULL,
          "text" text NOT NULL,
          "created_at" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_booking_message_translations" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_message_lang" UNIQUE ("message_id", "lang")
        )`);
      this.logger.log('chat tables are ready.');
    } catch (err: any) {
      this.logger.error(`Failed to ensure chat tables: ${err?.message || err}`);
    }
  }

  // ── Participants & authorization ──────────────────────────────────────────

  async getParticipants(bookingId: string): Promise<ChatParticipants> {
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    const dispatch = await this.dispatchRepo.findOne({ where: { bookingId } });
    return {
      ownerId: booking?.userId ?? '',
      driverId: dispatch?.driverId ?? null,
      bookingStatus: booking?.status ?? '',
    };
  }

  /** May this user view/participate in this booking's chat? */
  async assertCanView(user: any, bookingId: string): Promise<ChatParticipants> {
    const p = await this.getParticipants(bookingId);
    const isOwner = user?.id && user.id === p.ownerId;
    const isAssignedDriver =
      user?.role === UserRole.DRIVER && (p.driverId == null || p.driverId === user.id);
    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isOwner && !isAssignedDriver && !isAdmin) {
      throw new ForbiddenException('You are not a participant in this chat.');
    }
    return p;
  }

  /** Same as view, but also rejects when the booking chat is closed. */
  async assertCanSend(user: any, bookingId: string): Promise<ChatParticipants> {
    const p = await this.assertCanView(user, bookingId);
    if (CLOSED_BOOKING_STATUSES.has(p.bookingStatus)) {
      throw new ForbiddenException('This chat is closed — the trip has ended.');
    }
    return p;
  }

  roleFor(user: any): 'USER' | 'DRIVER' {
    return user?.role === UserRole.DRIVER ? 'DRIVER' : 'USER';
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async list(bookingId: string): Promise<BookingMessage[]> {
    return this.messageRepo.find({
      where: { bookingId },
      order: { createdAt: 'ASC' },
    });
  }

  async create(data: {
    bookingId: string;
    senderRole: string;
    senderId: string;
    senderName: string | null;
    text?: string;
    mediaType?: string | null;
    mediaData?: string | null;
  }): Promise<BookingMessage> {
    const message = this.messageRepo.create({
      bookingId: data.bookingId,
      senderRole: data.senderRole,
      senderId: data.senderId,
      senderName: data.senderName,
      text: this.maskProfanity(data.text || ''),
      mediaType: data.mediaType ?? null,
      mediaData: data.mediaData ?? null,
    });
    return this.messageRepo.save(message);
  }

  /** Insert an automated SYSTEM message (dispatch status updates, etc.). */
  async createSystemMessage(bookingId: string, text: string): Promise<BookingMessage> {
    const message = this.messageRepo.create({
      bookingId,
      senderRole: 'SYSTEM',
      senderId: SYSTEM_SENDER_ID,
      senderName: 'System',
      text,
      mediaType: null,
      mediaData: null,
    });
    return this.messageRepo.save(message);
  }

  /** Mark all messages from the OTHER party as read. Returns the affected ids. */
  async markRead(bookingId: string, readerRole: 'USER' | 'DRIVER'): Promise<{ ids: string[]; readAt: Date }> {
    const unread = await this.messageRepo.find({
      where: { bookingId, senderRole: Not(readerRole), readAt: IsNull() },
      select: ['id'],
    });
    const ids = unread.map((m) => m.id);
    const readAt = new Date();
    if (ids.length) {
      await this.messageRepo
        .createQueryBuilder()
        .update(BookingMessage)
        .set({ readAt })
        .whereInIds(ids)
        .execute();
    }
    return { ids, readAt };
  }

  // ── Reports ─────────────────────────────────────────────────────────────

  async report(bookingId: string, user: any, reason?: string): Promise<ChatReport> {
    const report = this.reportRepo.create({
      bookingId,
      reporterId: user?.id,
      reporterRole: this.roleFor(user),
      reason: reason || null,
    });
    return this.reportRepo.save(report);
  }

  // ── Translation ───────────────────────────────────────────────────────────

  async translate(messageId: string, lang: string): Promise<{ text: string; translated: boolean }> {
    const message = await this.messageRepo.findOne({ where: { id: messageId } });
    if (!message || !message.text) return { text: message?.text ?? '', translated: false };

    const cached = await this.translationRepo.findOne({ where: { messageId, lang } });
    if (cached) return { text: cached.text, translated: true };

    const out = await this.geminiTranslate(message.text, lang);
    if (!out) return { text: message.text, translated: false };

    try {
      await this.translationRepo.save(this.translationRepo.create({ messageId, lang, text: out }));
    } catch {
      /* unique race — ignore */
    }
    return { text: out, translated: true };
  }

  private async geminiTranslate(text: string, lang: string): Promise<string | null> {
    if (!this.genai) return null;
    try {
      const resp = await this.genai.models.generateContent({
        model: this.geminiModel,
        contents: `Translate the following message into ${lang}. Return ONLY the translation, with no quotes or commentary:\n\n${text}`,
        config: { temperature: 0 },
      });
      const out = resp.text?.trim();
      return out || null;
    } catch (err: any) {
      this.logger.warn(`Translate failed: ${err?.message || err}`);
      return null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private maskProfanity(text: string): string {
    return text.replace(PROFANITY_RE, (w) => '*'.repeat(w.length));
  }
}
