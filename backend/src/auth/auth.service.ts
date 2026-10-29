import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { UserRole, AmbulanceStatus } from '../common/enums';
import { AuditService } from '../audit/audit.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { LoginDto, RegisterDto, CreateAccountDto } from './dto';
import * as bcrypt from 'bcrypt';

/**
 * Authentication Service
 * Handles user login, registration, and token generation
 */
@Injectable()
export class AuthService {
  /**
   * bcrypt work factor. 12 is the current sensible default — roughly a quarter second
   * per hash, which is painless on login but expensive to brute force offline.
   */
  private static readonly BCRYPT_ROUNDS = 12;

  /**
   * Compared against when no user matches, so a wrong email and a wrong password take
   * the same time. Without this, response timing tells an attacker which emails exist.
   */
  private static readonly DUMMY_HASH =
    '$2b$12$lWe1vgzXE4E/silQYHH0ceSw0aqlbYXSLuHv/JGEvGpRaBynvUYF.';

  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectRepository(Hospital)
    private readonly hospitalRepository: Repository<Hospital>,
    @InjectRepository(Ambulance)
    private readonly ambulanceRepository: Repository<Ambulance>,
    private readonly auditService: AuditService,
    private readonly settings: SystemSettingsService,
  ) {}

  /** Hash a plain password for storage. */
  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, AuthService.BCRYPT_ROUNDS);
  }

  /**
   * Authenticates a user and returns a JWT token
   */
  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(loginDto.email);

    // Always run a comparison, even for an unknown email, to keep timing uniform.
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user?.password || AuthService.DUMMY_HASH,
    );

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Update last login
    await this.usersService.updateLastLogin(user.id);

    // Generate JWT token
    const payload = { sub: user.id, email: user.email, role: user.role, hospitalId: user.hospitalId ?? null };
    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        address: user.address,
        latitude: user.latitude,
        longitude: user.longitude,
        hospitalId: user.hospitalId,
        ambulanceId: user.ambulanceId,
      },
    };
  }

  /**
   * Public sign-up. Always creates a patient (USER) account, whatever the
   * request says — the DTO already refuses other roles, and this does not pass
   * one through, so no future DTO change can reopen it.
   * Basic implementation - no email verification or OAuth
   */
  async register(registerDto: RegisterDto) {
    if (!this.settings.get('patientSignupEnabled')) {
      throw new ForbiddenException('Sign-up is closed right now. Please contact the service administrator.');
    }

    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const user = await this.usersService.create({
      email: registerDto.email,
      password: await AuthService.hashPassword(registerDto.password),
      role: UserRole.USER,
      profile: {
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phoneNumber: registerDto.phoneNumber,
        address: registerDto.address,
        latitude: registerDto.latitude,
        longitude: registerDto.longitude,
        // Optional — the patient ID is created just the same when it is absent,
        // and the profile can be filled in later from the Profile section.
        medicalProfile: registerDto.medicalProfile,
      },
    });

    // Generate JWT token
    const payload = { sub: user.id, email: user.email, role: user.role };
    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  /**
   * Create an account with any role. Admin-only — the controller enforces it,
   * and this is the one path that can mint HOSPITAL, DRIVER or ADMIN logins.
   *
   * The hospital or ambulance is resolved before the user is written, so a bad
   * hospital id fails the whole request instead of leaving an unusable login.
   */
  async createAccount(dto: CreateAccountDto, actorId?: string) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    let hospitalId: string | undefined;
    let ambulanceId: string | undefined;
    if (dto.role === UserRole.HOSPITAL) {
      hospitalId = await this.resolveHospital(dto);
    } else if (dto.role === UserRole.DRIVER) {
      ambulanceId = await this.resolveAmbulance(dto);
    }

    const user = await this.usersService.create({
      email: dto.email,
      password: await AuthService.hashPassword(dto.password),
      role: dto.role,
      profile: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
        address: dto.role === UserRole.HOSPITAL ? undefined : dto.address,
      },
    });
    await this.usersService.linkRoleRecords(user.id, {
      hospitalId,
      ambulanceId,
      licenseNumber: dto.role === UserRole.DRIVER ? dto.licenseNumber : undefined,
    });

    await this.auditService
      .log({
        entityType: 'User',
        entityId: user.id,
        action: 'ACCOUNT_CREATED',
        userId: actorId,
        afterState: { email: user.email, role: user.role, hospitalId: hospitalId ?? null, ambulanceId: ambulanceId ?? null },
      })
      .catch(error => this.logger.warn(`Could not audit account creation for ${user.email}: ${error?.message ?? error}`));

    this.logger.log(`Admin ${actorId ?? 'bootstrap'} created ${user.role} account ${user.email}`);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      hospitalId: hospitalId ?? null,
      ambulanceId: ambulanceId ?? null,
    };
  }

  /**
   * The hospital a new hospital login administers: the one picked by id, an
   * existing one with the same name, or a new record from the details given.
   */
  private async resolveHospital(dto: CreateAccountDto): Promise<string> {
    if (dto.hospitalId) {
      const hospital = await this.hospitalRepository.findOne({ where: { id: dto.hospitalId } });
      if (!hospital) throw new NotFoundException('That hospital does not exist');
      return hospital.id;
    }

    const name = dto.hospitalName?.trim();
    if (!name) {
      throw new BadRequestException('A hospital account needs a hospitalId or a hospitalName');
    }

    const existing = await this.hospitalRepository
      .createQueryBuilder('hospital')
      .where('LOWER(hospital.name) = LOWER(:name)', { name })
      .getOne();
    if (existing) return existing.id;

    const created = await this.hospitalRepository.save(
      this.hospitalRepository.create({
        name,
        address: dto.address ?? 'Address not provided',
        phoneNumber: dto.phoneNumber ?? '',
        email: dto.email,
        latitude: dto.latitude ?? 0,
        longitude: dto.longitude ?? 0,
        totalBeds: 0,
        availableBeds: 0,
      }),
    );
    this.logger.log(`Created hospital "${created.name}" for new hospital account ${dto.email}`);
    return created.id;
  }

  /**
   * The ambulance this driver operates, matched by vehicle number. A number
   * nobody has registered yet creates the unit as PENDING, which is the same
   * state the ambulance registration endpoint uses — an admin verifies it
   * before it can be dispatched.
   */
  private async resolveAmbulance(dto: CreateAccountDto): Promise<string | undefined> {
    const vehicleNumber = dto.vehicleNumber?.trim();
    if (!vehicleNumber) return undefined;

    const existing = await this.ambulanceRepository.findOne({ where: { vehicleNumber } });
    if (existing) return existing.id;

    const created = await this.ambulanceRepository.save(
      this.ambulanceRepository.create({
        vehicleNumber,
        vehicleType: 'BASIC',
        status: AmbulanceStatus.PENDING,
      }),
    );
    this.logger.log(`Registered ambulance ${vehicleNumber} (pending verification) for driver ${dto.email}`);
    return created.id;
  }

  /**
   * Validates a JWT token and returns the user
   */
  async validateToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return await this.usersService.findById(payload.sub);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
