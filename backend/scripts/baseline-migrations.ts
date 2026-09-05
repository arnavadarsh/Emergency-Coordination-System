/**
 * Baseline the migration history against a database whose schema already exists.
 *
 * This project's Supabase database was built before the migration files caught
 * up with it: the tables are there, but only the four most recent migrations
 * are recorded as run. TypeORM therefore treats the seven older ones as pending
 * and, on the next `migration:run`, tries to CREATE TABLE over live tables —
 * which fails, and would take a deploy down with it if migrations run at boot.
 *
 * Baselining records those older migrations as applied without executing them,
 * so only genuinely new migrations run from here on.
 *
 * The rule is deliberately narrow and safe: a migration is only baselined when
 * it is OLDER than one already recorded as run. Anything newer than the current
 * head is left alone — that is real, unapplied work, and skipping it would
 * silently leave the schema incomplete.
 *
 *   npm run migration:baseline           # report only, changes nothing
 *   npm run migration:baseline -- --apply
 */
import 'dotenv/config';
import { readdirSync } from 'fs';
import { join } from 'path';
import dataSource from '../src/config/typeorm.config';

interface MigrationFile {
  timestamp: number;
  name: string;
}

/** Migration class names are `<Name><timestamp>`, matching the file name. */
function discoverMigrationFiles(): MigrationFile[] {
  const directory = join(__dirname, '..', 'src', 'migrations');
  return readdirSync(directory)
    .filter(file => /^\d+-.+\.ts$/.test(file))
    .map(file => {
      const [timestamp, rest] = file.replace(/\.ts$/, '').split(/-(.+)/);
      return { timestamp: Number(timestamp), name: `${rest}${timestamp}` };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();

  try {
    const hasTable = await runner.hasTable('migrations');
    if (!hasTable) {
      console.log('No migrations table yet — this database has no history to baseline.');
      console.log('Run `npm run migration:run` instead; it will build the schema from scratch.');
      return;
    }

    const recorded: { timestamp: string; name: string }[] = await runner.query(
      'SELECT timestamp, name FROM migrations ORDER BY timestamp ASC',
    );
    const recordedNames = new Set(recorded.map(row => row.name));

    if (recorded.length === 0) {
      console.log('The migrations table is empty — nothing to baseline against.');
      return;
    }

    const head = Number(recorded[recorded.length - 1].timestamp);
    const files = discoverMigrationFiles();

    const toBaseline = files.filter(file => !recordedNames.has(file.name) && file.timestamp < head);
    const stillPending = files.filter(file => !recordedNames.has(file.name) && file.timestamp > head);

    console.log(`Recorded as run: ${recorded.length}`);
    console.log(`Current head:    ${recorded[recorded.length - 1].name}\n`);

    if (toBaseline.length === 0) {
      console.log('Nothing to baseline — every older migration is already recorded.');
    } else {
      console.log(`Older than the head and unrecorded — their effects are already in the schema:`);
      toBaseline.forEach(file => console.log(`  ${file.name}`));
    }

    if (stillPending.length > 0) {
      console.log(`\nNewer than the head — these are real pending migrations and will NOT be baselined:`);
      stillPending.forEach(file => console.log(`  ${file.name}`));
      console.log('  → run `npm run migration:run` to apply them.');
    }

    if (toBaseline.length === 0) return;

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to record the migrations listed above.');
      return;
    }

    await runner.startTransaction();
    try {
      for (const file of toBaseline) {
        await runner.query('INSERT INTO migrations (timestamp, name) VALUES ($1, $2)', [file.timestamp, file.name]);
      }
      await runner.commitTransaction();
      console.log(`\nBaselined ${toBaseline.length} migration(s). Now run: npm run migration:run`);
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error('Baseline failed:', error?.message ?? error);
  process.exit(1);
});
