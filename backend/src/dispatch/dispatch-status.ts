/**
 * The order a trip moves through, as the driver reports it.
 *
 * These are exactly the values of the `dispatch_status` enum in the deployed
 * Postgres schema — anything else is refused by the database, so nothing else
 * may be written or used in a query. ASSIGNED and EN_ROUTE are older client
 * names for DISPATCHED and EN_ROUTE_PICKUP; they are accepted on input and
 * translated before they reach the database.
 */
export const DISPATCH_STATUSES = [
  'DISPATCHED',
  'EN_ROUTE_PICKUP',
  'AT_PICKUP',
  'EN_ROUTE_HOSPITAL',
  'AT_HOSPITAL',
  'COMPLETED',
  'CANCELLED',
] as const;

const ALIASES: Record<string, string> = {
  ASSIGNED: 'DISPATCHED',
  EN_ROUTE: 'EN_ROUTE_PICKUP',
};

/** Stage index of each status on the way to COMPLETED; CANCELLED is off the path. */
const STAGE: Record<string, number> = {
  DISPATCHED: 0,
  EN_ROUTE_PICKUP: 1,
  AT_PICKUP: 2,
  EN_ROUTE_HOSPITAL: 3,
  AT_HOSPITAL: 4,
  COMPLETED: 5,
};

export const TERMINAL_DISPATCH_STATUSES = ['COMPLETED', 'CANCELLED'];

/** Every status a dispatch can hold while the ambulance is still on the case. Safe for SQL `IN (...)`. */
export const ACTIVE_DISPATCH_STATUSES = ['DISPATCHED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_HOSPITAL', 'AT_HOSPITAL'];

/** The database spelling of a status, translating the older aliases. */
export function canonicalDispatchStatus(status: string): string {
  return ALIASES[status] ?? status;
}

export function isKnownDispatchStatus(status: string): boolean {
  return (DISPATCH_STATUSES as readonly string[]).includes(canonicalDispatchStatus(status));
}

export type TransitionCheck =
  | { ok: true; noop: boolean; status: string }
  | { ok: false; reason: string };

/**
 * Whether a driver may move a trip from `current` to `next`.
 *
 * Repeating the current status is accepted as a no-op, so a double-tap on the
 * driver's button is harmless. Skipping a stage, going backwards, or touching a
 * finished trip is refused — the timestamps, the family's tracking page and the
 * hospital's pre-arrival view all assume the stages happen in order. On
 * success, `status` is the value to store.
 */
export function checkDriverTransition(current: string, next: string): TransitionCheck {
  const from = canonicalDispatchStatus(current);
  const to = canonicalDispatchStatus(next);

  if (TERMINAL_DISPATCH_STATUSES.includes(from)) {
    return { ok: false, reason: `This trip is already ${from.toLowerCase()}.` };
  }
  if (!(to in STAGE)) {
    return { ok: false, reason: `"${next}" is not a status a driver can set.` };
  }

  const fromStage = STAGE[from] ?? 0;
  const toStage = STAGE[to];
  if (toStage === fromStage) return { ok: true, noop: true, status: to };
  if (toStage === fromStage + 1) return { ok: true, noop: false, status: to };

  return {
    ok: false,
    reason: toStage < fromStage
      ? `A trip cannot go back from ${from} to ${to}.`
      : `A trip cannot skip from ${from} to ${to}; complete the steps in order.`,
  };
}
