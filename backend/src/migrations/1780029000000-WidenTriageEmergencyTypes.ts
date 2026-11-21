import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Let a triage report record every category the triage engine produces.
 *
 * The enum only had CARDIAC, TRAUMA and NEURO, so respiratory and obstetric
 * emergencies could not be stored at all — and bookings made from the patient
 * app stored no triage report. The hospital then received a pre-arrival alert
 * with no emergency type, and hospital ranking could not match a patient to a
 * specialist unit.
 *
 * ALTER TYPE ... ADD VALUE runs inside a transaction on PostgreSQL 12 and
 * later, provided the new value is not used in the same transaction.
 */
export class WidenTriageEmergencyTypes1780029000000 implements MigrationInterface {
    name = 'WidenTriageEmergencyTypes1780029000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const value of ['RESPIRATORY', 'OBSTETRIC', 'OTHER']) {
            await queryRunner.query(
                `ALTER TYPE "public"."triage_reports_emergencytype_enum" ADD VALUE IF NOT EXISTS '${value}'`,
            );
        }
    }

    public async down(): Promise<void> {
        // Postgres cannot drop an enum value, and existing rows may use the new ones.
    }
}
