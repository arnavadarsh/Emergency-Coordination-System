import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities';
import {
  MedicalProfile,
  buildMedicalProfile,
  emptyMedicalProfile,
} from '../common/medical-profile';

/**
 * Reads a patient's Medical Profile straight off their `users` row.
 *
 * Every downstream surface (triage, triage summary, hospital pre-arrival alerts,
 * reports) goes through here rather than caching a copy, which is what makes the
 * patient profile the single source of truth: editing it in the Profile section
 * changes what the next triage session, pre-alert and report show.
 *
 * A patient who cannot be resolved — or who has filled nothing in — yields an
 * empty profile whose fields render as "Not Provided", never a guess.
 */
@Injectable()
export class MedicalProfileService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Shape an already-loaded user row. */
  fromUser(user: User | null | undefined): MedicalProfile {
    return buildMedicalProfile(user ?? null);
  }

  /** Resolve one patient's profile. Returns an empty profile for an unknown id. */
  async resolveOne(userId: string | null | undefined): Promise<MedicalProfile> {
    if (!userId) return emptyMedicalProfile();
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return this.fromUser(user);
  }

  /**
   * Batch-resolve many patients in a single query (avoids N+1 on list endpoints
   * such as the hospital pre-arrival feed and the driver's dispatch list).
   * The returned map is keyed by user id; ids with no matching row are absent.
   */
  async resolveMany(userIds: (string | null | undefined)[]): Promise<Map<string, MedicalProfile>> {
    const result = new Map<string, MedicalProfile>();
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return result;

    const users = await this.userRepository.find({ where: { id: In(ids) } });
    for (const user of users) {
      result.set(user.id, this.fromUser(user));
    }
    return result;
  }

  /** Map lookup that never returns undefined — missing patients get an empty profile. */
  fromMap(map: Map<string, MedicalProfile>, userId: string | null | undefined): MedicalProfile {
    return (userId ? map.get(userId) : undefined) ?? emptyMedicalProfile();
  }
}
