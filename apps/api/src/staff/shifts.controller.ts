import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Conflict, DomainError, Forbidden, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { LedgerService } from '../payments/ledger.service';

const openSchema = z.object({ facilityId: z.string().uuid(), gateId: z.string().uuid().optional(), openingFloatMinor: z.number().int().min(0).default(0) });
const closeSchema = z.object({ declaredCashMinor: z.number().int().min(0), notes: z.string().max(1000).optional() });

@ApiTags('staff')
@Controller('v1/shifts')
export class ShiftsController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ledger: LedgerService,
  ) {}

  @Get('current')
  @RequirePerm(P.SHIFT_OWN)
  async current(@Tenant() t: TenantContext) {
    const shift = await this.prisma.staffShift.findFirst({ where: { tenantId: t.tenantId, userId: t.userId, status: 'OPEN' }, include: { facility: { select: { name: true } } } });
    if (!shift) return null;
    return { ...shift, ...(await this.totals(shift.id, shift.openingFloatMinor)) };
  }

  private async totals(shiftId: string, float: number) {
    const recs = await this.prisma.shiftCashRecord.groupBy({ by: ['kind'], where: { shiftId }, _sum: { amountMinor: true }, _count: true });
    const by = Object.fromEntries(recs.map((r) => [r.kind, { amountMinor: r._sum.amountMinor ?? 0, count: r._count }]));
    const collected = by.COLLECTION?.amountMinor ?? 0;
    const payouts = by.PAYOUT?.amountMinor ?? 0;
    const drops = by.DROP?.amountMinor ?? 0;
    return { collectedMinor: collected, collections: by.COLLECTION?.count ?? 0, expectedCashMinor: float + collected - payouts - drops };
  }

  @Post('open')
  @RequirePerm(P.SHIFT_OWN)
  async open(@Tenant() t: TenantContext, @Body(new ZodPipe(openSchema)) b: z.infer<typeof openSchema>) {
    t.assertFacility(b.facilityId);
    if (!(await this.prisma.parkingFacility.count({ where: { id: b.facilityId, tenantId: t.tenantId } }))) throw NotFound('Facility');
    const existing = await this.prisma.staffShift.findFirst({ where: { tenantId: t.tenantId, userId: t.userId, status: 'OPEN' } });
    if (existing) throw Conflict('SHIFT_ALREADY_OPEN', 'You already have an open shift', { shiftId: existing.id });
    const s = await this.prisma.staffShift.create({ data: { tenantId: t.tenantId, userId: t.userId, ...b } });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'shift.open', entityType: 'StaffShift', entityId: s.id, after: b });
    return s;
  }

  @Post(':id/close')
  @RequirePerm(P.SHIFT_OWN)
  async close(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(closeSchema)) b: z.infer<typeof closeSchema>) {
    const shift = await this.prisma.staffShift.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!shift) throw NotFound('Shift');
    if (shift.userId !== t.userId && !t.can(P.SHIFT_RECONCILE)) throw Forbidden('Only the shift owner or a supervisor can close this shift');
    if (shift.status !== 'OPEN') throw new DomainError('SHIFT_NOT_OPEN', 'Shift is not open', 409);
    const { expectedCashMinor, collectedMinor } = await this.totals(id, shift.openingFloatMinor);
    const variance = b.declaredCashMinor - expectedCashMinor;
    const closed = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.staffShift.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date(), expectedCashMinor, declaredCashMinor: b.declaredCashMinor, varianceMinor: variance, notes: b.notes } });
      if (upd.count === 0) throw new DomainError('SHIFT_NOT_OPEN', 'Shift is not open', 409);
      if (variance !== 0) {
        await tx.reconciliationRecord.create({ data: { tenantId: t.tenantId, kind: 'CASH_SHIFT', refId: id, expected: expectedCashMinor, actual: b.declaredCashMinor, difference: variance, notes: variance < 0 ? 'Shortage' : 'Overage' } });
        const amt = Math.abs(variance);
        await this.ledger.post(tx, {
          tenantId: t.tenantId, refType: 'ADJUSTMENT', refId: id, memo: `Shift cash ${variance < 0 ? 'shortage' : 'overage'}`,
          lines: variance < 0 ? [{ account: 'CASH_VARIANCE', debitMinor: amt }, { account: 'CASH_DRAWER', creditMinor: amt }] : [{ account: 'CASH_DRAWER', debitMinor: amt }, { account: 'CASH_VARIANCE', creditMinor: amt }],
        });
      }
      return tx.staffShift.findUniqueOrThrow({ where: { id } });
    });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'shift.close', entityType: 'StaffShift', entityId: id, after: { expectedCashMinor, declared: b.declaredCashMinor, variance } });
    return { ...closed, collectedMinor };
  }

  @Post(':id/reconcile')
  @RequirePerm(P.SHIFT_RECONCILE)
  async reconcile(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const upd = await this.prisma.staffShift.updateMany({ where: { id, tenantId: t.tenantId, status: 'CLOSED' }, data: { status: 'RECONCILED', reconciledById: t.userId } });
    if (!upd.count) throw new DomainError('SHIFT_NOT_CLOSED', 'Only closed shifts can be reconciled', 409);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'shift.reconcile', entityType: 'StaffShift', entityId: id });
    return { ok: true };
  }

  @Get()
  @RequirePerm(P.SHIFT_RECONCILE)
  list(@Tenant() t: TenantContext, @Query('facilityId') facilityId?: string, @Query('status') status?: 'OPEN' | 'CLOSED' | 'RECONCILED') {
    if (facilityId) t.assertFacility(facilityId);
    return this.prisma.staffShift.findMany({ where: { tenantId: t.tenantId, facilityId: facilityId || undefined, status }, orderBy: { openedAt: 'desc' }, take: 100 });
  }
}
