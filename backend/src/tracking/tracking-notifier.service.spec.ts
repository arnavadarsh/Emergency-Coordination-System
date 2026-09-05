import { NotFoundException } from '@nestjs/common';
import { TrackingNotifierService } from './tracking-notifier.service';
import { TrackingLink } from './entities/tracking-link.entity';
import { EmergencyContact } from '../users/entities/emergency-contact.entity';

/**
 * The promises this makes to the people on a patient's contact list: each of
 * them hears about a case once, an opt-out is final, and nothing here can take
 * a dispatch down with it.
 */

const link = { id: 'link-1', token: 'tok_abc' } as TrackingLink;

const makeContact = (overrides: Partial<EmergencyContact> = {}): EmergencyContact =>
  ({
    id: 'contact-1',
    userId: 'patient-1',
    name: 'Meera',
    phoneNumber: '+919876543210',
    relation: 'Parent',
    notifyBySms: true,
    optedOutAt: null,
    optOutToken: 'opt_1',
    lastNotifiedAt: null,
    ...overrides,
  }) as EmergencyContact;

describe('TrackingNotifierService', () => {
  let service: TrackingNotifierService;
  let contacts: any;
  let notifications: any;
  let users: any;
  let sms: any;
  let tracking: any;

  beforeEach(() => {
    contacts = {
      find: jest.fn(async () => [makeContact()]),
      findOne: jest.fn(),
      save: jest.fn(async (entity: any) => entity),
    };
    notifications = {
      create: jest.fn((entity: any) => entity),
      save: jest.fn(async (entity: any) => entity),
    };
    users = { findOne: jest.fn(async () => ({ firstName: 'Asha', lastName: 'Verma' })) };
    sms = {
      providerName: 'log',
      normalizeNumber: jest.fn((raw: string) => (raw && raw.length >= 6 ? raw : null)),
      send: jest.fn(async () => ({ provider: 'log', providerMessageId: 'sid-1' })),
    };
    tracking = { buildPublicUrl: jest.fn(() => 'https://ecs.example/track/tok_abc?c=opt_1') };

    service = new TrackingNotifierService(contacts, notifications, users, sms, tracking);
  });

  it('texts each eligible contact the tracking link, once', async () => {
    const tally = await service.notifyContactsForCase('patient-1', 'booking-1', link);

    expect(tally).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sms.send).toHaveBeenCalledTimes(1);
    const [message] = sms.send.mock.calls[0];
    expect(message.to).toBe('+919876543210');
    expect(message.body).toContain('https://ecs.example/track/tok_abc?c=opt_1');
    expect(message.body).toContain('Asha');
  });

  it('asks only for contacts who are opted in and marked for alerting', async () => {
    await service.notifyContactsForCase('patient-1', 'booking-1', link);

    const [query] = contacts.find.mock.calls[0];
    expect(query.where).toMatchObject({ userId: 'patient-1', notifyBySms: true });
    expect(query.where.optedOutAt).toBeDefined(); // IsNull()
  });

  it('claims the contact before sending, so a duplicate dispatch cannot double-text', async () => {
    notifications.save.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

    const tally = await service.notifyContactsForCase('patient-1', 'booking-1', link);

    expect(tally).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('skips an unusable number instead of failing the whole fan-out', async () => {
    contacts.find.mockResolvedValue([
      makeContact({ id: 'bad', phoneNumber: 'call mom' }),
      makeContact({ id: 'good' }),
    ]);
    sms.normalizeNumber.mockImplementation((raw: string) => (raw.startsWith('+') ? raw : null));

    const tally = await service.notifyContactsForCase('patient-1', 'booking-1', link);

    expect(tally).toEqual({ sent: 1, skipped: 1, failed: 0 });
  });

  it('records a gateway failure without throwing at the dispatch that called it', async () => {
    sms.send.mockRejectedValue(new Error('gateway down'));

    const tally = await service.notifyContactsForCase('patient-1', 'booking-1', link);

    expect(tally).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(notifications.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'FAILED', error: 'gateway down' }),
    );
  });

  it('does nothing when the patient saved no contacts', async () => {
    contacts.find.mockResolvedValue([]);

    const tally = await service.notifyContactsForCase('patient-1', 'booking-1', link);

    expect(tally).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sms.send).not.toHaveBeenCalled();
  });

  describe('opt-out', () => {
    it('unsubscribes the contact who followed their own link', async () => {
      const contact = makeContact();
      contacts.findOne.mockResolvedValue(contact);

      await expect(service.setOptOut('opt_1', true)).resolves.toEqual({ optedOut: true });
      expect(contact.optedOutAt).toBeInstanceOf(Date);
    });

    it('keeps the original opt-out time when tapped twice', async () => {
      const optedOutAt = new Date('2026-09-01T00:00:00Z');
      contacts.findOne.mockResolvedValue(makeContact({ optedOutAt }));

      await service.setOptOut('opt_1', true);

      expect(contacts.save.mock.calls[0][0].optedOutAt).toBe(optedOutAt);
    });

    it('lets the same person opt back in', async () => {
      contacts.findOne.mockResolvedValue(makeContact({ optedOutAt: new Date() }));

      await expect(service.setOptOut('opt_1', false)).resolves.toEqual({ optedOut: false });
    });

    it('rejects an unknown preference token', async () => {
      contacts.findOne.mockResolvedValue(null);

      await expect(service.getOptOutState('bogus')).rejects.toThrow(NotFoundException);
    });
  });
});
