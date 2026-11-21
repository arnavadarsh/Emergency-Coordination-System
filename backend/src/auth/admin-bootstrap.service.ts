import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums';
import { AuthService } from './auth.service';

/**
 * Creates the first admin account, once.
 *
 * Sign-up can no longer produce an admin, and every later admin is created by
 * an existing one through POST /auth/accounts — so a brand-new deployment needs
 * one way in. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD on the
 * server and restart: if, and only if, the database holds no admin at all, that
 * account is created. While any admin exists the variables are ignored, so
 * leaving them behind cannot be used to add a second one. Remove them after the
 * first sign-in anyway.
 *
 * Only someone who can already change the server's environment can use this,
 * which is the same people who hold the database password.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private static readonly MIN_PASSWORD_LENGTH = 12;
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly authService: AuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password) return;

    try {
      const admins = await this.userRepository.count({ where: { role: UserRole.ADMIN } });
      if (admins > 0) {
        this.logger.warn(
          'BOOTSTRAP_ADMIN_EMAIL is set but an admin already exists, so it was ignored. Remove the BOOTSTRAP_ADMIN_* variables.',
        );
        return;
      }

      if (password.length < AdminBootstrapService.MIN_PASSWORD_LENGTH) {
        this.logger.error(
          `BOOTSTRAP_ADMIN_PASSWORD must be at least ${AdminBootstrapService.MIN_PASSWORD_LENGTH} characters — no admin was created.`,
        );
        return;
      }

      const existing = await this.userRepository.findOne({ where: { email } });
      if (existing) {
        // Promoting an existing login would let whoever registered that email
        // first become admin. Make the operator choose a fresh address instead.
        this.logger.error(`BOOTSTRAP_ADMIN_EMAIL ${email} already belongs to an account — no admin was created.`);
        return;
      }

      await this.authService.createAccount({
        email,
        password,
        firstName: 'System',
        lastName: 'Administrator',
        role: UserRole.ADMIN,
      });
      this.logger.warn(`Created the first admin account (${email}). Sign in, then remove BOOTSTRAP_ADMIN_* from the environment.`);
    } catch (error: any) {
      // Never take the API down over this — log it and carry on serving.
      this.logger.error(`Could not create the bootstrap admin: ${error?.message ?? error}`);
    }
  }
}
