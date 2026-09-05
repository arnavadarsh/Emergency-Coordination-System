import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
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

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
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
