import { Global, Module } from '@nestjs/common';
import { TravelTimeService } from './travel-time.service';

/**
 * Travel Time Module
 * Global: dispatch, hospital ranking and reroute all need the same road-time
 * answers, and sharing one instance means they share its cache and its budget.
 */
@Global()
@Module({
  providers: [TravelTimeService],
  exports: [TravelTimeService],
})
export class TravelTimeModule {}
