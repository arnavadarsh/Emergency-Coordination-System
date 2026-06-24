import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the booking_messages table backing the patient ↔ driver chat.
 */
export class CreateBookingMessages1780100000000 implements MigrationInterface {
  name = 'CreateBookingMessages1780100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "booking_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "booking_id" uuid NOT NULL,
        "sender_role" character varying(16) NOT NULL,
        "sender_id" uuid NOT NULL,
        "sender_name" character varying(120),
        "text" text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_booking_messages" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_booking_messages_booking_created" ON "booking_messages" ("booking_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_messages_booking_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_messages"`);
  }
}
