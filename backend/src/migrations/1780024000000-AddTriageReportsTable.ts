import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `triage_reports` table.
 *
 * The TriageReport entity was added to the codebase without a matching
 * migration, so the table never existed in the deployed schema even though
 * `bookings.triage_report_id` did. Any query joining the relation therefore
 * failed with `relation "triage_reports" does not exist` — which broke
 * BookingsService.autoDispatch (and with it the hospital pre-arrival alert)
 * as well as the case-report endpoint.
 *
 * The table/enum DDL below is exactly what `typeorm migration:generate`
 * produced from the entity, so column names and the primary-key constraint
 * name match what TypeORM expects. Note the camelCase `emergencyType` and
 * `painLevel` columns: that entity declares no explicit `name:` options, so
 * TypeORM's default naming strategy keeps the property names verbatim.
 *
 * Everything is guarded so the migration is safe to re-run. The UNIQUE and
 * FOREIGN KEY constraints on `bookings.triage_report_id` are additive and
 * valid against existing rows, where that column is uniformly NULL.
 */
export class AddTriageReportsTable1780024000000 implements MigrationInterface {
  name = 'AddTriageReportsTable1780024000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`DO $$ BEGIN
      CREATE TYPE "public"."triage_reports_emergencytype_enum" AS ENUM('CARDIAC', 'TRAUMA', 'NEURO');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "triage_reports" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "emergencyType" "public"."triage_reports_emergencytype_enum" NOT NULL,
      "breathing" boolean NOT NULL,
      "bleeding" boolean NOT NULL,
      "conscious" boolean NOT NULL,
      "painLevel" integer NOT NULL,
      "pregnancy" boolean NOT NULL,
      CONSTRAINT "PK_8458c7ea18a26ed1f1d663be2b3" PRIMARY KEY ("id")
    )`);

    await queryRunner.query(`DO $$ BEGIN
      ALTER TABLE "bookings" ADD CONSTRAINT "UQ_63323f8c510a3d122c154b2bc68" UNIQUE ("triage_report_id");
    EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$`);

    await queryRunner.query(`DO $$ BEGIN
      ALTER TABLE "bookings" ADD CONSTRAINT "FK_63323f8c510a3d122c154b2bc68"
        FOREIGN KEY ("triage_report_id") REFERENCES "triage_reports"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "FK_63323f8c510a3d122c154b2bc68"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "UQ_63323f8c510a3d122c154b2bc68"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "triage_reports"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."triage_reports_emergencytype_enum"`);
  }
}
