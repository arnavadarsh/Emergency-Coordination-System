import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AmbulancesService } from './ambulances.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators';
import { UserRole, AmbulanceStatus } from '../common/enums';

/**
 * Ambulances Controller
 * Endpoints for ambulance management
 */
@Controller('ambulances')
export class AmbulancesController {
  constructor(private readonly ambulancesService: AmbulancesService) {}

  /**
   * Register new ambulance (public - pending verification)
   */
  @Post('register')
  async register(@Body() data: {
    vehicleNumber: string;
    vehicleType: string;
    driverName: string;
    driverPhone: string;
    driverLicense: string;
    currentLatitude?: number;
    currentLongitude?: number;
    equipmentList?: any;
  }) {
    return this.ambulancesService.create(data);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL)
  async findAll() {
    return this.ambulancesService.findAll();
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findAllIncludingPending() {
    return this.ambulancesService.findAllIncludingPending();
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async findPending() {
    return this.ambulancesService.findPending();
  }

  @Get('available')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL)
  async findAvailable() {
    return this.ambulancesService.findAvailable();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL, UserRole.DRIVER)
  async findOne(@Param('id') id: string) {
    return this.ambulancesService.findById(id);
  }

  @Patch(':id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async verify(@Param('id') id: string) {
    return this.ambulancesService.verify(id);
  }

  @Delete(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reject(@Param('id') id: string) {
    await this.ambulancesService.reject(id);
    return { message: 'Ambulance registration rejected' };
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DRIVER)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: AmbulanceStatus,
  ) {
    return this.ambulancesService.updateStatus(id, status);
  }

  @Patch(':id/location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  async updateLocation(
    @Param('id') id: string,
    @Body() data: { latitude: number; longitude: number },
  ) {
    return this.ambulancesService.updateLocation(id, data.latitude, data.longitude);
  }
}
