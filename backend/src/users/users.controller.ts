import { Controller, Get, Post, Patch, Put, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
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
  UpdateNotificationPreferencesDto,
  MedicalProfileDto,
  CreateEmergencyContactDto,
  UpdateEmergencyContactDto
} from './dto';
import { EmergencyContactsService } from './emergency-contacts.service';

/**
 * Users Controller
 * Handles user-related endpoints
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emergencyContactsService: EmergencyContactsService,
  ) {}

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
   * Get the signed-in patient's Medical Profile.
   * Unset fields come back as null, with "Not Provided" in the `display` block.
   */
  @Get('medical-profile')
  async getMyMedicalProfile(@CurrentUser() user: any) {
    return this.usersService.getMedicalProfile(user.id);
  }

  /**
   * Add, update or remove the signed-in patient's Medical Profile.
   *
   * Omit a field to leave it as it is; send it as "" to clear it. Saving here
   * does not recreate the patient ID — the same ID keeps the new information,
   * and every later triage session, pre-alert and report reads these values.
   */
  @Put('medical-profile')
  async updateMyMedicalProfile(
    @CurrentUser() user: any,
    @Body() medicalProfileDto: MedicalProfileDto,
  ) {
    return this.usersService.updateMedicalProfile(user.id, medicalProfileDto);
  }

  /**
   * Read a patient's Medical Profile as a responder.
   *
   * Drivers and hospital staff need it on the triage and pre-arrival screens;
   * admins need it for reports. Always resolved live from the patient's profile,
   * so it reflects the latest saved information.
   */
  @Get(':id/medical-profile')
  @Roles(UserRole.DRIVER, UserRole.HOSPITAL, UserRole.ADMIN)
  async getPatientMedicalProfile(@Param('id') id: string) {
    return this.usersService.getMedicalProfile(id);
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
    @Body() data: {
      bloodType?: string;
      bloodGroup?: string;
      allergies?: string;
      chronicConditions?: string;
      currentMedications?: string;
      medicalNotes?: string;
      emergencyContact?: string;
    },
  ) {
    return this.usersService.updateMedicalRecords(user.id, data);
  }

  // ── Patient-owned collections ───────────────────────────────────────────
  // Everything from here to the admin routes below is addressed by a literal
  // path, and must stay above `@Get(':id')`: Nest matches in declaration order,
  // so `/users/saved-locations` placed after it resolves to the admin-only
  // `getUser(':id')` handler instead, and answers a patient with 403.

  /**
   * The people to alert when an ambulance is assigned to this patient.
   */
  @Get('emergency-contacts')
  async getEmergencyContacts(@CurrentUser() user: any) {
    return this.emergencyContactsService.findAll(user.id);
  }

  /**
   * Save another emergency contact. They are texted the private tracking link
   * automatically on the patient's next dispatch.
   */
  @Post('emergency-contacts')
  async createEmergencyContact(
    @CurrentUser() user: any,
    @Body() createEmergencyContactDto: CreateEmergencyContactDto,
  ) {
    return this.emergencyContactsService.create(user.id, createEmergencyContactDto);
  }

  /**
   * Edit a saved contact — name, number, relation, or whether to alert them.
   */
  @Patch('emergency-contacts/:id')
  async updateEmergencyContact(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() updateEmergencyContactDto: UpdateEmergencyContactDto,
  ) {
    return this.emergencyContactsService.update(user.id, id, updateEmergencyContactDto);
  }

  /**
   * Remove a contact. They are not alerted about any future case.
   */
  @Delete('emergency-contacts/:id')
  async deleteEmergencyContact(@CurrentUser() user: any, @Param('id') id: string) {
    await this.emergencyContactsService.remove(user.id, id);
    return { message: 'Emergency contact removed successfully' };
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
}
