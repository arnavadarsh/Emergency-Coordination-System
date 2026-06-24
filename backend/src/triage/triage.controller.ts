import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { TriageService, TriageScoreResult } from './triage.service';
import { TriageLlmService, TriageConverseResult } from './triage-llm.service';
import { TriageScoreDto } from './dto/triage-score.dto';
import { TriageConverseDto } from './dto/triage-converse.dto';

/**
 * Triage Controller
 * Provides triage assessment endpoints.
 *
 * Routes:
 *   POST /api/triage/assess  — legacy keyword-based assessment (unchanged)
 *   POST /api/triage/score   — NEW vitals-based numeric scoring engine
 */
@Controller('triage')
export class TriageController {
  constructor(
    private readonly triageService: TriageService,
    private readonly triageLlmService: TriageLlmService,
  ) {}

  /**
   * POST /api/triage/converse
   * Gemini-powered natural-language triage. Accepts the running conversation
   * and returns the next reply, extracted answers, quick replies, and a `done`
   * flag. Falls back gracefully (`available: false`) when no API key is set.
   */
  @Post('converse')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async converse(@Body() body: TriageConverseDto): Promise<TriageConverseResult> {
    return this.triageLlmService.converse(body.messages, body.lang);
  }

  /**
   * POST /api/triage/assess
   * Accepts collected triage answers and returns a structured assessment.
   * Provides server-side validation of the client-side inference.
   * (Existing endpoint — untouched)
   */
  @Post('assess')
  @HttpCode(HttpStatus.OK)
  async assessEmergency(@Body() body: { answers: Record<string, string> }) {
    return this.triageService.assessEmergency(body.answers);
  }

  /**
   * POST /api/triage/score
   *
   * Vitals-based triage scoring engine.
   * Accepts structured vital signs and symptom data and returns:
   *   - severityScore          : numeric composite score (0–110+)
   *   - priorityLevel          : CRITICAL | HIGH | MODERATE | LOW
   *   - riskFlags              : plain-English clinical warnings
   *   - recommendedAmbulanceType : ICU | ALS | BLS
   *   - reasoning              : per-factor scoring explanation
   *   - scoringBreakdown       : points per vitals category
   *   - assessedAt             : ISO-8601 timestamp
   *
   * Responds with 400 Bad Request if any required field is missing or invalid.
   *
   * @example
   * POST /api/triage/score
   * {
   *   "symptoms": ["chest pain", "difficulty breathing"],
   *   "oxygenLevel": 88,
   *   "bloodPressureSystolic": 85,
   *   "bloodPressureDiastolic": 55,
   *   "heartRate": 135,
   *   "consciousnessLevel": "VERBAL",
   *   "accidentSeverity": "MODERATE"
   * }
   */
  @Post('score')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  scoreVitals(@Body() body: TriageScoreDto): TriageScoreResult {
    return this.triageService.scoreVitals(body);
  }
}
