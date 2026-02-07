import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole } from '../common/enums';

interface UpdateHospitalDto {
  serviceStatus?: string;
  availableBeds?: number;
  totalBeds?: number;
}

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
    @Body('serviceStatus') serviceStatus: string,
  ) {
    return this.hospitalsService.updateStatus(id, serviceStatus);
  }

  @Patch(':id/beds')
  @UseGuards(RolesGuard)
  @Roles(UserRole.HOSPITAL, UserRole.ADMIN)
  async updateBeds(
    @Param('id') id: string,
    @Body() data: { availableBeds: number },
  ) {
    return this.hospitalsService.updateBeds(id, data.availableBeds);
  }
}
