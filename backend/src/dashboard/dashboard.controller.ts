import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
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

  /**
   * Get live ETA between two coordinates
   */
  @Get('eta')
  @Roles(UserRole.USER, UserRole.DRIVER, UserRole.ADMIN, UserRole.HOSPITAL)
  async getLiveEta(
    @Query('originLat') originLat: string,
    @Query('originLng') originLng: string,
    @Query('destinationLat') destinationLat: string,
    @Query('destinationLng') destinationLng: string,
  ) {
    const parsedOriginLat = Number(originLat);
    const parsedOriginLng = Number(originLng);
    const parsedDestinationLat = Number(destinationLat);
    const parsedDestinationLng = Number(destinationLng);

    if (
      !Number.isFinite(parsedOriginLat) ||
      !Number.isFinite(parsedOriginLng) ||
      !Number.isFinite(parsedDestinationLat) ||
      !Number.isFinite(parsedDestinationLng)
    ) {
      throw new BadRequestException('Invalid coordinates for ETA calculation');
    }

    return this.dashboardService.getLiveEta(
      parsedOriginLat,
      parsedOriginLng,
      parsedDestinationLat,
      parsedDestinationLng,
    );
  }
}
