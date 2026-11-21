import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { KeepAliveService } from './keep-alive.service';
import { SystemHeartbeat } from './entities/system-heartbeat.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SystemHeartbeat])],
  controllers: [HealthController],
  providers: [KeepAliveService],
  exports: [KeepAliveService],
})
export class HealthModule {}
