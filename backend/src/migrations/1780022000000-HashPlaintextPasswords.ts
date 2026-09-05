import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

/**
 * One-time conversion of plaintext passwords to bcrypt hashes.
 *
 * Registration previously stored the raw password and login compared it with `===`.
 * Every existing credential is therefore readable in the database. This rehashes each
 * one in place so the plaintext is gone while users keep the same password.
 *
 * Rows already holding a bcrypt hash are skipped, so this is safe to re-run.
 *
 * There is no down(): the plaintext cannot be recovered, which is the entire point.
 */
export class HashPlaintextPasswords1780022000000 implements MigrationInterface {
  name = 'HashPlaintextPasswords1780022000000';

  private static readonly BCRYPT_ROUNDS = 12;
  /** Anything not already in modern bcrypt format is treated as plaintext. */
  private static readonly BCRYPT_PATTERN = '^\\$2[aby]\\$';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; password: string }> = await queryRunner.query(
      `SELECT id, password FROM "users" WHERE password !~ '${HashPlaintextPasswords1780022000000.BCRYPT_PATTERN}'`,
    );

    for (const row of rows) {
      const hash = await bcrypt.hash(row.password, HashPlaintextPasswords1780022000000.BCRYPT_ROUNDS);
      await queryRunner.query(`UPDATE "users" SET password = $1 WHERE id = $2`, [hash, row.id]);
    }
  }

  public async down(): Promise<void> {
    // Irreversible by design — hashing is one-way.
  }
}
