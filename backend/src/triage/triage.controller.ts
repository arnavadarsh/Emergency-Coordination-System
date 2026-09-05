import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { TriageService, TriageScoreResult } from './triage.service';
import { TriageLlmService, TriageConverseResult } from './triage-llm.service';
import { TriageScoreDto } from './dto/triage-score.dto';
import { TriageConverseDto } from './dto/triage-converse.dto';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators';
import { UserRole } from '../common/enums';

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
   *
   * This route is intentionally open — a bystander calling for someone else has
   * no account — so it is also the one route where an outsider can spend money.
   * Two controls sit in front of it:
   *
   *   - this per-caller ceiling, which answers 429 to a caller sending too much
   *     (the client treats that like any other failure and drops to its offline
   *     rule-based engine, so a throttled patient is still triaged);
   *   - the global rate, daily request/token budgets, concurrency cap and
   *     upstream cooldown inside GeminiBudgetService, which protect the bill
   *     across all callers.
   */
  @Post('converse')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    bucket: 'triage-converse',
    limit: 15,
    windowSeconds: 60,
    limitPath: 'gemini.limits.perCallerPerMinute',
  })
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async converse(@Body() body: TriageConverseDto): Promise<TriageConverseResult> {
    return this.triageLlmService.converse(body.messages, body.lang);
  }

  /**
   * GET /api/triage/llm/usage
   *
   * What the triage LLM has cost so far and what is currently allowed: rolling
   * request and token counts, the configured ceilings, why calls were refused,
   * and an approximate spend. Admin-only — it reports operational state, not
   * anything clinical.
   */
  @Get('llm/usage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getLlmUsage() {
    return this.triageLlmService.getUsage();
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
