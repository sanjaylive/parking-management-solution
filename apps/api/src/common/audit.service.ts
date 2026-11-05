import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from './prisma.service';

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  actorKind: 'USER' | 'DEVICE' | 'SYSTEM';
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Pass `tx` to make the audit row part of the business transaction. */
  async log(e: AuditEntry, tx?: Tx) {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        tenantId: e.tenantId ?? null,
        actorId: e.actorId ?? null,
        actorKind: e.actorKind,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: e.ip,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
