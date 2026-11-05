import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { AuthUser, CurrentUser, RequirePlatform } from '../auth/context';
import { P } from '../auth/permissions';

const onboardSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  legalName: z.string().optional(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/).optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  planCode: z.string(),
  trialDays: z.number().int().min(0).max(90).default(14),
  owner: z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10) }),
});
const statusSchema = z.object({ status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CLOSED']), reason: z.string().min(3) });
const listQuery = z.object({ q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

@ApiTags('admin')
@Controller('v1/admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get('dashboard')
  @RequirePlatform(P.PLATFORM_READ_ALL)
  async dashboard() {
    const dayAgo = new Date(Date.now() - 86400_000);
    const [tenants, facilities, activeSessions, sessions24h, revenue24h, customers, openAlerts, subs] = await Promise.all([
      this.prisma.tenant.groupBy({ by: ['status'], _count: true }),
      this.prisma.parkingFacility.count(),
      this.prisma.parkingSession.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
      this.prisma.parkingSession.count({ where: { entryAt: { gte: dayAgo } } }),
      this.prisma.payment.aggregate({ where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] }, succeededAt: { gte: dayAgo } }, _sum: { amountMinor: true } }),
      this.prisma.user.count({ where: { kind: 'CUSTOMER' } }),
      this.prisma.hardwareAlert.count({ where: { resolvedAt: null } }),
      this.prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] } }, include: { plan: true } }),
    ]);
    const mrrMinor = subs.filter((s) => s.status === 'ACTIVE').reduce((sum, s) => sum + (s.billingCycle === 'YEARLY' ? Math.round(s.plan.priceYearlyMinor / 12) : s.plan.priceMonthlyMinor), 0);
    return { tenants: Object.fromEntries(tenants.map((t) => [t.status, t._count])), facilities, activeSessions, sessions24h, revenue24hMinor: revenue24h._sum.amountMinor ?? 0, customers, openAlerts, mrrMinor };
  }

  @Get('tenants')
  @RequirePlatform(P.PLATFORM_READ_ALL)
  async tenants(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.TenantWhereInput = q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q } }] } : {};
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { _count: { select: { facilities: true, members: true } }, subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: { select: { code: true, name: true } } } } },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Get('tenants/:id')
  @RequirePlatform(P.PLATFORM_READ_ALL)
  async tenant(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id },
      include: { facilities: { select: { id: true, name: true, code: true, isPublished: true } }, members: { include: { user: { select: { name: true, email: true, phone: true } }, role: { select: { key: true } } } }, subscriptions: { include: { plan: true, invoices: true } } },
    });
    if (!t) throw NotFound('Tenant');
    return t;
  }

  /** Onboard an operator: tenant + owner login + trial subscription, atomically. */
  @Post('tenants')
  @RequirePlatform(P.PLATFORM_TENANTS)
  async onboard(@CurrentUser() u: AuthUser, @Body(new ZodPipe(onboardSchema)) b: z.infer<typeof onboardSchema>) {
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { code: b.planCode } });
    if (!plan) throw NotFound('Plan');
    const ownerRole = await this.prisma.role.findUniqueOrThrow({ where: { key: 'TENANT_OWNER' } });
    const passwordHash = await argon2.hash(b.owner.password);
    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: { name: b.name, slug: b.slug, legalName: b.legalName, gstin: b.gstin, contactEmail: b.contactEmail, contactPhone: b.contactPhone, status: b.trialDays > 0 ? 'TRIAL' : 'ACTIVE' } });
      const owner = await tx.user.upsert({
        where: { email: b.owner.email.toLowerCase() },
        update: {},
        create: { email: b.owner.email.toLowerCase(), name: b.owner.name, kind: 'STAFF', passwordHash, profileComplete: true },
      });
      await tx.tenantMember.create({ data: { tenantId: t.id, userId: owner.id, roleId: ownerRole.id } });
      const start = new Date();
      await tx.subscription.create({
        data: { tenantId: t.id, planId: plan.id, status: b.trialDays > 0 ? 'TRIALING' : 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: new Date(start.getTime() + (b.trialDays || 30) * 86400_000) },
      });
      return t;
    });
    await this.audit.log({ tenantId: tenant.id, actorId: u.userId, actorKind: 'USER', action: 'tenant.onboard', entityType: 'Tenant', entityId: tenant.id, after: { ...b, owner: { ...b.owner, password: '[redacted]' } } });
    return tenant;
  }

  @Patch('tenants/:id/status')
  @RequirePlatform(P.PLATFORM_TENANTS)
  async setStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(statusSchema)) b: z.infer<typeof statusSchema>) {
    const before = await this.prisma.tenant.findUnique({ where: { id } });
    if (!before) throw NotFound('Tenant');
    const t = await this.prisma.tenant.update({ where: { id }, data: { status: b.status } });
    await this.audit.log({ tenantId: id, actorId: u.userId, actorKind: 'USER', action: 'tenant.status', entityType: 'Tenant', entityId: id, before: { status: before.status }, after: b });
    return t;
  }

  @Get('plans')
  @RequirePlatform(P.PLATFORM_READ_ALL)
  plans() {
    return this.prisma.subscriptionPlan.findMany({ include: { entitlements: true, _count: { select: { subscriptions: true } } }, orderBy: { priceMonthlyMinor: 'asc' } });
  }

  @Get('audit')
  @RequirePlatform(P.PLATFORM_AUDIT)
  auditLog(@Query('tenantId') tenantId?: string, @Query('entityType') entityType?: string, @Query('action') action?: string) {
    return this.prisma.auditLog.findMany({ where: { tenantId: tenantId || undefined, entityType: entityType || undefined, action: action ? { startsWith: action } : undefined }, orderBy: { at: 'desc' }, take: 200 });
  }
}
