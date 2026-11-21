import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Admin controls.
 *
 *   users.sessions_revoked_at   tokens issued before it are refused — "sign out
 *                               everywhere" and password resets
 *   system_settings             runtime switches the admin console edits
 *                               (auto-dispatch, sign-up, contact SMS, …)
 */
export class AddAdminControls1780028000000 implements MigrationInterface {
    name = 'AddAdminControls1780028000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessions_revoked_at" TIMESTAMP`);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "system_settings" (
                "key" character varying(60) NOT NULL,
                "value" text NOT NULL,
                "updated_by" uuid,
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_system_settings_key" PRIMARY KEY ("key")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "system_settings"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "sessions_revoked_at"`);
    }
}
