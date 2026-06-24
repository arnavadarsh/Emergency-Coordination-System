import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { CurrentUser } from '../common/decorators';
import { 
  UpdateProfileDto, 
  UpdateRoleDto, 
  UpdateStatusDto, 
  QueryUsersDto,
  CreateSavedLocationDto,
  UpdateSavedLocationDto,
  UpdateNotificationPreferencesDto
} from './dto';

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
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.id, updateProfileDto);
  }

  /**
   * Get user medical records
   */
  @Get('medical-records')
  async getMedicalRecords(@CurrentUser() user: any) {
    return this.usersService.getMedicalRecords(user.id);
  }

  /**
   * Update user medical records
   */
  @Patch('medical-records')
  async updateMedicalRecords(
    @CurrentUser() user: any,
    @Body() data: { bloodType?: string; medicalNotes?: string; emergencyContact?: string },
  ) {
    return this.usersService.updateMedicalRecords(user.id, data);
  }

  /**
   * Get all users (admin only)
   */
  @Get()
  @Roles(UserRole.ADMIN)
  async getAllUsers(@Query() queryUsersDto: QueryUsersDto) {
    // If no query params, return all users (backward compatibility)
    if (!queryUsersDto.page && !queryUsersDto.search) {
      return this.usersService.findAll();
    }
    
    // Otherwise return paginated/filtered results
    return this.usersService.findWithFilters(queryUsersDto);
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
    @Body() updateStatusDto: UpdateStatusDto,
  ) {
    return this.usersService.updateActiveStatus(id, updateStatusDto.isActive);
  }

  /**
   * Update user role (admin only)
   */
  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  async updateUserRole(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(id, updateRoleDto.role);
  }

  /**
   * Delete user (admin only - soft delete)
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async deleteUser(@Param('id') id: string) {
    await this.usersService.updateActiveStatus(id, false);
    return { message: 'User deactivated successfully' };
  }

  /**
   * Get users by role (admin only)
   */
  @Get('role/:role')
  @Roles(UserRole.ADMIN)
  async getUsersByRole(@Param('role') role: UserRole) {
    return this.usersService.findByRole(role);
  }

  /**
   * Get user statistics (admin only)
   */
  @Get('stats/overview')
  @Roles(UserRole.ADMIN)
  async getUserStats() {
    return this.usersService.getUserStats();
  }

  /**
   * Get saved locations
   */
  @Get('saved-locations')
  async getSavedLocations(@CurrentUser() user: any) {
    return this.usersService.getSavedLocations(user.id);
  }

  /**
   * Create saved location
   */
  @Post('saved-locations')
  async createSavedLocation(
    @CurrentUser() user: any,
    @Body() createSavedLocationDto: CreateSavedLocationDto,
  ) {
    return this.usersService.createSavedLocation(user.id, createSavedLocationDto);
  }

  /**
   * Update saved location
   */
  @Patch('saved-locations/:id')
  async updateSavedLocation(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() updateSavedLocationDto: UpdateSavedLocationDto,
  ) {
    return this.usersService.updateSavedLocation(user.id, id, updateSavedLocationDto);
  }

  /**
   * Delete saved location
   */
  @Delete('saved-locations/:id')
  async deleteSavedLocation(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    await this.usersService.deleteSavedLocation(user.id, id);
    return { message: 'Saved location deleted successfully' };
  }

  /**
   * Get notification preferences
   */
  @Get('notifications/preferences')
  async getNotificationPreferences(@CurrentUser() user: any) {
    return this.usersService.getNotificationPreferences(user.id);
  }

  /**
   * Update notification preferences
   */
  @Patch('notifications/preferences')
  async updateNotificationPreferences(
    @CurrentUser() user: any,
    @Body() updateNotificationPreferencesDto: UpdateNotificationPreferencesDto,
  ) {
    return this.usersService.updateNotificationPreferences(user.id, updateNotificationPreferencesDto);
  }
}
