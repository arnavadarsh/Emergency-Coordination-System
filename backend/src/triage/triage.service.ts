import { Injectable } from '@nestjs/common';

/**
 * Triage Service
 * Implements server-side triage assessment logic mirroring the client-side engine.
 */

type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
type EmergencyType = 'cardiac' | 'stroke' | 'trauma' | 'respiratory' | 'neurological' | 'obstetric' | 'other';

interface AmbulanceRequirements {
  type: 'BLS' | 'ALS' | 'ICU' | 'NEONATAL';
  equipment: string[];
  staff: string[];
}

interface HospitalRecommendation {
  type: string;
  requiredUnits: string[];
  reason: string;
}

export interface TriageAssessment {
  severity: SeverityLevel;
  emergencyType: EmergencyType;
  ambulance: AmbulanceRequirements;
  hospital: HospitalRecommendation;
  reasoning: string[];
  chiefComplaint: string;
  isBreathing: boolean;
  isConscious: boolean;
  hasChestPain: boolean;
  hasSevereBleeding: boolean;
  painLevel: number;
  isPregnant: boolean;
}

@Injectable()
export class TriageService {
  /**
   * Server-side triage assessment.
   * Mirrors the client-side triageEngine.ts inference logic.
   */
  async assessEmergency(answers: Record<string, string>): Promise<TriageAssessment> {
    const emergencyType = this.mapEmergencyType(answers.emergency_type);
    const severity = this.inferSeverity(answers);
    const equipment = this.inferEquipment(answers, emergencyType);
    const staff = this.inferStaff(severity, emergencyType);
    const ambulanceType = this.inferAmbulanceType(answers, severity, emergencyType);
    const hospital = this.inferHospital(severity, emergencyType, answers);
    const reasoning = this.buildReasoning(answers, emergencyType);

    let chiefComplaint = '';
    if (answers.chief_complaint) {
      chiefComplaint = answers.chief_complaint;
    } else {
      const parts: string[] = [];
      if (answers.emergency_type) parts.push(answers.emergency_type);
      if (answers.chest_pain_type) parts.push(answers.chest_pain_type);
      if (answers.trauma_type) parts.push(answers.trauma_type);
      if (answers.breathing_detail) parts.push(answers.breathing_detail);
      if (answers.seizure_status) parts.push(answers.seizure_status);
      if (answers.pregnancy_complication) parts.push(answers.pregnancy_complication);
      chiefComplaint = parts.join(' — ') || 'Emergency';
    }

    return {
      severity,
      emergencyType,
      ambulance: { type: ambulanceType, equipment, staff },
      hospital,
      reasoning,
      chiefComplaint,
      isBreathing: answers.breathing !== 'No',
      isConscious: answers.conscious !== 'No',
      hasChestPain: emergencyType === 'cardiac',
      hasSevereBleeding: answers.bleeding === 'Yes',
      painLevel: parseInt(answers.pain_level) || 0,
      isPregnant: answers.pregnant_check === 'Yes' || emergencyType === 'obstetric',
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private mapEmergencyType(answer: string | undefined): EmergencyType {
    if (!answer) return 'other';
    if (answer.startsWith('Chest pain')) return 'cardiac';
    if (answer.startsWith('Stroke')) return 'stroke';
    if (answer.startsWith('Accident')) return 'trauma';
    if (answer.startsWith('Breathing')) return 'respiratory';
    if (answer.startsWith('Seizure')) return 'neurological';
    if (answer.startsWith('Pregnancy')) return 'obstetric';
    return 'other';
  }

  private inferSeverity(answers: Record<string, string>): SeverityLevel {
    if (answers.breathing === 'No') return 'CRITICAL';
    if (answers.conscious === 'No') return 'CRITICAL';
    if (answers.bleeding === 'Yes' && answers.breathing === 'No') return 'CRITICAL';
    if (answers.stroke_onset === 'Within the last hour') return 'CRITICAL';
    if (answers.stroke_symptoms === 'Multiple of the above') return 'CRITICAL';
    if (answers.seizure_status === 'Currently seizing') return 'CRITICAL';
    if (answers.seizure_status === 'Multiple seizures in a row') return 'CRITICAL';
    if (answers.breathing_detail === 'Choking / Airway obstruction') return 'CRITICAL';
    if (answers.breathing_detail === 'Lips or fingertips turning blue') return 'CRITICAL';
    if (answers.chest_pain_type === 'Crushing / Squeezing pressure' &&
        answers.chest_pain_duration === 'More than 30 minutes') return 'CRITICAL';
    if (answers.trauma_type === 'Penetrating injury (stab, gunshot)') return 'CRITICAL';
    if (answers.pregnancy_complication === 'Heavy vaginal bleeding') return 'CRITICAL';
    if (answers.pregnancy_complication === 'High blood pressure / Seizures') return 'CRITICAL';

    if (answers.bleeding === 'Yes') return 'HIGH';
    if (answers.chest_pain_type === 'Crushing / Squeezing pressure') return 'HIGH';
    if (answers.chest_pain_type === 'Radiating to arm, jaw, or back') return 'HIGH';
    if (answers.chest_pain_type === 'Tightness with shortness of breath') return 'HIGH';
    if (answers.stroke_onset === '1–3 hours ago') return 'HIGH';
    if (answers.trauma_type === 'Vehicle accident (car, motorcycle, bicycle)') return 'HIGH';
    if (answers.trauma_type === 'Fall from height') return 'HIGH';
    if (answers.trauma_type === 'Burns (fire, chemical, electrical)') return 'HIGH';
    if (answers.trauma_type === 'Drowning / Near-drowning') return 'HIGH';
    if (answers.trauma_mobility === 'No') return 'HIGH';
    if (answers.breathing_detail === 'Rapid shallow breathing') return 'HIGH';
    if (answers.breathing_detail === 'Cannot speak full sentences') return 'HIGH';
    if (answers.seizure_status === 'Seizure just ended, patient confused') return 'HIGH';
    if (answers.seizure_status === 'First-time seizure') return 'HIGH';
    if (answers.pregnancy_complication === 'Active labor / Contractions') return 'HIGH';
    if (answers.pregnancy_complication === 'Severe abdominal pain') return 'HIGH';
    if (answers.pregnancy_complication === 'Water broke / Membrane rupture') return 'HIGH';

    const painLevel = parseInt(answers.pain_level) || 0;
    if (painLevel >= 9) return 'HIGH';
    if (painLevel >= 5) return 'MODERATE';
    if (answers.chest_pain_type === 'Sharp / Stabbing pain') return 'MODERATE';
    if (answers.chest_pain_type === 'Burning sensation') return 'MODERATE';
    if (answers.breathing_detail === 'Wheezing / Asthma-like') return 'MODERATE';
    if (answers.pregnancy_complication === 'Decreased fetal movement') return 'MODERATE';

    return 'LOW';
  }

  private inferEquipment(answers: Record<string, string>, emergencyType: EmergencyType): string[] {
    const equipment: string[] = ['First aid kit', 'Stretcher'];

    if (answers.breathing === 'No') equipment.push('Oxygen supply', 'Ventilator / BVM', 'Pulse oximeter');
    if (answers.conscious === 'No') equipment.push('Neuro monitoring', 'Cervical collar', 'IV access kit');
    if (answers.bleeding === 'Yes') equipment.push('Tourniquet', 'Hemostatic gauze', 'IV fluids', 'Blood pressure monitor');

    if (emergencyType === 'cardiac') equipment.push('12-lead ECG', 'Defibrillator (AED)', 'Cardiac medications', 'Aspirin');
    if (emergencyType === 'stroke') equipment.push('Blood glucose monitor', 'Neuro assessment tools', 'IV access kit');
    if (emergencyType === 'trauma') {
      equipment.push('Trauma kit', 'Spinal board', 'Splints', 'Cervical collar');
      if (answers.trauma_type?.includes('Burns')) equipment.push('Burn dressings', 'Cooling packs', 'Pain medications');
    }
    if (emergencyType === 'respiratory') equipment.push('Oxygen supply', 'Nebulizer', 'Pulse oximeter', 'Suction unit');
    if (emergencyType === 'neurological') equipment.push('Anti-seizure medications', 'Oxygen supply', 'Padded restraints');
    if (emergencyType === 'obstetric') equipment.push('OB kit (delivery pack)', 'Fetal monitor', 'IV access kit', 'Oxytocin');

    return [...new Set(equipment)];
  }

  private inferStaff(severity: SeverityLevel, emergencyType: EmergencyType): string[] {
    const staff: string[] = ['EMT'];
    if (severity === 'CRITICAL' || severity === 'HIGH') staff.push('Paramedic');
    if (severity === 'CRITICAL') staff.push('Critical Care Specialist');
    if (emergencyType === 'cardiac') staff.push('Cardiac-trained Paramedic');
    if (emergencyType === 'obstetric') staff.push('OB-trained Paramedic');
    if (emergencyType === 'neurological') staff.push('Advanced Life Support Technician');
    return [...new Set(staff)];
  }

  private inferAmbulanceType(
    answers: Record<string, string>,
    severity: SeverityLevel,
    emergencyType: EmergencyType,
  ): 'BLS' | 'ALS' | 'ICU' | 'NEONATAL' {
    if (answers.breathing === 'No' || answers.conscious === 'No') return 'ICU';
    if (emergencyType === 'obstetric' && answers.pregnancy_week === 'Less than 20 weeks') return 'ALS';
    if (emergencyType === 'obstetric') return 'NEONATAL';
    if (severity === 'CRITICAL') return 'ICU';
    if (severity === 'HIGH' || severity === 'MODERATE') return 'ALS';
    return 'BLS';
  }

  private inferHospital(
    severity: SeverityLevel,
    emergencyType: EmergencyType,
    answers: Record<string, string>,
  ): HospitalRecommendation {
    const units: string[] = ['Emergency Department'];
    let type = 'General Hospital';
    let reason = '';

    switch (emergencyType) {
      case 'cardiac':
        type = 'Cardiac Center / Level 1 Trauma Center';
        units.push('Cardiac Catheterization Lab', 'ICU');
        reason = 'Cardiac emergency requires immediate access to catheterization lab and cardiac ICU';
        break;
      case 'stroke':
        type = 'Comprehensive Stroke Center';
        units.push('Neurology Unit', 'CT/MRI Imaging', 'Neuro ICU');
        reason = 'Stroke requires immediate neuroimaging and potential thrombolysis';
        break;
      case 'trauma':
        type = 'Level 1 Trauma Center';
        units.push('Trauma Surgery', 'Orthopedics', 'ICU');
        if (answers.trauma_type?.includes('Burns')) {
          type = 'Burn Center / Level 1 Trauma Center';
          units.push('Burn Unit');
          reason = 'Burn injuries require specialized burn treatment facility';
        } else {
          reason = 'Trauma requires immediate surgical capability and trauma team activation';
        }
        break;
      case 'respiratory':
        type = 'Hospital with Pulmonology Unit';
        units.push('Respiratory ICU', 'Pulmonology');
        reason = 'Respiratory emergency requires ventilator capability and pulmonology support';
        break;
      case 'neurological':
        type = 'Hospital with Neurology Unit';
        units.push('Neurology Unit', 'CT/MRI Imaging');
        reason = 'Neurological emergency requires neuro diagnostics and monitoring';
        break;
      case 'obstetric':
        type = 'Hospital with Maternity / NICU';
        units.push('Labor & Delivery', 'NICU', 'OB Surgery');
        reason = 'Obstetric emergency requires L&D unit and neonatal intensive care availability';
        break;
      default:
        if (severity === 'CRITICAL' || severity === 'HIGH') {
          type = 'Level 1 or Level 2 Trauma Center';
          units.push('ICU');
          reason = 'High-severity emergency requires advanced emergency care capability';
        } else {
          type = 'General Hospital or Urgent Care';
          reason = 'Moderate/low severity — general emergency department is sufficient';
        }
    }

    return { type, requiredUnits: [...new Set(units)], reason };
  }

  private buildReasoning(answers: Record<string, string>, emergencyType: EmergencyType): string[] {
    const reasons: string[] = [];

    if (answers.breathing === 'No') reasons.push('Patient is NOT breathing — immediate airway intervention required');
    if (answers.conscious === 'No') reasons.push('Patient is UNCONSCIOUS — neurological monitoring and ICU support needed');
    if (answers.bleeding === 'Yes') reasons.push('Severe bleeding detected — hemorrhage control and IV fluids required');

    if (emergencyType === 'cardiac') {
      reasons.push(`Cardiac event detected: ${answers.chest_pain_type || 'chest pain reported'}`);
      if (answers.chest_pain_duration) reasons.push(`Duration: ${answers.chest_pain_duration}`);
    }
    if (emergencyType === 'stroke') {
      reasons.push(`Stroke symptoms identified — onset: ${answers.stroke_onset || 'unknown'}`);
      if (answers.stroke_symptoms) reasons.push(`Symptoms: ${answers.stroke_symptoms}`);
    }
    if (emergencyType === 'trauma') {
      reasons.push(`Trauma: ${answers.trauma_type || 'injury reported'}`);
      if (answers.trauma_mobility === 'No') reasons.push('Patient cannot move limbs — possible spinal injury');
    }
    if (emergencyType === 'respiratory') {
      reasons.push(`Respiratory distress: ${answers.breathing_detail || 'breathing difficulty'}`);
    }
    if (emergencyType === 'neurological') {
      reasons.push(`Neurological event: ${answers.seizure_status || 'seizure/neuro issue'}`);
    }
    if (emergencyType === 'obstetric') {
      reasons.push(`Obstetric emergency — ${answers.pregnancy_week || 'unknown'} weeks`);
      if (answers.pregnancy_complication) reasons.push(`Complication: ${answers.pregnancy_complication}`);
    }

    if (answers.pain_level) {
      const p = parseInt(answers.pain_level);
      if (p >= 8) reasons.push(`Severe pain reported: ${p}/10`);
      else if (p >= 5) reasons.push(`Moderate pain: ${p}/10`);
      else reasons.push(`Pain level: ${p}/10`);
    }

    if (answers.pregnant_check === 'Yes' && emergencyType !== 'obstetric') {
      reasons.push('Patient is pregnant — obstetric precautions apply');
    }

    return reasons;
  }
}
