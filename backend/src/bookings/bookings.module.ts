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
import { HospitalsModule } from '../hospitals/hospitals.module';
import { UsersModule } from '../users/users.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Dispatch, Ambulance, Hospital, TriageReport, User]),
    RealtimeModule,
    forwardRef(() => TriageModule),
    HospitalsModule,
    UsersModule,
    TrackingModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService, TypeOrmModule],
})
export class BookingsModule {}
