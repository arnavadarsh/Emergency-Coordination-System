import { Injectable } from '@nestjs/common';

/**
 * Triage Service
 * Placeholder for future triage logic
 * Phase 0: NO BUSINESS LOGIC
 */
@Injectable()
export class TriageService {
  /**
   * Placeholder method for triage assessment
   * Will be implemented in later phases
   */
  async assessEmergency(data: any): Promise<any> {
    // TODO: Implement triage logic in Phase 1
    return {
      severity: null,
      recommendations: [],
      message: 'Triage logic not yet implemented',
    };
  }
}
