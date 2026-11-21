import { DispatchRetryService } from './dispatch-retry.service';
import { SeverityLevel } from '../common/enums';

/**
 * Bookings that found every ambulance busy must still get one when a unit
 * frees — most urgent first — instead of waiting forever.
 */
describe('DispatchRetryService', () => {
  const booking = (id: string, severity: SeverityLevel, minutesAgo: number): any => ({
    id,
    severity,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
    triageReport: null,
  });

  let bookingsService: { findWaitingForAmbulance: jest.Mock; tryDispatch: jest.Mock };
  let settings: Record<string, unknown>;
  let service: DispatchRetryService;

  beforeEach(() => {
    bookingsService = { findWaitingForAmbulance: jest.fn(), tryDispatch: jest.fn() };
    settings = { autoDispatchEnabled: true, dispatchRetryMaxAgeMinutes: 120 };
    service = new DispatchRetryService(bookingsService as any, { get: (key: string) => settings[key] } as any);
  });

  it('orders by severity first, then by how long each has waited', () => {
    const ordered = DispatchRetryService.prioritise([
      booking('low-old', SeverityLevel.LOW, 30),
      booking('critical-new', SeverityLevel.CRITICAL, 1),
      booking('high-new', SeverityLevel.HIGH, 2),
      booking('high-old', SeverityLevel.HIGH, 20),
    ]);
    expect(ordered.map(b => b.id)).toEqual(['critical-new', 'high-old', 'high-new', 'low-old']);
  });

  it('dispatches waiting bookings in priority order and stops when units run out', async () => {
    bookingsService.findWaitingForAmbulance.mockResolvedValue([
      booking('medium', SeverityLevel.MEDIUM, 10),
      booking('critical', SeverityLevel.CRITICAL, 5),
      booking('low', SeverityLevel.LOW, 15),
    ]);
    // One ambulance free: the first attempt succeeds, the next finds none.
    bookingsService.tryDispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.run('test');

    expect(bookingsService.tryDispatch.mock.calls.map(([b]) => b.id)).toEqual(['critical', 'medium']);
  });

  it('never runs two passes at once, but queues one more for a trigger that arrives mid-run', async () => {
    let release!: () => void;
    bookingsService.findWaitingForAmbulance
      .mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]); }))
      .mockResolvedValue([]);

    const first = service.run('first');
    await service.run('second');
    await service.run('third');
    expect(bookingsService.findWaitingForAmbulance).toHaveBeenCalledTimes(1);

    release();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    expect(bookingsService.findWaitingForAmbulance).toHaveBeenCalledTimes(2);
  });

  it('stands aside while an admin has auto-dispatch switched off, unless forced', async () => {
    settings.autoDispatchEnabled = false;
    bookingsService.findWaitingForAmbulance.mockResolvedValue([]);

    await service.run('timer');
    expect(bookingsService.findWaitingForAmbulance).not.toHaveBeenCalled();

    await service.run('admin', true);
    expect(bookingsService.findWaitingForAmbulance).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a failure', async () => {
    bookingsService.findWaitingForAmbulance.mockRejectedValueOnce(new Error('db down')).mockResolvedValue([]);
    await expect(service.run('test')).resolves.toBeUndefined();
    await expect(service.run('test')).resolves.toBeUndefined();
  });
});
