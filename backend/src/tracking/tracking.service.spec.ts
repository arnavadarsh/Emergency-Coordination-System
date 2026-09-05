import { GoneException, NotFoundException } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingLink } from './entities/tracking-link.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { BookingStatus, UserRole } from '../common/enums';

/**
 * The two things that must never go wrong with a public tracking link: it dies
 * when the case does, and it never carries anything about the patient.
 */

const HOUR = 3600_000;

const makeLink = (overrides: Partial<TrackingLink> = {}): TrackingLink =>
  ({
    id: 'link-1',
    token: 'tok_abc',
    bookingId: 'booking-1',
    dispatchId: 'dispatch-1',
    expiresAt: new Date(Date.now() + 12 * HOUR),
    closedAt: null,
    closeReason: null,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: new Date(),
    ...overrides,
  }) as TrackingLink;

const makeBooking = (overrides: Partial<Booking> = {}): Booking =>
  ({
    id: 'booking-1b2c3d4e',
    userId: 'patient-1',
    status: BookingStatus.ASSIGNED,
    pickupLatitude: 28.6139,
    pickupLongitude: 77.209,
    destinationLatitude: 28.5672,
    destinationLongitude: 77.21,
    destinationAddress: 'City General Hospital',
    // Things that must never surface on the public page:
    description: 'Severe chest pain, patient is diabetic',
    severity: 'CRITICAL',
    user: { firstName: 'Asha', lastName: 'Verma', phoneNumber: '+919876543210' },
    ...overrides,
  }) as unknown as Booking;

const makeDispatch = (overrides: Partial<Dispatch> = {}): Dispatch =>
  ({
    id: 'dispatch-1',
    bookingId: 'booking-1b2c3d4e',
    status: 'EN_ROUTE_PICKUP',
    dispatchedAt: new Date('2026-09-05T06:00:00Z'),
    estimatedPickupTime: 9,
    ambulance: {
      vehicleNumber: 'DL1AB1234',
      currentLatitude: 28.65,
      currentLongitude: 77.23,
      lastLocationUpdate: new Date('2026-09-05T06:04:00Z'),
    },
    hospital: { name: 'City General Hospital', address: '12 Ring Road', latitude: 28.5672, longitude: 77.21 },
    ...overrides,
  }) as unknown as Dispatch;

describe('TrackingService', () => {
  let service: TrackingService;
  let links: any;
  let notifications: any;
  let bookings: any;
  let dispatches: any;
  let contacts: any;

  beforeEach(() => {
    links = {
      findOne: jest.fn(),
      save: jest.fn(async (entity: any) => entity),
      create: jest.fn((entity: any) => entity),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    notifications = { find: jest.fn(async () => []) };
    bookings = { findOne: jest.fn() };
    dispatches = { findOne: jest.fn() };
    contacts = { find: jest.fn(async () => []) };

    const config = {
      get: (key: string, fallback?: any) =>
        ({ 'tracking.linkTtlHours': 24, 'tracking.publicBaseUrl': 'https://ecs.example/track' }[key] ?? fallback),
    };

    service = new TrackingService(links, notifications, bookings, dispatches, contacts, config as any);
  });

  describe('issueForCase', () => {
    it('reuses the existing link so an already-shared URL keeps working', async () => {
      const existing = makeLink();
      links.findOne.mockResolvedValue(existing);

      const result = await service.issueForCase('booking-1', 'dispatch-1');

      expect(result).toBe(existing);
      expect(links.create).not.toHaveBeenCalled();
    });

    it('repoints an existing link at a re-dispatch instead of minting a second one', async () => {
      links.findOne.mockResolvedValue(makeLink({ dispatchId: 'old-dispatch' }));

      const result = await service.issueForCase('booking-1', 'dispatch-2');

      expect(result.dispatchId).toBe('dispatch-2');
      expect(links.save).toHaveBeenCalled();
      expect(links.create).not.toHaveBeenCalled();
    });

    it('mints an unguessable token with an expiry when there is none', async () => {
      links.findOne.mockResolvedValue(null);

      const result = await service.issueForCase('booking-9', 'dispatch-9');

      expect(result.token).toHaveLength(32);
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('getPublicView', () => {
    it('rejects a token that was never issued', async () => {
      links.findOne.mockResolvedValue(null);
      await expect(service.getPublicView('nope')).rejects.toThrow(NotFoundException);
    });

    it('shows the live case: stage, ambulance, ETA and hospital', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking());
      dispatches.findOne.mockResolvedValue(makeDispatch());

      const view = await service.getPublicView('tok_abc');

      expect(view.caseReference).toBe('ECS-BOOKING-');
      expect(view.stage.code).toBe('EN_ROUTE_PICKUP');
      expect(view.stage.label).toBe('On the way to the patient');
      expect(view.ambulance.vehicleNumber).toBe('DL1AB1234');
      expect(view.ambulance.location).toEqual({ latitude: 28.65, longitude: 77.23 });
      expect(view.target).toMatchObject({ kind: 'PICKUP' });
      expect(view.hospital?.name).toBe('City General Hospital');
      expect(view.eta.minutes).toBeGreaterThan(0);
    });

    it('never leaks the patient identity, condition or severity', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking());
      dispatches.findOne.mockResolvedValue(makeDispatch());

      const serialized = JSON.stringify(await service.getPublicView('tok_abc'));

      for (const secret of ['Asha', 'Verma', '9876543210', 'chest pain', 'diabetic', 'CRITICAL', 'patient-1']) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('stops showing the pickup point once the patient is on board', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking());
      dispatches.findOne.mockResolvedValue(makeDispatch({ status: 'EN_ROUTE_HOSPITAL' }));

      const view = await service.getPublicView('tok_abc');

      expect(view.stage.code).toBe('EN_ROUTE_HOSPITAL');
      expect(view.target).toMatchObject({ kind: 'HOSPITAL', latitude: 28.5672 });
      expect(JSON.stringify(view)).not.toContain('28.6139'); // the pickup latitude
    });

    it('counts a view at most once a minute, however often the page polls', async () => {
      const link = makeLink({ lastViewedAt: new Date(Date.now() - 5_000), viewCount: 3 });
      links.findOne.mockResolvedValue(link);
      bookings.findOne.mockResolvedValue(makeBooking());
      dispatches.findOne.mockResolvedValue(makeDispatch());

      await service.getPublicView('tok_abc');

      expect(link.viewCount).toBe(3);
      expect(links.save).not.toHaveBeenCalled();
    });

    // ── The link stops working once the case ends ──────────────────────────

    const expectEnded = async (reason: string) => {
      try {
        await service.getPublicView('tok_abc');
        fail('expected the link to be refused');
      } catch (error) {
        expect(error).toBeInstanceOf(GoneException);
        expect((error as GoneException).getResponse()).toMatchObject({ status: 'ENDED', reason });
      }
    };

    it('goes dark when the booking is completed', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking({ status: BookingStatus.COMPLETED }));
      dispatches.findOne.mockResolvedValue(makeDispatch({ status: 'COMPLETED' }));

      await expectEnded('COMPLETED');
    });

    it('goes dark when the dispatch completes even if the booking row lags behind', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking({ status: BookingStatus.IN_PROGRESS }));
      dispatches.findOne.mockResolvedValue(makeDispatch({ status: 'COMPLETED' }));

      await expectEnded('COMPLETED');
    });

    it('goes dark when the case is cancelled', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking({ status: BookingStatus.CANCELLED }));
      dispatches.findOne.mockResolvedValue(makeDispatch({ status: 'CANCELLED' }));

      await expectEnded('CANCELLED');
    });

    it('goes dark after the link expires, even on a case nobody closed out', async () => {
      links.findOne.mockResolvedValue(makeLink({ expiresAt: new Date(Date.now() - HOUR) }));
      bookings.findOne.mockResolvedValue(makeBooking());
      dispatches.findOne.mockResolvedValue(makeDispatch());

      await expectEnded('EXPIRED');
    });

    it('tells a late-arriving relative which hospital, and nothing else, once completed', async () => {
      links.findOne.mockResolvedValue(makeLink());
      bookings.findOne.mockResolvedValue(makeBooking({ status: BookingStatus.COMPLETED }));
      dispatches.findOne.mockResolvedValue(makeDispatch({ status: 'COMPLETED' }));

      const error = await service.getPublicView('tok_abc').catch(e => e);
      const body: any = (error as GoneException).getResponse();

      expect(body.hospitalName).toBe('City General Hospital');
      expect(JSON.stringify(body)).not.toContain('Asha');
    });
  });

  describe('getShareInfo', () => {
    it('refuses to hand another patient their case link', async () => {
      bookings.findOne.mockResolvedValue(makeBooking({ userId: 'someone-else' }));

      await expect(
        service.getShareInfo('booking-1', { id: 'patient-1', role: UserRole.USER }),
      ).rejects.toThrow('You can only share your own cases');
    });

    it('reports that there is nothing to share before an ambulance is assigned', async () => {
      bookings.findOne.mockResolvedValue(makeBooking({ userId: 'patient-1' }));
      links.findOne.mockResolvedValue(null);

      const info = await service.getShareInfo('booking-1', { id: 'patient-1', role: UserRole.USER });

      expect(info).toEqual({ available: false, reason: 'NO_AMBULANCE_ASSIGNED' });
    });

    it('returns the shareable URL for the patient who raised the case', async () => {
      bookings.findOne.mockResolvedValue(makeBooking({ userId: 'patient-1' }));
      links.findOne.mockResolvedValue(makeLink());

      const info = await service.getShareInfo('booking-1', { id: 'patient-1', role: UserRole.USER });

      expect(info.available).toBe(true);
      expect(info.url).toBe('https://ecs.example/track/tok_abc');
    });
  });
});
