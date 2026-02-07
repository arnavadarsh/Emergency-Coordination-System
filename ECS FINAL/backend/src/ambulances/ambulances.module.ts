import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmbulancesService } from './ambulances.service';
import { AmbulancesController } from './ambulances.controller';
import { Ambulance } from './entities';

@Module({
  imports: [TypeOrmModule.forFeature([Ambulance])],
  controllers: [AmbulancesController],
  providers: [AmbulancesService],
  exports: [AmbulancesService],
})
export class AmbulancesModule {}
