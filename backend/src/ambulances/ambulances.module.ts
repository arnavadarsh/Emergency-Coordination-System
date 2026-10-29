import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmbulancesController } from './ambulances.controller';
import { AmbulancesService } from './ambulances.service';
import { Ambulance } from './entities/ambulance.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ambulance, Dispatch]),
    forwardRef(() => DispatchModule),
    RealtimeModule,
  ],
  controllers: [AmbulancesController],
  providers: [AmbulancesService],
  exports: [AmbulancesService, TypeOrmModule],
})
export class AmbulancesModule {}
