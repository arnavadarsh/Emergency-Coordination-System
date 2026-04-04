import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { TriageService } from './triage.service';

/**
 * Triage Controller
 * Provides AI triage assessment endpoint
 */
@Controller('triage')
export class TriageController {
  constructor(private readonly triageService: TriageService) {}

  /**
   * POST /api/triage/assess
   * Accepts collected triage answers and returns a structured assessment.
   * Provides server-side validation of the client-side inference.
   */
  @Post('assess')
  @HttpCode(HttpStatus.OK)
  async assessEmergency(@Body() body: { answers: Record<string, string> }) {
    return this.triageService.assessEmergency(body.answers);
  }
}
