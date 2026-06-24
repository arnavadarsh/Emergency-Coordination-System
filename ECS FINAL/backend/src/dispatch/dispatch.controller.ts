import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { UserRole } from '../common/enums';

interface UpdateDispatchDto {
  status?: string;
  notes?: string;
}

/**
 * Dispatch Controller
 * Endpoints for dispatch management
 */
@Controller('dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL)
  async findAll() {
    return this.dispatchService.findAll();
  }

  @Get('driver')
  @Roles(UserRole.DRIVER)
  async findDriverDispatches(@CurrentUser() user: any) {
    return this.dispatchService.findByDriver(user.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.HOSPITAL, UserRole.DRIVER)
  async findOne(@Param('id') id: string) {
    return this.dispatchService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.HOSPITAL)
  async update(
    @Param('id') id: string,
    @Body() updateDispatchDto: UpdateDispatchDto,
    @CurrentUser() user: any,
  ) {
    return this.dispatchService.update(id, updateDispatchDto, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.DRIVER)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: any,
  ) {
    return this.dispatchService.updateStatus(id, status, user);
  }
}
