import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OverrideType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { DomainError, Forbidden, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { BarrierService } from '../hardware/barrier.service';
import { checkPlate } from '../vehicles/plate';

const requestSchema = z.object({
  facilityId: z.string().uuid(),
  type: z.nativeEnum(OverrideType),
  sessionId: z.string().uuid().optional(),
  gateId: z.string().uuid().optional(),
  reason: z.string().min(5).max(1000),
  payload: z.object({ amountMinor: z.number().int().optional(), plate: z.string().max(20).optional() }).default({}),
});

/**
 * Two-person rule: an override is requested by one staff member and approved by a different user
 * holding override.approve. Execution happens on approval, inside the same audited flow.
 */
@ApiTags('overrides')
@Controller('v1/overrides')
export class OverridesController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private barrier: BarrierService,
  ) {}

  @Post()
  @RequirePerm(P.OVERRIDE_REQUEST)
  async request(@Tenant() t: TenantContext, @Body(new ZodPipe(requestSchema)) b: z.infer<typeof requestSchema>) {
    t.assertFacility(b.facilityId);
    if (!(await this.prisma.parkingFacility.count({ where: { id: b.facilityId, tenantId: t.tenantId } }))) throw NotFound('Facility');
    if (b.sessionId && !(await this.prisma.parkingSession.count({ where: { id: b.sessionId, tenantId: t.tenantId, facilityId: b.facilityId } }))) throw NotFound('Session');
    const executable: OverrideType[] = ['FEE_WAIVER', 'FEE_ADJUSTMENT', 'PLATE_CORRECTION', 'LOST_TICKET', 'MANUAL_BARRIER_OPEN'];
    if (!executable.includes(b.type)) throw new DomainError('OVERRIDE_TYPE_NOT_SUPPORTED', `${b.type} overrides are not yet supported`, 422);
    const needsSession: OverrideType[] =['FEE_WAIVER', 'FEE_ADJUSTMENT', 'PLATE_CORRECTION', 'FORCE_EXIT', 'LOST_TICKET'];
    if (needsSession.includes(b.type) && !b.sessionId) throw new DomainError('SESSION_REQUIRED', 'This override needs a session', 400);
    if (b.type === 'MANUAL_BARRIER_OPEN' && !b.gateId) throw new DomainError('GATE_REQUIRED', 'Select the gate', 400);
    const o = await this.prisma.supervisorOverride.create({ data: { tenantId: t.tenantId, ...b, requestedById: t.userId, payload: b.payload as Prisma.InputJsonValue } });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'override.request', entityType: 'SupervisorOverride', entityId: o.id, after: b });
    return o;
  }

  @Get()
  @RequirePerm(P.OVERRIDE_REQUEST)
  list(@Tenant() t: TenantContext, @Query('status') status?: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXECUTED', @Query('facilityId') facilityId?: string) {
    if (facilityId) t.assertFacility(facilityId);
    return this.prisma.supervisorOverride.findMany({ where: { tenantId: t.tenantId, status, facilityId: facilityId || undefined }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Post(':id/reject')
  @RequirePerm(P.OVERRIDE_APPROVE)
  async reject(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const upd = await this.prisma.supervisorOverride.updateMany({ where: { id, tenantId: t.tenantId, status: 'REQUESTED' }, data: { status: 'REJECTED', approvedById: t.userId, decidedAt: new Date() } });
    if (!upd.count) throw new DomainError('NOT_PENDING', 'Override is not pending', 409);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'override.reject', entityType: 'SupervisorOverride', entityId: id });
    return { status: 'REJECTED' };
  }

  @Post(':id/approve')
  @RequirePerm(P.OVERRIDE_APPROVE)
  async approve(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const o = await this.prisma.supervisorOverride.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!o) throw NotFound('Override');
    t.assertFacility(o.facilityId);
    if (o.status !== 'REQUESTED') throw new DomainError('NOT_PENDING', 'Override is not pending', 409);
    if (o.requestedById === t.userId) throw Forbidden('Overrides must be approved by a different person');
    const payload = o.payload as { amountMinor?: number; plate?: string };

    const executed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.supervisorOverride.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'APPROVED', approvedById: t.userId, decidedAt: new Date() } });
      if (!claim.count) throw new DomainError('NOT_PENDING', 'Override is not pending', 409);
      let detail: Record<string, unknown> = {};
      switch (o.type) {
        case 'FEE_WAIVER':
        case 'FEE_ADJUSTMENT': {
          const s = await tx.parkingSession.findUniqueOrThrow({ where: { id: o.sessionId! } });
          const amount = o.type === 'FEE_WAIVER' ? -(s.amountDueMinor - s.amountPaidMinor) : payload.amountMinor ?? 0;
          if (amount === 0) throw new DomainError('INVALID_ADJUSTMENT', o.type === 'FEE_WAIVER' ? 'Nothing outstanding to waive — quote the exit fee first' : 'Adjustment amount required', 422);
          await tx.parkingSessionAdjustment.create({ data: { sessionId: s.id, overrideId: o.id, amountMinor: amount, reason: o.reason, actorId: t.userId } });
          await tx.parkingSessionEvent.create({ data: { sessionId: s.id, type: 'OVERRIDE', actorId: t.userId, data: { overrideId: o.id, type: o.type, amountMinor: amount } } });
          detail = { amountMinor: amount };
          break;
        }
        case 'PLATE_CORRECTION': {
          const plate = checkPlate(payload.plate ?? '');
          if (!plate.normalized) throw new DomainError('INVALID_PLATE', 'Corrected plate required', 400);
          const s = await tx.parkingSession.findUniqueOrThrow({ where: { id: o.sessionId! } });
          await tx.parkingSession.update({ where: { id: s.id }, data: { plateNormalized: plate.normalized } });
          await tx.parkingSessionEvent.create({ data: { sessionId: s.id, type: 'PLATE_CORRECTED', actorId: t.userId, data: { from: s.plateNormalized, to: plate.normalized, overrideId: o.id } } });
          detail = { from: s.plateNormalized, to: plate.normalized };
          break;
        }
        case 'LOST_TICKET': {
          await tx.parkingSession.update({ where: { id: o.sessionId! }, data: { isLostTicket: true } });
          await tx.parkingTicket.updateMany({ where: { sessionId: o.sessionId! }, data: { lost: true } });
          break;
        }
        default:
          break;
      }
      await tx.supervisorOverride.update({ where: { id }, data: { status: 'EXECUTED' } });
      await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'override.approve', entityType: 'SupervisorOverride', entityId: id, after: { type: o.type, ...detail } }, tx);
      return detail;
    });

    let barrier;
    if (o.type === 'MANUAL_BARRIER_OPEN') barrier = await this.barrier.open({ tenantId: t.tenantId, gateId: o.gateId, reason: 'OVERRIDE', overrideId: o.id, sessionId: o.sessionId ?? undefined, requestedById: t.userId });
    return { status: 'EXECUTED', type: o.type, ...executed, barrier };
  }
}
