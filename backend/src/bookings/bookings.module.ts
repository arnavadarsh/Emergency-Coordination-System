import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { Booking } from './entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { TriageReport } from '../triage/entities/triage.entity';
import { User } from '../users/entities/user.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { TriageModule } from '../triage/triage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Dispatch, Ambulance, Hospital, TriageReport, User]),
    RealtimeModule,
    forwardRef(() => TriageModule),
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService, TypeOrmModule],
})
export class BookingsModule {}
