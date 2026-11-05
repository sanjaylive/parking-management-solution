import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { OccupancyService } from '../occupancy/occupancy.service';
import { EntitlementService } from './entitlement.service';

const memberSchema = z.object({
  name: z.string().min(2), email: z.string().email().optional(), phone: z.string().optional(), password: z.string().min(10).optional(),
  roleKey: z.enum(['FACILITY_MANAGER', 'SUPERVISOR', 'CASHIER', 'GATE_ATTENDANT', 'VALET_DRIVER']), facilityIds: z.array(z.string().uuid()).default([]),
}).refine((m) => m.email || m.phone, 'email or phone required');
const memberPatch = z.object({ roleKey: z.enum(['FACILITY_MANAGER', 'SUPERVISOR', 'CASHIER', 'GATE_ATTENDANT', 'VALET_DRIVER']).optional(), facilityIds: z.array(z.string().uuid()).optional(), active: z.boolean().optional() });

@ApiTags('operator')
@Controller('v1/operator')
export class OperatorController {
  constructor(
    private prisma: PrismaService,
    private occupancy: OccupancyService,
    private audit: AuditService,
    private entitlements: EntitlementService,
  ) {}

  /** Live dashboard for one facility or the whole tenant. */
  @Get('dashboard')
  @RequirePerm(P.FACILITY_READ)
  async dashboard(@Tenant() t: TenantContext, @Query('facilityId') facilityId?: string) {
    if (facilityId) t.assertFacility(facilityId);
    const facilityFilter = facilityId ? { facilityId } : t.facilityIds ? { facilityId: { in: [...t.facilityIds] } } : {};
    const facilities = await this.prisma.parkingFacility.findMany({ where: { tenantId: t.tenantId, ...(facilityId ? { id: facilityId } : t.facilityIds ? { id: { in: [...t.facilityIds] } } : {}) }, select: { id: true, name: true, timezone: true } });
    const tz = facilities[0]?.timezone ?? 'Asia/Kolkata';
    // Start of "today" in facility timezone.
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const offsetProbe = new Date(`${localDate}T00:00:00Z`);
    const tzOffsetMs = new Date(offsetProbe.toLocaleString('en-US', { timeZone: tz })).getTime() - new Date(offsetProbe.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    const dayStart = new Date(offsetProbe.getTime() - tzOffsetMs);

    const base = { tenantId: t.tenantId, ...facilityFilter };
    const [occupancy, entries, exits, revenue, pendingPayments, staffOnDuty, alerts, gates, pendingOverrides, upcomingReservations, byHour, methods, sub] = await Promise.all([
      Promise.all(facilities.map(async (f) => ({ facilityId: f.id, name: f.name, pools: await this.occupancy.snapshot(f.id) }))),
      this.prisma.parkingSession.count({ where: { ...base, entryAt: { gte: dayStart } } }),
      this.prisma.parkingSession.count({ where: { ...base, exitAt: { gte: dayStart } } }),
      this.prisma.payment.aggregate({ where: { tenantId: t.tenantId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] }, succeededAt: { gte: dayStart }, ...(facilityId || t.facilityIds ? { OR: [{ sessionId: { in: (await this.prisma.parkingSession.findMany({ where: { ...base, entryAt: { gte: new Date(dayStart.getTime() - 30 * 86400_000) } }, select: { id: true } })).map((s) => s.id) } }] } : {}) }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.parkingSession.count({ where: { ...base, status: 'PAYMENT_PENDING' } }),
      this.prisma.staffShift.count({ where: { ...base, status: 'OPEN' } }),
      this.prisma.hardwareAlert.findMany({ where: { tenantId: t.tenantId, resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.parkingGate.findMany({ where: base, select: { id: true, code: true, name: true, status: true, direction: true, facilityId: true, lastHeartbeatAt: true } }),
      this.prisma.supervisorOverride.count({ where: { ...base, status: 'REQUESTED' } }),
      this.prisma.parkingReservation.count({ where: { ...base, status: 'CONFIRMED', startsAt: { gte: new Date(), lte: new Date(Date.now() + 24 * 3600_000) } } }),
      this.prisma.$queryRawUnsafe<{ hour: number; entries: number }[]>(
        `SELECT EXTRACT(HOUR FROM "entryAt" AT TIME ZONE $1)::int AS hour, COUNT(*)::int AS entries FROM "ParkingSession" WHERE "tenantId" = $2::uuid AND "entryAt" >= $3 ${facilityId ? `AND "facilityId" = $4::uuid` : ''} GROUP BY 1 ORDER BY 1`,
        ...[tz, t.tenantId, dayStart, ...(facilityId ? [facilityId] : [])],
      ),
      this.prisma.payment.groupBy({ by: ['method'], where: { tenantId: t.tenantId, status: 'SUCCEEDED', succeededAt: { gte: dayStart } }, _sum: { amountMinor: true } }),
      this.prisma.subscription.findFirst({ where: { tenantId: t.tenantId }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true, code: true } } } }),
    ]);
    const totals = occupancy.flatMap((o) => o.pools).reduce((a, p) => ({ total: a.total + p.total, occupied: a.occupied + p.occupied, available: a.available + p.available, reservedDue: a.reservedDue + p.reservedDue }), { total: 0, occupied: 0, available: 0, reservedDue: 0 });
    return {
      dayStart, totals, occupancy, entriesToday: entries, exitsToday: exits, revenueTodayMinor: revenue._sum.amountMinor ?? 0, paymentsToday: revenue._count,
      pendingPayments, staffOnDuty, alerts, gates, pendingOverrides, upcomingReservations,
      entriesByHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, entries: byHour.find((b) => b.hour === h)?.entries ?? 0 })),
      paymentMethods: methods.map((m) => ({ method: m.method, amountMinor: m._sum.amountMinor ?? 0 })),
      subscription: sub ? { status: sub.status, plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd } : null,
    };
  }

  @Get('members')
  @RequirePerm(P.TENANT_STAFF)
  members(@Tenant() t: TenantContext) {
    return this.prisma.tenantMember.findMany({ where: { tenantId: t.tenantId }, include: { user: { select: { id: true, name: true, email: true, phone: true, lastLoginAt: true } }, role: { select: { key: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  }

  @Post('members')
  @RequirePerm(P.TENANT_STAFF)
  async addMember(@Tenant() t: TenantContext, @Body(new ZodPipe(memberSchema)) b: z.infer<typeof memberSchema>) {
    await this.entitlements.assertWithin(t.tenantId, 'maxStaff', () => this.prisma.tenantMember.count({ where: { tenantId: t.tenantId, active: true } }));
    if (b.facilityIds.length && (await this.prisma.parkingFacility.count({ where: { tenantId: t.tenantId, id: { in: b.facilityIds } } })) !== b.facilityIds.length) throw NotFound('Facility');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { key: b.roleKey } });
    const phone = b.phone ? (b.phone.startsWith('+') ? b.phone : '+91' + b.phone.replace(/\D/g, '')) : undefined;
    const existing = await this.prisma.user.findFirst({ where: { OR: [b.email ? { email: b.email.toLowerCase() } : {}, phone ? { phone } : {}].filter((x) => Object.keys(x).length) } });
    const user = existing ?? (await this.prisma.user.create({ data: { name: b.name, email: b.email?.toLowerCase(), phone, kind: 'STAFF', profileComplete: true, passwordHash: b.password ? await argon2.hash(b.password) : null } }));
    if (await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId: t.tenantId, userId: user.id } } })) throw new DomainError('ALREADY_MEMBER', 'User is already a team member', 409);
    const m = await this.prisma.tenantMember.create({ data: { tenantId: t.tenantId, userId: user.id, roleId: role.id, facilityIds: b.facilityIds } });
    await this.prisma.staffProfile.upsert({ where: { tenantId_userId: { tenantId: t.tenantId, userId: user.id } }, update: {}, create: { tenantId: t.tenantId, userId: user.id } });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'member.add', entityType: 'TenantMember', entityId: m.id, after: { ...b, password: b.password ? '[redacted]' : undefined } });
    return m;
  }

  @Patch('members/:id')
  @RequirePerm(P.TENANT_STAFF)
  async updateMember(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(memberPatch)) b: z.infer<typeof memberPatch>) {
    const m = await this.prisma.tenantMember.findFirst({ where: { id, tenantId: t.tenantId }, include: { role: true } });
    if (!m) throw NotFound('Member');
    if (m.role.key === 'TENANT_OWNER') throw new DomainError('OWNER_IMMUTABLE', 'Owner membership cannot be changed here', 403);
    const roleId = b.roleKey ? (await this.prisma.role.findUniqueOrThrow({ where: { key: b.roleKey } })).id : undefined;
    const upd = await this.prisma.tenantMember.update({ where: { id }, data: { roleId, facilityIds: b.facilityIds, active: b.active } });
    if (b.active === false) await this.prisma.userSession.updateMany({ where: { userId: m.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'member.update', entityType: 'TenantMember', entityId: id, before: { role: m.role.key, facilityIds: m.facilityIds, active: m.active }, after: b });
    return upd;
  }
}
