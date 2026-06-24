import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HospitalsService } from './hospitals.service';
import { HospitalsController } from './hospitals.controller';
import { Hospital, HospitalCapability } from './entities';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { HospitalRankingService } from './hospital-ranking.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hospital, HospitalCapability, Dispatch, Booking]), RealtimeModule],
  controllers: [HospitalsController],
  providers: [HospitalsService, HospitalRankingService],
  exports: [HospitalsService, HospitalRankingService],
})
export class HospitalsModule {}
