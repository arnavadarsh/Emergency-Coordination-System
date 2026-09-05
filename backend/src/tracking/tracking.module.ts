import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackingService } from './tracking.service';
import { TrackingNotifierService } from './tracking-notifier.service';
import { TrackingController } from './tracking.controller';
import { TrackingLink, TrackingNotification } from './entities';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { EmergencyContact, User } from '../users/entities';

/**
 * Tracking Module
 *
 * Shareable, login-free case tracking and the emergency-contact alerts that
 * hand the link out. Imported by Bookings (to mint a link on assignment) and
 * Dispatch (to close it when the case ends); it imports neither of them back,
 * so the dependency only ever points one way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TrackingLink, TrackingNotification, Booking, Dispatch, EmergencyContact, User]),
  ],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingNotifierService],
  exports: [TrackingService, TrackingNotifierService],
})
export class TrackingModule {}
