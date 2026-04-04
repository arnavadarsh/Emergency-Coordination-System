import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNotificationPreferencesAndSavedLocations1707829800000 implements MigrationInterface {
    name = 'AddNotificationPreferencesAndSavedLocations1707829800000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add notification preferences columns to users table
        await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN IF NOT EXISTS "email_notifications" boolean NOT NULL DEFAULT true
        `);
        await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN IF NOT EXISTS "sms_notifications" boolean NOT NULL DEFAULT true
        `);
        await queryRunner.query(`
            ALTER TABLE "users" 
            ADD COLUMN IF NOT EXISTS "push_notifications" boolean NOT NULL DEFAULT true
        `);

        // Create saved_locations table
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "saved_locations" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "label" character varying(100) NOT NULL,
                "address" text NOT NULL,
                "latitude" numeric(10,7) NOT NULL,
                "longitude" numeric(10,7) NOT NULL,
                "is_default" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_saved_locations" PRIMARY KEY ("id"),
                CONSTRAINT "FK_saved_locations_user" FOREIGN KEY ("user_id") 
                    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);

        // Create index on user_id for faster lookups
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_saved_locations_user_id" 
            ON "saved_locations" ("user_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop saved_locations table
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_saved_locations_user_id"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "saved_locations"`);

        // Remove notification preferences columns
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "push_notifications"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "sms_notifications"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "email_notifications"`);
    }
}
