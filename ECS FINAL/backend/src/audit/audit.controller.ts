import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators';
import { UserRole } from '../common/enums';

/**
 * Audit Controller
 * Endpoints for audit logs (admin only)
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async findAll(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.auditService.findAll(limitNum);
  }

  @Get('entity')
  async findByEntity(@Query('type') type: string, @Query('id') id: string) {
    return this.auditService.findByEntity(type, id);
  }

  @Get('stats')
  async getStats() {
    return this.auditService.getStats();
  }
}
