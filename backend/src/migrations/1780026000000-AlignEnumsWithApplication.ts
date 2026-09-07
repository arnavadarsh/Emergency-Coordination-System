import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add the enum values the application uses but the database never had.
 *
 * The TypeScript enums in common/enums grew past the Postgres types created by
 * the initial migration, and nothing caught it: SQLite stores these as text, so
 * local development was happy while the deployed schema rejected the writes.
 *
 *   booking_status   — missing PENDING, the state every emergency booking is
 *                      created in. Emergency bookings failed outright with
 *                      "invalid input value for enum booking_status: PENDING".
 *
 *   ambulance_status — missing PENDING, the state a newly registered ambulance
 *                      waits in for admin verification, and RESERVED, which the
 *                      application's AmbulanceStatus enum also defines.
 *
 * ALTER TYPE ... ADD VALUE runs inside a transaction on PostgreSQL 12 and
 * later, provided the new value is not used in the same transaction. It is not
 * used here.
 */
export class AlignEnumsWithApplication1780026000000 implements MigrationInterface {
    name = 'AlignEnumsWithApplication1780026000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'PENDING'`);
        await queryRunner.query(`ALTER TYPE "ambulance_status" ADD VALUE IF NOT EXISTS 'PENDING'`);
        await queryRunner.query(`ALTER TYPE "ambulance_status" ADD VALUE IF NOT EXISTS 'RESERVED'`);
    }

    public async down(): Promise<void> {
        // Postgres cannot remove a value from an enum type. Reversing this would
        // mean rebuilding each type and rewriting every column that uses it,
        // which risks far more than it undoes — and any row already written with
        // one of these values would have nowhere to go.
        // Deliberately a no-op.
    }
}
