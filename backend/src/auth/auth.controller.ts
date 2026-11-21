import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, CreateAccountDto } from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole } from '../common/enums';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';

/**
 * Authentication Controller
 * Handles login and registration endpoints
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login endpoint
   * Returns JWT token on successful authentication
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ bucket: 'auth-login', limit: 10, windowSeconds: 60, limitPath: 'rateLimit.auth.loginPerMinute' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  /**
   * Public sign-up. Creates a patient account only.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit({ bucket: 'auth-register', limit: 10, windowSeconds: 3600, limitPath: 'rateLimit.auth.registerPerHour' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * Create a hospital, driver, admin or patient account. Admin-only: this is
   * the only way any account gets a role other than USER. The very first admin
   * comes from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD — see
   * AdminBootstrapService.
   */
  @Post('accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Body() createAccountDto: CreateAccountDto, @CurrentUser() admin: any) {
    return this.authService.createAccount(createAccountDto, admin?.id);
  }
}
