import {
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  ArrayMinSize,
  Max,
  Min,
} from 'class-validator';

/**
 * AVPU Consciousness Scale
 * Standard triage consciousness assessment tool.
 */
export enum ConsciousnessLevel {
  ALERT = 'ALERT',
  VERBAL = 'VERBAL',
  PAIN = 'PAIN',
  UNRESPONSIVE = 'UNRESPONSIVE',
}

/**
 * Accident / Trauma Severity
 * Caller-reported or dispatcher-assessed trauma level.
 */
export enum AccidentSeverityLevel {
  NONE = 'NONE',
  MINOR = 'MINOR',
  MODERATE = 'MODERATE',
  SEVERE = 'SEVERE',
  CRITICAL = 'CRITICAL',
}

/**
 * DTO for POST /triage/score
 *
 * Accepts structured vitals and symptom data to produce a
 * numeric severity score, priority level, risk flags, and
 * an ambulance type recommendation.
 */
export class TriageScoreDto {
  /**
   * List of reported symptoms (free-text keywords).
   * Example: ["chest pain", "difficulty breathing"]
   */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  symptoms: string[];

  /**
   * SpO₂ (peripheral oxygen saturation) as a percentage.
   * Normal range: 95–100%.
   */
  @IsInt()
  @Min(50)
  @Max(100)
  oxygenLevel: number;

  /**
   * Systolic blood pressure in mmHg.
   * Normal resting: ~120 mmHg.
   */
  @IsInt()
  @Min(50)
  @Max(250)
  bloodPressureSystolic: number;

  /**
   * Diastolic blood pressure in mmHg.
   * Normal resting: ~80 mmHg.
   */
  @IsInt()
  @Min(30)
  @Max(150)
  bloodPressureDiastolic: number;

  /**
   * Heart rate in beats per minute.
   * Normal resting: 60–100 bpm.
   */
  @IsInt()
  @Min(20)
  @Max(300)
  heartRate: number;

  /**
   * Consciousness level using the AVPU scale.
   */
  @IsEnum(ConsciousnessLevel)
  consciousnessLevel: ConsciousnessLevel;

  /**
   * Reported or assessed accident / trauma severity.
   */
  @IsEnum(AccidentSeverityLevel)
  accidentSeverity: AccidentSeverityLevel;
}
