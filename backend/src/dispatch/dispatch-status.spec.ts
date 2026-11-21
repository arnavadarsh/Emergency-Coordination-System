import { ACTIVE_DISPATCH_STATUSES, canonicalDispatchStatus, checkDriverTransition } from './dispatch-status';

/**
 * A trip has to happen in order: the hospital's pre-arrival view, the family's
 * tracking page and every stage timestamp assume it does.
 */
describe('checkDriverTransition', () => {
  it.each([
    ['DISPATCHED', 'EN_ROUTE_PICKUP'],
    ['ASSIGNED', 'EN_ROUTE_PICKUP'],
    ['EN_ROUTE_PICKUP', 'AT_PICKUP'],
    ['EN_ROUTE', 'AT_PICKUP'],
    ['AT_PICKUP', 'EN_ROUTE_HOSPITAL'],
    ['EN_ROUTE_HOSPITAL', 'AT_HOSPITAL'],
    ['AT_HOSPITAL', 'COMPLETED'],
  ])('lets a driver move %s → %s', (from, to) => {
    expect(checkDriverTransition(from, to)).toEqual({ ok: true, noop: false, status: to });
  });

  it('treats repeating the current step as a harmless no-op', () => {
    expect(checkDriverTransition('AT_PICKUP', 'AT_PICKUP')).toEqual({ ok: true, noop: true, status: 'AT_PICKUP' });
  });

  it('stores the database spelling when a client sends an older name', () => {
    expect(checkDriverTransition('DISPATCHED', 'EN_ROUTE')).toEqual({ ok: true, noop: false, status: 'EN_ROUTE_PICKUP' });
    expect(canonicalDispatchStatus('ASSIGNED')).toBe('DISPATCHED');
  });

  it('only ever queries for values the dispatch_status enum accepts', () => {
    const enumValues = ['DISPATCHED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_HOSPITAL', 'AT_HOSPITAL', 'COMPLETED', 'CANCELLED'];
    expect(ACTIVE_DISPATCH_STATUSES.every(status => enumValues.includes(status))).toBe(true);
  });

  it('refuses skipping a step', () => {
    const result = checkDriverTransition('DISPATCHED', 'COMPLETED');
    expect(result.ok).toBe(false);
  });

  it('refuses going backwards', () => {
    expect(checkDriverTransition('EN_ROUTE_HOSPITAL', 'EN_ROUTE_PICKUP').ok).toBe(false);
  });

  it('refuses touching a finished or cancelled trip', () => {
    expect(checkDriverTransition('COMPLETED', 'COMPLETED').ok).toBe(false);
    expect(checkDriverTransition('CANCELLED', 'EN_ROUTE_PICKUP').ok).toBe(false);
  });

  it('refuses statuses a driver cannot set', () => {
    expect(checkDriverTransition('DISPATCHED', 'CANCELLED').ok).toBe(false);
    expect(checkDriverTransition('DISPATCHED', 'WHATEVER').ok).toBe(false);
  });
});
