import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UserRole } from '../common/enums';
import { AdminAuditService } from './admin-audit.service';
import { AdminUpdateUserDto } from './dto/admin.dto';

type Actor = { id: string };

/**
 * Everything an admin can do to an account: edit it, re-point it at a
 * different hospital or ambulance, change its role, switch it off, reset its
 * password and end its sessions. Each change that alters what the account may
 * see also drops its live connections, so the change applies at once.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Hospital) private readonly hospitalRepository: Repository<Hospital>,
    @InjectRepository(Ambulance) private readonly ambulanceRepository: Repository<Ambulance>,
    @InjectRepository(Booking) private readonly bookingRepository: Repository<Booking>,
    private readonly usersService: UsersService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly audit: AdminAuditService,
  ) {}

  private async load(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** One account with what it is linked to. */
  async getUser(id: string) {
    const user = await this.load(id);
    const [hospital, ambulance, bookingCount] = await Promise.all([
      user.hospitalId ? this.hospitalRepository.findOne({ where: { id: user.hospitalId } }) : null,
      user.ambulanceId ? this.ambulanceRepository.findOne({ where: { id: user.ambulanceId } }) : null,
      this.bookingRepository.count({ where: { userId: user.id } }),
    ]);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      licenseNumber: user.role === UserRole.DRIVER ? user.emergencyContact ?? null : null,
      hospital: hospital ? { id: hospital.id, name: hospital.name } : null,
      ambulance: ambulance ? { id: ambulance.id, vehicleNumber: ambulance.vehicleNumber, status: ambulance.status } : null,
      bookingCount,
      lastLoginAt: user.lastLoginAt ?? null,
      sessionsRevokedAt: user.sessionsRevokedAt ?? null,
      createdAt: user.createdAt,
    };
  }

  async updateUser(actor: Actor, id: string, dto: AdminUpdateUserDto) {
    const user = await this.load(id);

    if (id === actor.id && ((dto.role && dto.role !== UserRole.ADMIN) || dto.isActive === false)) {
      throw new ConflictException('You cannot remove your own admin access. Ask another admin.');
    }
    await this.usersService.assertAdminRemains(user, { role: dto.role, isActive: dto.isActive });

    const update: Partial<User> = {};
    const before: Record<string, any> = {};
    const set = <K extends keyof User>(key: K, value: User[K] | undefined) => {
      if (value === undefined || user[key] === value) return;
      before[key as string] = user[key] ?? null;
      update[key] = value;
    };

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== user.email.toLowerCase()) {
        const taken = await this.userRepository.findOne({ where: { email } });
        if (taken) throw new ConflictException('Another account already uses that email');
        set('email', email);
      }
    }
    if (dto.hospitalId) {
      const hospital = await this.hospitalRepository.findOne({ where: { id: dto.hospitalId } });
      if (!hospital) throw new NotFoundException('That hospital does not exist');
    }
    if (dto.ambulanceId) {
      const ambulance = await this.ambulanceRepository.findOne({ where: { id: dto.ambulanceId } });
      if (!ambulance) throw new NotFoundException('That ambulance does not exist');
    }

    set('firstName', dto.firstName);
    set('lastName', dto.lastName);
    set('phoneNumber', dto.phoneNumber);
    set('role', dto.role);
    set('isActive', dto.isActive);
    set('hospitalId', dto.hospitalId as any);
    set('ambulanceId', dto.ambulanceId as any);
    // A driver's licence lives in emergencyContact, where DriverIdentityService reads it.
    set('emergencyContact', dto.licenseNumber as any);

    if (Object.keys(update).length > 0) {
      await this.userRepository.update(id, update);
      const reachChanged = ['role', 'isActive', 'hospitalId', 'ambulanceId'].some(key => key in update);
      if (reachChanged) this.realtimeGateway.disconnectUser(id);
      await this.audit.record(actor.id, 'USER_UPDATED', 'User', id, { before, after: update });
    }

    const result = await this.getUser(id);
    const warnings: string[] = [];
    if (result.role === UserRole.HOSPITAL && !result.hospital) {
      warnings.push('This hospital account is not linked to a hospital, so it cannot see any cases.');
    }
    if (result.role === UserRole.DRIVER && !result.ambulance) {
      warnings.push('This driver is not linked to an ambulance, so it will not receive any trips.');
    }
    return { ...result, warnings };
  }

  /** Set a new password and end every existing session for the account. */
  async resetPassword(actor: Actor, id: string, password: string) {
    await this.load(id);
    await this.usersService.setPasswordHash(id, await AuthService.hashPassword(password));
    await this.userRepository.update(id, { sessionsRevokedAt: new Date() });
    this.realtimeGateway.disconnectUser(id);
    await this.audit.record(actor.id, 'PASSWORD_RESET', 'User', id);
    return { message: 'Password reset. The account has been signed out everywhere.' };
  }

  /** End every existing session: tokens issued before now stop working. */
  async signOutEverywhere(actor: Actor, id: string) {
    await this.load(id);
    await this.userRepository.update(id, { sessionsRevokedAt: new Date() });
    this.realtimeGateway.disconnectUser(id);
    await this.audit.record(actor.id, 'SESSIONS_REVOKED', 'User', id);
    return { message: 'Signed out everywhere.' };
  }
}
