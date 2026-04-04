import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { Dispatch } from './entities';
import { Booking } from '../bookings/entities/booking.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Dispatch, Booking, Ambulance]), RealtimeModule],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
