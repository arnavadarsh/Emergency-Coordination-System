import { Controller, Get, Patch, Param, Body, UseGuards, Query } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole } from '../common/enums';
import { UpdateHospitalDto, UpdateBedsDto, UpdateStatusDto, UpdateCapabilityDto } from './dto';

/**
 * Hospitals Controller
 * Endpoints for hospital management
 */
@Controller('hospitals')
@UseGuards(JwtAuthGuard)
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  async findAll() {
    return this.hospitalsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.hospitalsService.findById(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL, UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() updateHospitalDto: UpdateHospitalDto,
  ) {
    return this.hospitalsService.update(id, updateHospitalDto);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL, UserRole.ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.hospitalsService.updateStatus(id, body.status);
  }

  @Patch(':id/beds')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL, UserRole.ADMIN)
  async updateBeds(
    @Param('id') id: string,
    @Body() updateBedsDto: UpdateBedsDto,
  ) {
    return this.hospitalsService.updateBeds(id, updateBedsDto.availableBeds);
  }

  @Patch(':id/capability')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL, UserRole.ADMIN)
  async updateCapability(
    @Param('id') id: string,
    @Body() updateCapabilityDto: UpdateCapabilityDto,
  ) {
    return this.hospitalsService.updateCapability(id, updateCapabilityDto);
  }

  @Get('nearby')
  async findNearby(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radius') radius?: string,
  ) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radiusKm = radius ? parseFloat(radius) : 10;
    return this.hospitalsService.findNearby(lat, lng, radiusKm);
  }

  @Get(':id/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.HOSPITAL, UserRole.ADMIN)
  async getStats(@Param('id') id: string) {
    return this.hospitalsService.getHospitalStats(id);
  }
}
