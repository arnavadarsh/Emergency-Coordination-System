import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CaseAccessService, Requester } from './case-access.service';
import { UserRole } from '../common/enums';

/**
 * Who belongs to a case. Every check below used to pass for anyone with a
 * login (or, for the booking page, without one).
 */
describe('CaseAccessService', () => {
  const booking: any = { id: 'booking-1', userId: 'patient-1' };
  const dispatch: any = { id: 'dispatch-1', bookingId: 'booking-1', ambulanceId: 'amb-1', hospitalId: 'hosp-1', driverId: null };

  let bookingRepository: { findOne: jest.Mock };
  let dispatchRepository: { findOne: jest.Mock };
  let service: CaseAccessService;

  const user = (role: UserRole, extra: Partial<Requester> = {}): Requester => ({ id: `${role}-x`, role, ...extra });

  beforeEach(() => {
    bookingRepository = { findOne: jest.fn().mockResolvedValue(booking) };
    dispatchRepository = { findOne: jest.fn().mockResolvedValue({ ...dispatch }) };
    service = new CaseAccessService(bookingRepository as any, dispatchRepository as any);
  });

  describe('roleInCase', () => {
    it('recognises the patient who raised the case, and nobody else as patient', () => {
      expect(service.roleInCase({ id: 'patient-1', role: UserRole.USER }, booking, dispatch)).toBe('patient');
      expect(service.roleInCase({ id: 'patient-2', role: UserRole.USER }, booking, dispatch)).toBeNull();
    });

    it("recognises the assigned ambulance's driver, and not other drivers", () => {
      expect(service.roleInCase(user(UserRole.DRIVER, { ambulanceId: 'amb-1' }), booking, dispatch)).toBe('driver');
      expect(service.roleInCase(user(UserRole.DRIVER, { ambulanceId: 'amb-2' }), booking, dispatch)).toBeNull();
      expect(service.roleInCase(user(UserRole.DRIVER), booking, dispatch)).toBeNull();
    });

    it('once a driver has claimed the trip, only that driver counts', () => {
      const claimed = { ...dispatch, driverId: 'driver-a' };
      expect(service.roleInCase({ id: 'driver-a', role: UserRole.DRIVER, ambulanceId: 'amb-1' }, booking, claimed)).toBe('driver');
      expect(service.roleInCase({ id: 'driver-b', role: UserRole.DRIVER, ambulanceId: 'amb-1' }, booking, claimed)).toBeNull();
    });

    it('recognises the receiving hospital only', () => {
      expect(service.roleInCase(user(UserRole.HOSPITAL, { hospitalId: 'hosp-1' }), booking, dispatch)).toBe('hospital');
      expect(service.roleInCase(user(UserRole.HOSPITAL, { hospitalId: 'hosp-2' }), booking, dispatch)).toBeNull();
      expect(service.roleInCase(user(UserRole.HOSPITAL), booking, dispatch)).toBeNull();
    });

    it('gives a driver or hospital nothing before a dispatch exists', () => {
      expect(service.roleInCase(user(UserRole.DRIVER, { ambulanceId: 'amb-1' }), booking, null)).toBeNull();
      expect(service.roleInCase(user(UserRole.HOSPITAL, { hospitalId: 'hosp-1' }), booking, null)).toBeNull();
    });

    it('admins see every case', () => {
      expect(service.roleInCase(user(UserRole.ADMIN), booking, null)).toBe('admin');
    });
  });

  describe('assertCaseAccess', () => {
    it('answers a stranger exactly as it answers a missing booking', async () => {
      await expect(service.assertCaseAccess({ id: 'patient-2', role: UserRole.USER }, 'booking-1')).rejects.toThrow(NotFoundException);

      bookingRepository.findOne.mockResolvedValue(null);
      await expect(service.assertCaseAccess({ id: 'patient-1', role: UserRole.USER }, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('refuses a case member whose role is not allowed for this action', async () => {
      await expect(
        service.assertCaseAccess({ id: 'patient-1', role: UserRole.USER }, 'booking-1', ['admin', 'hospital', 'driver']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the case and the role for an allowed member', async () => {
      const access = await service.assertCaseAccess(user(UserRole.HOSPITAL, { hospitalId: 'hosp-1' }), 'booking-1');
      expect(access.role).toBe('hospital');
      expect(access.booking.id).toBe('booking-1');
      expect(access.dispatch?.id).toBe('dispatch-1');
    });
  });
});
