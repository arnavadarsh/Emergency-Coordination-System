import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * bookings.scheduled_time — when a SCHEDULED transport is wanted.
 *
 * An earlier migration dropped this column, after which the patient app's
 * "Schedule" form could not be saved at all. It is nullable: an emergency
 * booking has no scheduled time.
 */
export class AddBookingScheduledTime1780030000000 implements MigrationInterface {
    name = 'AddBookingScheduledTime1780030000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "scheduled_time" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "scheduled_time"`);
    }
}
