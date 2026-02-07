import { Controller } from '@nestjs/common';
import { TriageService } from './triage.service';

/**
 * Triage Controller
 * Placeholder for future triage endpoints
 */
@Controller('triage')
export class TriageController {
  constructor(private readonly triageService: TriageService) {}

  // Endpoints will be added in later phases
}
