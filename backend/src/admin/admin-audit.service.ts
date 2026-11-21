import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { User } from '../users/entities/user.entity';

/** Stands in for "the whole system" where the audit log needs an entity id. */
export const SYSTEM_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The record of what admins did. Every admin control writes here — with that
 * much power in one role, the audit trail is what keeps it accountable.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    private readonly auditService: AuditService,
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Never throws: a failed audit write must not undo an emergency action. */
  async record(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    details?: { before?: any; after?: any; changes?: any },
  ): Promise<void> {
    try {
      await this.auditService.log({
        userId: actorId,
        action,
        entityType,
        entityId,
        beforeState: details?.before ?? null,
        afterState: details?.after ?? null,
        changes: details?.changes ?? null,
      });
    } catch (error: any) {
      this.logger.error(`Audit write failed for ${action} on ${entityType} ${entityId}: ${error?.message ?? error}`);
    }
  }

  /** Newest first, filterable, with each actor's email instead of a bare id. */
  async list(query: { limit?: number; offset?: number; action?: string; entityType?: string; actorId?: string }) {
    const where: Record<string, string> = {};
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.actorId) where.userId = query.actorId;

    const [rows, total] = await this.auditRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
    });

    const actorIds = [...new Set(rows.map(row => row.userId).filter(Boolean))];
    const actors = actorIds.length > 0 ? await this.userRepository.find({ where: { id: In(actorIds) } }) : [];
    const emailById = new Map(actors.map(actor => [actor.id, actor.email]));

    return {
      total,
      items: rows.map(row => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorId: row.userId ?? null,
        actorEmail: row.userId ? emailById.get(row.userId) ?? null : null,
        changes: row.changes,
        beforeState: row.beforeState,
        afterState: row.afterState,
        createdAt: row.createdAt,
      })),
    };
  }
}
