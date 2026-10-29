import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { HospitalCapability, UserRole } from '../common/enums';
import { AdminUsersService } from './admin-users.service';
import { AdminFleetService } from './admin-fleet.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminSystemService } from './admin-system.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminAuditQueryDto,
  AdminBroadcastDto,
  AdminCapabilityDto,
  AdminCreateAmbulanceDto,
  AdminCreateHospitalDto,
  AdminDispatchDto,
  AdminDispatchStatusDto,
  AdminReassignDto,
  AdminResetPasswordDto,
  AdminRerouteDto,
  AdminSettingsDto,
  AdminTestSmsDto,
  AdminUpdateAmbulanceDto,
  AdminUpdateHospitalDto,
  AdminUpdateUserDto,
} from './dto/admin.dto';

const uuid = new ParseUUIDPipe();

/** Accounts: edit, link, role, switch off, reset password, end sessions. */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get(':id')
  getUser(@Param('id', uuid) id: string) {
    return this.users.getUser(id);
  }

  @Patch(':id')
  updateUser(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminUpdateUserDto) {
    return this.users.updateUser(admin, id, dto);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminResetPasswordDto) {
    return this.users.resetPassword(admin, id, dto.password);
  }

  @Post(':id/sign-out')
  @HttpCode(HttpStatus.OK)
  signOut(@CurrentUser() admin: any, @Param('id', uuid) id: string) {
    return this.users.signOutEverywhere(admin, id);
  }
}

/** Hospitals (with capabilities) and ambulances. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminFleetController {
  constructor(private readonly fleet: AdminFleetService) {}

  @Get('hospitals')
  listHospitals() {
    return this.fleet.listHospitals();
  }

  @Post('hospitals')
  createHospital(@CurrentUser() admin: any, @Body() dto: AdminCreateHospitalDto) {
    return this.fleet.createHospital(admin, dto);
  }

  @Patch('hospitals/:id')
  updateHospital(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminUpdateHospitalDto) {
    return this.fleet.updateHospital(admin, id, dto);
  }

  @Delete('hospitals/:id')
  deleteHospital(@CurrentUser() admin: any, @Param('id', uuid) id: string) {
    return this.fleet.deleteHospital(admin, id);
  }

  @Put('hospitals/:id/capabilities/:type')
  upsertCapability(
    @CurrentUser() admin: any,
    @Param('id', uuid) id: string,
    @Param('type', new ParseEnumPipe(HospitalCapability)) type: HospitalCapability,
    @Body() dto: AdminCapabilityDto,
  ) {
    return this.fleet.upsertCapability(admin, id, type, dto);
  }

  @Delete('hospitals/:id/capabilities/:type')
  removeCapability(
    @CurrentUser() admin: any,
    @Param('id', uuid) id: string,
    @Param('type', new ParseEnumPipe(HospitalCapability)) type: HospitalCapability,
  ) {
    return this.fleet.removeCapability(admin, id, type);
  }

  @Get('ambulances')
  listAmbulances() {
    return this.fleet.listAmbulances();
  }

  @Post('ambulances')
  createAmbulance(@CurrentUser() admin: any, @Body() dto: AdminCreateAmbulanceDto) {
    return this.fleet.createAmbulance(admin, dto);
  }

  @Patch('ambulances/:id')
  updateAmbulance(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminUpdateAmbulanceDto) {
    return this.fleet.updateAmbulance(admin, id, dto);
  }

  @Delete('ambulances/:id')
  deleteAmbulance(@CurrentUser() admin: any, @Param('id', uuid) id: string) {
    return this.fleet.deleteAmbulance(admin, id);
  }
}

/** Live case control. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOperationsController {
  constructor(private readonly operations: AdminOperationsService) {}

  @Get('bookings/queue')
  queue() {
    return this.operations.queue();
  }

  @Get('bookings/:id/controls')
  controls(@Param('id', uuid) id: string) {
    return this.operations.controls(id);
  }

  @Post('bookings/:id/dispatch')
  dispatch(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminDispatchDto) {
    return this.operations.dispatch(admin, id, dto.ambulanceId);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() admin: any, @Param('id', uuid) id: string) {
    return this.operations.cancel(admin, id);
  }

  @Post('bookings/:id/tracking/revoke')
  @HttpCode(HttpStatus.OK)
  revokeTracking(@CurrentUser() admin: any, @Param('id', uuid) id: string) {
    return this.operations.revokeTracking(admin, id);
  }

  @Get('bookings/:id/chat')
  chat(@CurrentUser() admin: any, @Param('id', uuid) id: string) {
    return this.operations.chat(admin, id);
  }

  @Post('dispatches/:id/reassign')
  @HttpCode(HttpStatus.OK)
  reassign(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminReassignDto) {
    return this.operations.reassign(admin, id, dto.ambulanceId);
  }

  @Post('dispatches/:id/hospital')
  @HttpCode(HttpStatus.OK)
  reroute(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminRerouteDto) {
    return this.operations.reroute(admin, id, dto.hospitalId);
  }

  @Post('dispatches/:id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(@CurrentUser() admin: any, @Param('id', uuid) id: string, @Body() dto: AdminDispatchStatusDto) {
    return this.operations.setStatus(admin, id, dto.status);
  }
}

/** System switches, health, announcements, and the audit trail. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSystemController {
  constructor(
    private readonly system: AdminSystemService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('system/settings')
  getSettings() {
    return this.system.getSettings();
  }

  @Patch('system/settings')
  updateSettings(@CurrentUser() admin: any, @Body() dto: AdminSettingsDto) {
    return this.system.updateSettings(admin, dto);
  }

  @Get('system/status')
  status() {
    return this.system.status();
  }

  @Post('system/broadcast')
  @HttpCode(HttpStatus.OK)
  broadcast(@CurrentUser() admin: any, @Body() dto: AdminBroadcastDto) {
    return this.system.broadcast(admin, dto);
  }

  @Post('system/test-sms')
  @HttpCode(HttpStatus.OK)
  testSms(@CurrentUser() admin: any, @Body() dto: AdminTestSmsDto) {
    return this.system.testSms(admin, dto.phoneNumber);
  }

  @Post('system/dispatch-retry')
  @HttpCode(HttpStatus.OK)
  runDispatch(@CurrentUser() admin: any) {
    return this.system.runDispatch(admin);
  }

  @Get('audit')
  listAudit(@Query() query: AdminAuditQueryDto) {
    return this.audit.list(query);
  }
}
