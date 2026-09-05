/**
 * Timezone normalisation. This module MUST be imported before anything opens a
 * database connection or touches a Date.
 *
 * The schema uses `timestamp without time zone`, which carries no offset. node-postgres
 * therefore interprets those values in the process's local timezone, and serialises
 * outgoing Dates the same way. Running the process in Asia/Calcutta meant:
 *
 *   - reads:  a stored UTC value came back 5:30 earlier than it really was
 *   - writes: `new Date()` was stored as IST wall-clock, while columns using the
 *             `DEFAULT now()` clock stored UTC — the same row disagreeing with itself
 *
 * Pinning the process to UTC makes both directions agree with `now()`. The explicit
 * parser below keeps reads correct even if TZ is overridden in some deployment.
 */
process.env.TZ = 'UTC';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { types } = require('pg');

/** OID for `timestamp without time zone`. */
const TIMESTAMP_OID = 1114;

types.setTypeParser(TIMESTAMP_OID, (value: string | null) =>
  value === null ? null : new Date(`${value.replace(' ', 'T')}Z`),
);
