import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingMessage } from './entities/booking-message.entity';
import { ChatReport } from './entities/chat-report.entity';
import { MessageTranslation } from './entities/message-translation.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { RealtimeModule } from '../realtime/realtime.module';

/**
 * Chat Module
 * Patient ↔ assigned-driver messaging (text, media, read receipts, translation,
 * reports), scoped per booking, persisted and broadcast over the realtime gateway.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingMessage,
      ChatReport,
      MessageTranslation,
      Booking,
      Dispatch,
    ]),
    RealtimeModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
