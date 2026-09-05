import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time correction for timestamps written while the backend ran in Asia/Calcutta.
 *
 * Columns populated by application code (`new Date()`) landed in `timestamp without
 * time zone` columns as IST wall-clock, while columns using `DEFAULT now()` stored UTC.
 * The same dispatch row therefore disagreed with itself by exactly 5:30.
 *
 * The process is now pinned to UTC, so new writes are correct. This shifts the existing
 * code-written values back by 5:30 so the whole table shares one meaning.
 *
 * Columns fed by `DEFAULT now()` (every `created_at`) are already UTC and are NOT touched.
 */
export class NormalizeIstTimestampsToUtc1780021000000 implements MigrationInterface {
  name = 'NormalizeIstTimestampsToUtc1780021000000';

  /** table -> code-written timestamp columns. */
  private static readonly COLUMNS: Array<[string, string[]]> = [
    ['dispatches', ['dispatched_at', 'arrived_at_pickup', 'departed_pickup', 'arrived_at_hospital', 'completed_at']],
    ['bookings', ['completed_at', 'cancelled_at']],
    ['users', ['last_login']],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, columns] of NormalizeIstTimestampsToUtc1780021000000.COLUMNS) {
      const assignments = columns.map(c => `"${c}" = "${c}" - INTERVAL '5 hours 30 minutes'`).join(', ');
      const guard = columns.map(c => `"${c}" IS NOT NULL`).join(' OR ');
      await queryRunner.query(`UPDATE "${table}" SET ${assignments} WHERE ${guard}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, columns] of NormalizeIstTimestampsToUtc1780021000000.COLUMNS) {
      const assignments = columns.map(c => `"${c}" = "${c}" + INTERVAL '5 hours 30 minutes'`).join(', ');
      const guard = columns.map(c => `"${c}" IS NOT NULL`).join(' OR ');
      await queryRunner.query(`UPDATE "${table}" SET ${assignments} WHERE ${guard}`);
    }
  }
}
