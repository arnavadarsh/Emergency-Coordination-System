import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmbulancesController } from './ambulances.controller';
import { AmbulancesService } from './ambulances.service';
import { Ambulance } from './entities/ambulance.entity';
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ambulance]),
    forwardRef(() => DispatchModule),
  ],
  controllers: [AmbulancesController],
  providers: [AmbulancesService],
  exports: [AmbulancesService, TypeOrmModule],
})
export class AmbulancesModule {}
