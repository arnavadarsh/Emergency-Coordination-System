import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities';

/**
 * Audit Service
 * Foundation for audit logging
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Create an audit log entry
   */
  async log(data: {
    entityType: string;
    entityId: string;
    action: string;
    changes?: any;
    beforeState?: any;
    afterState?: any;
    userId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLog> {
    const log = this.auditLogRepository.create(data);
    return this.auditLogRepository.save(log);
  }

  /**
   * Find audit logs for an entity
   */
  async findByEntity(entityType: string, entityId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { entityType, entityId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find all audit logs (admin only)
   */
  async findAll(limit: number = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get audit statistics
   */
  async getStats(): Promise<any> {
    const totalLogs = await this.auditLogRepository.count();
    
    // Get logs by action type
    const createActions = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where("audit.action LIKE '%CREATE%'")
      .getCount();
    
    const updateActions = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where("audit.action LIKE '%UPDATE%'")
      .getCount();
    
    const deleteActions = await this.auditLogRepository
      .createQueryBuilder('audit')
      .where("audit.action LIKE '%DELETE%'")
      .getCount();
    
    // Get logs by entity type
    const entityTypes = await this.auditLogRepository
      .createQueryBuilder('audit')
      .select('audit.entityType', 'entityType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.entityType')
      .getRawMany();

    return {
      total: totalLogs,
      byAction: {
        create: createActions,
        update: updateActions,
        delete: deleteActions,
      },
      byEntityType: entityTypes.reduce((acc, item) => {
        acc[item.entityType] = parseInt(item.count);
        return acc;
      }, {}),
    };
  }
}
