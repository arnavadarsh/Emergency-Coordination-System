import { isSqlite } from '../config/env';

/**
 * Driver-aware column types.
 *
 * The system runs on Postgres in every real deployment and on SQLite for local
 * work (USE_SQLITE=true). better-sqlite3 has no `enum` and no `jsonb`, so
 * entities that name those types directly make the local path fail to boot with
 * `DataTypeNotSupportedError` before a single query runs.
 *
 * These helpers leave the Postgres mapping exactly as it was — `enum` and
 * `jsonb`, the types the deployed schema and its migrations are built on — and
 * substitute SQLite's equivalents only when the process is actually using
 * SQLite. `simple-enum` stores the same strings with a check constraint, and
 * `simple-json` stores JSON as text, so application code sees no difference.
 */

export const enumColumnType = (): 'enum' | 'simple-enum' => (isSqlite() ? 'simple-enum' : 'enum');

export const jsonColumnType = (): 'jsonb' | 'simple-json' => (isSqlite() ? 'simple-json' : 'jsonb');

/**
 * `timestamp` for Postgres, `datetime` for SQLite. Both store a naive
 * wall-clock instant, which the process pins to UTC (see config/timezone.ts).
 */
export const timestampColumnType = (): 'timestamp' | 'datetime' => (isSqlite() ? 'datetime' : 'timestamp');

/**
 * `NOW()` for Postgres, `CURRENT_TIMESTAMP` for SQLite — used as a column
 * DEFAULT, where the two dialects disagree on the spelling.
 */
export const nowDefault = (): string => (isSqlite() ? 'CURRENT_TIMESTAMP' : 'NOW()');
