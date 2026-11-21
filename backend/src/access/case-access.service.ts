import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispatch } from '../dispatch/entities/dispatch.entity';
import { UserRole } from '../common/enums';

/** The fields of a signed-in account that decide what it may see. */
export interface Requester {
  id: string;
  role: UserRole | string;
  hospitalId?: string | null;
  ambulanceId?: string | null;
}

/** How a requester is connected to a case, if at all. */
export type CaseRole = 'patient' | 'driver' | 'hospital' | 'admin';

export interface CaseAccess {
  booking: Booking;
  dispatch: Dispatch | null;
  role: CaseRole;
}

/**
 * Decides who belongs to a case.
 *
 * A case is a booking plus the dispatch serving it. The people on it are the
 * patient who raised it, the driver of the assigned ambulance, the hospital
 * receiving the patient, and admins. Everyone else gets nothing — not even
 * confirmation that the case exists. HTTP endpoints and socket events both ask
 * here, so the rule is written once.
 */
@Injectable()
export class CaseAccessService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(Dispatch)
    private readonly dispatchRepository: Repository<Dispatch>,
  ) {}

  /**
   * The driver assigned to a dispatch: the one who claimed it, or — before
   * anyone has — whoever drives the ambulance it was given to.
   */
  isAssignedDriver(requester: Requester, dispatch: Pick<Dispatch, 'driverId' | 'ambulanceId'> | null | undefined): boolean {
    if (!dispatch || requester.role !== UserRole.DRIVER) return false;
    if (dispatch.driverId) return dispatch.driverId === requester.id;
    return Boolean(requester.ambulanceId) && dispatch.ambulanceId === requester.ambulanceId;
  }

  isReceivingHospital(requester: Requester, dispatch: Pick<Dispatch, 'hospitalId'> | null | undefined): boolean {
    return (
      requester.role === UserRole.HOSPITAL &&
      Boolean(requester.hospitalId) &&
      dispatch?.hospitalId === requester.hospitalId
    );
  }

  roleInCase(requester: Requester, booking: Booking, dispatch: Dispatch | null): CaseRole | null {
    if (requester.role === UserRole.ADMIN) return 'admin';
    if (requester.role === UserRole.USER && booking.userId === requester.id) return 'patient';
    if (this.isAssignedDriver(requester, dispatch)) return 'driver';
    if (this.isReceivingHospital(requester, dispatch)) return 'hospital';
    return null;
  }

  /** The booking and its current dispatch, or null when the booking does not exist. */
  async loadCase(bookingId: string, relations: string[] = []): Promise<{ booking: Booking; dispatch: Dispatch | null } | null> {
    if (!bookingId) return null;
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId }, relations });
    if (!booking) return null;
    const dispatch = await this.dispatchRepository.findOne({
      where: { bookingId },
      order: { createdAt: 'DESC' },
    });
    return { booking, dispatch };
  }

  /**
   * Load a case and confirm the requester is on it, in one of `allowed` roles.
   *
   * A requester with no connection gets the same 404 as a booking that does
   * not exist, so booking IDs cannot be probed for.
   */
  async assertCaseAccess(
    requester: Requester,
    bookingId: string,
    allowed: CaseRole[] = ['patient', 'driver', 'hospital', 'admin'],
    relations: string[] = [],
  ): Promise<CaseAccess> {
    const found = await this.loadCase(bookingId, relations);
    const role = found ? this.roleInCase(requester, found.booking, found.dispatch) : null;
    if (!found || !role) {
      throw new NotFoundException('Booking not found');
    }
    if (!allowed.includes(role)) {
      throw new ForbiddenException('You do not have access to this part of the case');
    }
    return { ...found, role };
  }

  /** Same check for a dispatch addressed by its own ID. */
  async assertDispatchAccess(
    requester: Requester,
    dispatchId: string,
    allowed: CaseRole[] = ['driver', 'hospital', 'admin'],
  ): Promise<{ dispatch: Dispatch; role: CaseRole }> {
    const dispatch = await this.dispatchRepository.findOne({
      where: { id: dispatchId },
      relations: ['booking', 'ambulance', 'hospital'],
    });
    const role = dispatch?.booking ? this.roleInCase(requester, dispatch.booking, dispatch) : null;
    if (!dispatch || !role) {
      throw new NotFoundException('Dispatch not found');
    }
    if (!allowed.includes(role)) {
      throw new ForbiddenException('You do not have access to this dispatch');
    }
    return { dispatch, role };
  }
}
