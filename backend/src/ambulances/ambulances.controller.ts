import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { AmbulancesService } from './ambulances.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole } from '../common/enums';
import { RegisterAmbulanceDto, UpdateStatusDto, UpdateLocationDto, UpdateEquipmentDto } from './dto';

/**
 * Ambulances Controller
 * Endpoints for ambulance management
 */
@Controller('ambulances')
export class AmbulancesController {
  constructor(private readonly ambulancesService: AmbulancesService) {}

  /**
   * A driver may only act on the ambulance linked to their own account. Without
   * this any driver could mark any unit available, move it on the map, or edit
   * its equipment — and dispatch trusts all three.
   */
  private assertOwnAmbulance(user: any, ambulanceId: string): void {
    if (user?.role === UserRole.DRIVER && user.ambulanceId !== ambulanceId) {
      throw new ForbiddenException('You can only update the ambulance assigned to you');
    }
  }

  /**
   * Register new ambulance (public - pending verification)
   */
  @Post('register')
  async register(@Body() registerAmbulanceDto: RegisterAmbulanceDto) {
    return this.ambulancesService.create(registerAmbulanceDto);
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
    @Body() updateStatusDto: UpdateStatusDto,
    @CurrentUser() user: any,
  ) {
    this.assertOwnAmbulance(user, id);
    return this.ambulancesService.updateStatus(id, updateStatusDto.status);
  }

  @Patch(':id/location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  async updateLocation(
    @Param('id') id: string,
    @Body() updateLocationDto: UpdateLocationDto,
    @CurrentUser() user: any,
  ) {
    this.assertOwnAmbulance(user, id);
    return this.ambulancesService.updateLocation(id, updateLocationDto.latitude, updateLocationDto.longitude);
  }

  @Patch(':id/equipment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DRIVER)
  async updateEquipment(
    @Param('id') id: string,
    @Body() updateEquipmentDto: UpdateEquipmentDto,
    @CurrentUser() user: any,
  ) {
    this.assertOwnAmbulance(user, id);
    return this.ambulancesService.updateEquipment(id, updateEquipmentDto.equipmentList);
  }

  /**
   * Signed-in callers only: the rows carry the driver details captured at
   * ambulance registration (name, phone, licence).
   */
  @Get('nearby')
  @UseGuards(JwtAuthGuard)
  async findNearby(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radius') radius?: string,
  ) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusKm = radius ? parseFloat(radius) : 10;
    return this.ambulancesService.findNearby(lat, lng, radiusKm);
  }
}
