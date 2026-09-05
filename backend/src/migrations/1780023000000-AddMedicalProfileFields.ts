import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the structured Medical Profile columns to `users`.
 *
 * `blood_type` already existed and is reused as the Blood Group field, so it is
 * not recreated here. All columns are nullable: existing patient IDs stay valid
 * with no medical information on record, and the profile can be filled in later.
 */
export class AddMedicalProfileFields1780023000000 implements MigrationInterface {
  name = 'AddMedicalProfileFields1780023000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allergies" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "chronic_conditions" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_medications" text`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "medical_profile_updated_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "medical_profile_updated_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "current_medications"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "chronic_conditions"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "allergies"`);
  }
}
