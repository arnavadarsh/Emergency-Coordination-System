import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { isTokenRevoked } from '../session-revocation';

/**
 * JWT Strategy for validating JWT tokens
 * Extracts and validates the JWT from the Authorization header
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  /**
   * Validates the JWT payload and returns the user
   * This method is called automatically by Passport after JWT validation
   */
  async validate(payload: any) {
    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    // An admin signed this account out (or reset its password) after the token was issued.
    if (isTokenRevoked(user, payload.iat)) {
      throw new UnauthorizedException('This session has ended. Please sign in again.');
    }
    return user;
  }
}
