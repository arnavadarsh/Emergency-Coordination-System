import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole } from '../common/enums';

/**
 * Dashboard Controller
 * Provides dashboard statistics for different user roles
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Get hospital dashboard stats
   */
  @Get('hospital')
  @Roles(UserRole.HOSPITAL)
  async getHospitalStats(@CurrentUser() user: any) {
    return this.dashboardService.getHospitalStats(user.hospitalId);
  }

  /**
   * Get admin dashboard stats
   */
  @Get('admin')
  @Roles(UserRole.ADMIN)
  async getAdminStats() {
    return this.dashboardService.getAdminStats();
  }

  /**
   * Get driver dashboard stats
   */
  @Get('driver')
  @Roles(UserRole.DRIVER)
  async getDriverStats(@CurrentUser() user: any) {
    return this.dashboardService.getDriverStats(user.id);
  }

  /**
   * Get user dashboard stats
   */
  @Get('user')
  @Roles(UserRole.USER)
  async getUserStats(@CurrentUser() user: any) {
    return this.dashboardService.getUserStats(user.id);
  }
}
