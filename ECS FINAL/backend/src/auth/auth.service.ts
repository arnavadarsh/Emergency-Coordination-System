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
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  /**
   * Authenticates a user and returns a JWT token
   */
  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Direct plain text password comparison (no hashing)
    const isPasswordValid = loginDto.password === user.password;

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Update last login
    await this.usersService.updateLastLogin(user.id);

    // Generate JWT token
    const payload = { sub: user.id, email: user.email, role: user.role };
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

    // Create user with plain password (no hashing)
    const user = await this.usersService.create({
      email: registerDto.email,
      password: registerDto.password,
      role: registerDto.role,
      profile: {
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        phoneNumber: registerDto.phoneNumber,
        address: registerDto.address,
        latitude: registerDto.latitude,
        longitude: registerDto.longitude,
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
