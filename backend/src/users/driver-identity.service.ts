import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities';
import { UserRole } from '../common/enums';

/**
 * Driver identity as shown to patients (tracking view) and hospitals (pre-arrival report).
 * `photoUrl` is null when the driver has not uploaded a photo — consumers render initials instead.
 */
export interface DriverIdentity {
  id: string | null;
  name: string;
  photoUrl: string | null;
  phoneNumber: string | null;
  licenseNumber: string | null;
  vehicleNumber: string | null;
}

/** Minimal shape needed to look a driver up — matches Dispatch. */
export interface DriverRef {
  driverId?: string | null;
  ambulanceId?: string | null;
  vehicleNumber?: string | null;
}

/**
 * Resolves the human behind a dispatch.
 *
 * Dispatches carry `driver_id` only when a driver was explicitly assigned; auto-dispatch
 * picks an ambulance, so we fall back to the driver currently linked to that ambulance
 * (users.ambulance_id).
 */
@Injectable()
export class DriverIdentityService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Display name for a driver, falling back to the email local part. */
  private displayName(driver: User): string {
    const fullName = `${driver.firstName ?? ''} ${driver.lastName ?? ''}`.trim();
    return fullName || driver.email?.split('@')[0] || 'Driver';
  }

  /** Shape a user row into the identity payload sent to dashboards. */
  buildIdentity(driver: User | null | undefined, vehicleNumber?: string | null): DriverIdentity | null {
    if (!driver) return null;
    return {
      id: driver.id,
      name: this.displayName(driver),
      photoUrl: driver.profilePhotoUrl || null,
      phoneNumber: driver.phoneNumber || null,
      licenseNumber: driver.emergencyContact || null,
      vehicleNumber: vehicleNumber ?? null,
    };
  }

  /** Resolve a single dispatch's driver. Returns null when no driver can be determined. */
  async resolveOne(ref: DriverRef): Promise<DriverIdentity | null> {
    const resolved = await this.resolveMany([ref]);
    return resolved.get(this.refKey(ref)) ?? null;
  }

  /**
   * Batch-resolve drivers for many dispatches in two queries (avoids N+1 on list endpoints).
   * The returned map is keyed by `refKey(ref)`.
   */
  async resolveMany(refs: DriverRef[]): Promise<Map<string, DriverIdentity | null>> {
    const result = new Map<string, DriverIdentity | null>();
    if (refs.length === 0) return result;

    const driverIds = [...new Set(refs.map(r => r.driverId).filter((id): id is string => !!id))];
    const ambulanceIds = [...new Set(refs.map(r => r.ambulanceId).filter((id): id is string => !!id))];

    const byId = new Map<string, User>();
    const byAmbulance = new Map<string, User>();

    if (driverIds.length > 0) {
      const drivers = await this.userRepository.find({ where: { id: In(driverIds) } });
      for (const driver of drivers) byId.set(driver.id, driver);
    }

    if (ambulanceIds.length > 0) {
      const drivers = await this.userRepository.find({
        where: { role: UserRole.DRIVER, ambulanceId: In(ambulanceIds) },
        order: { createdAt: 'ASC' },
      });
      // First driver linked to an ambulance wins if several are on record.
      for (const driver of drivers) {
        if (!byAmbulance.has(driver.ambulanceId)) byAmbulance.set(driver.ambulanceId, driver);
      }
    }

    for (const ref of refs) {
      const driver =
        (ref.driverId ? byId.get(ref.driverId) : undefined) ??
        (ref.ambulanceId ? byAmbulance.get(ref.ambulanceId) : undefined) ??
        null;
      result.set(this.refKey(ref), this.buildIdentity(driver, ref.vehicleNumber));
    }

    return result;
  }

  /** Stable map key for a lookup ref. */
  refKey(ref: DriverRef): string {
    return `${ref.driverId ?? ''}|${ref.ambulanceId ?? ''}`;
  }
}
