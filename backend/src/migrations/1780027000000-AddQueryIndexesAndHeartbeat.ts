import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Indexes behind the rewritten dashboard queries and access checks, and the
 * keep-alive heartbeat table.
 *
 *   users(role)                     admin console role counts
 *   users(hospital_id)              hospital account lookups
 *   users(ambulance_id)             driver identity and "is this the assigned driver"
 *   dispatches(driver_id)           a driver's own trips
 *   bookings(user_id, created_at)   a patient's bookings, newest first
 *   bookings(status, created_at)    open bookings, for counts and the dispatch retry worker
 *
 * IF NOT EXISTS throughout, so this is safe on a database where someone added
 * an index by hand.
 */
export class AddQueryIndexesAndHeartbeat1780027000000 implements MigrationInterface {
    name = 'AddQueryIndexesAndHeartbeat1780027000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_role" ON "users" ("role")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_hospital_id" ON "users" ("hospital_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_ambulance_id" ON "users" ("ambulance_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dispatches_driver_id" ON "dispatches" ("driver_id")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bookings_user_created" ON "bookings" ("user_id", "created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_bookings_status_created" ON "bookings" ("status", "created_at")`);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "system_heartbeat" (
                "id" integer NOT NULL,
                "beat_at" TIMESTAMP NOT NULL,
                "source" character varying(30),
                CONSTRAINT "PK_system_heartbeat_id" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "system_heartbeat"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_status_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_user_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dispatches_driver_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_ambulance_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_hospital_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_role"`);
    }
}
