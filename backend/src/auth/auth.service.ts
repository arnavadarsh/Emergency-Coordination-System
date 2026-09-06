import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hospital } from '../hospitals/entities/hospital.entity';
import { Ambulance } from '../ambulances/entities/ambulance.entity';
import { UserRole, AmbulanceStatus } from '../common/enums';
import { LoginDto, RegisterDto } from './dto';
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
   * Registers a new user
   * Basic implementation - no email verification or OAuth
   */
  async register(registerDto: RegisterDto) {
    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const user = await this.usersService.create({
      email: registerDto.email,
      password: await AuthService.hashPassword(registerDto.password),
      role: registerDto.role,
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

    // A hospital or driver account is not usable until it points at the
    // facility or vehicle it belongs to.
    await this.linkRoleRecords(user.id, registerDto);

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
   * Give a hospital or driver account the records it needs.
   *
   * Failures here are logged and swallowed: the account itself was created
   * successfully, and refusing the whole registration because a vehicle number
   * was already taken would be worse than an account an admin can finish
   * linking later.
   */
  private async linkRoleRecords(userId: string, dto: RegisterDto): Promise<void> {
    try {
      if (dto.role === UserRole.HOSPITAL) {
        const hospitalId = await this.resolveHospital(dto);
        if (hospitalId) await this.usersService.linkRoleRecords(userId, { hospitalId });
        return;
      }

      if (dto.role === UserRole.DRIVER) {
        const ambulanceId = await this.resolveAmbulance(dto);
        await this.usersService.linkRoleRecords(userId, {
          ambulanceId,
          licenseNumber: dto.licenseNumber,
        });
      }
    } catch (error: any) {
      this.logger.error(
        `Registered ${dto.email} but could not link its ${dto.role} records: ${error?.message ?? error}`,
      );
    }
  }

  /**
   * The hospital this login administers: an existing one matched by name or by
   * the account's own email, otherwise a new record from what the form supplied.
   */
  private async resolveHospital(dto: RegisterDto): Promise<string | null> {
    const name = dto.hospitalName?.trim();

    const existing = await this.hospitalRepository
      .createQueryBuilder('hospital')
      .where('LOWER(hospital.name) = LOWER(:name)', { name: name ?? '' })
      .orWhere('LOWER(hospital.email) = LOWER(:email)', { email: dto.email })
      .getOne();

    if (existing) return existing.id;
    if (!name) return null;

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
  private async resolveAmbulance(dto: RegisterDto): Promise<string | undefined> {
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
