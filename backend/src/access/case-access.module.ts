import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { CaseAccessService } from './case-access.service';

/**
 * Case membership checks. Depends on nothing but two entities, so the realtime,
 * bookings and dispatch modules can all import it without a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Booking, Dispatch])],
  providers: [CaseAccessService],
  exports: [CaseAccessService],
})
export class CaseAccessModule {}
