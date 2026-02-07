import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { CurrentUser } from '../common/decorators';

/**
 * Users Controller
 * Handles user-related endpoints
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get current user profile
   */
  @Get('me')
  async getCurrentUser(@CurrentUser() user: any) {
    return this.usersService.findById(user.id);
  }

  /**
   * Update current user profile
   */
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: any,
    @Body() profileData: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      address?: string;
      emergencyContact?: string;
      dateOfBirth?: string;
    },
  ) {
    return this.usersService.updateProfile(user.id, profileData);
  }

  /**
   * Get all users (admin only)
   */
  @Get()
  @Roles(UserRole.ADMIN)
  async getAllUsers() {
    return this.usersService.findAll();
  }

  /**
   * Get user by ID (admin only)
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getUser(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  /**
   * Update user active status (admin only)
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async updateUserStatus(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.usersService.updateActiveStatus(id, isActive);
  }

  /**
   * Update user role (admin only)
   */
  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: UserRole,
  ) {
    return this.usersService.updateRole(id, role);
  }
}
