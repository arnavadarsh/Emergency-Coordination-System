import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums';

/**
 * Decorator to specify which roles can access a route
 * Usage: @Roles(UserRole.ADMIN, UserRole.HOSPITAL)
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
