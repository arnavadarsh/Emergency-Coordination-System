import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { TranslateDto } from './dto/translate.dto';
import { ReportDto } from './dto/report.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * Chat between the patient (booking owner) and the assigned ambulance driver.
 * Messages, read receipts, attachments, reports and translations are persisted;
 * everything is broadcast in realtime to the `booking:<id>` socket room.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get(':bookingId/messages')
  async list(@Param('bookingId') bookingId: string, @Request() req: any) {
    await this.chatService.assertCanView(req.user, bookingId);
    return this.chatService.list(bookingId);
  }

  @Post(':bookingId/messages')
  @HttpCode(HttpStatus.CREATED)
  async send(
    @Param('bookingId') bookingId: string,
    @Body() body: SendMessageDto,
    @Request() req: any,
  ) {
    await this.chatService.assertCanSend(req.user, bookingId);
    if (!body.text?.trim() && !body.mediaData) {
      throw new BadRequestException('Message must have text or an attachment.');
    }

    const user = req.user;
    const senderRole = this.chatService.roleFor(user);
    const senderName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      user?.email ||
      (senderRole === 'DRIVER' ? 'Driver' : 'Patient');

    const message = await this.chatService.create({
      bookingId,
      senderRole,
      senderId: user?.id,
      senderName,
      text: body.text?.trim(),
      mediaType: body.mediaType ?? null,
      mediaData: body.mediaData ?? null,
    });

    this.realtime.emitToBooking(bookingId, 'chat:message', message);
    return message;
  }

  /** Mark the other party's messages as read. */
  @Post(':bookingId/read')
  @HttpCode(HttpStatus.OK)
  async read(@Param('bookingId') bookingId: string, @Request() req: any) {
    await this.chatService.assertCanView(req.user, bookingId);
    const readerRole = this.chatService.roleFor(req.user);
    const { ids, readAt } = await this.chatService.markRead(bookingId, readerRole);
    if (ids.length) {
      this.realtime.emitToBooking(bookingId, 'chat:read', { bookingId, ids, readerRole, readAt });
    }
    return { ids, readAt };
  }

  /** File a report about this chat (safety control). */
  @Post(':bookingId/report')
  @HttpCode(HttpStatus.CREATED)
  async report(
    @Param('bookingId') bookingId: string,
    @Body() body: ReportDto,
    @Request() req: any,
  ) {
    await this.chatService.assertCanView(req.user, bookingId);
    const saved = await this.chatService.report(bookingId, req.user, body.reason);
    return { id: saved.id, ok: true };
  }

  /** Translate a single message into a target language (cached in DB). */
  @Post('message/:messageId/translate')
  @HttpCode(HttpStatus.OK)
  async translate(
    @Param('messageId') messageId: string,
    @Body() body: TranslateDto,
  ) {
    return this.chatService.translate(messageId, body.lang);
  }
}
