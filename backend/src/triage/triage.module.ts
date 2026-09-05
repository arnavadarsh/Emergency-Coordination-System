import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TriageService } from './triage.service';
import { TriageLlmService } from './triage-llm.service';
import { GeminiBudgetService } from './gemini-budget.service';
import { TriageController } from './triage.controller';
import { Booking } from '../bookings/entities/booking.entity';
import { TriageReport } from './entities/triage.entity';
import { BookingsModule } from '../bookings/bookings.module';

/**
 * Triage Module
 * Placeholder for future triage logic
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, TriageReport]),
    forwardRef(() => BookingsModule),
  ],
  controllers: [TriageController],
  providers: [TriageService, TriageLlmService, GeminiBudgetService],
  exports: [TriageService, TriageLlmService, GeminiBudgetService],
})
export class TriageModule {}
