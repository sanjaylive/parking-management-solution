import { Body, Controller, Delete, Get, Global, HttpCode, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { AuthUser, CurrentUser, RequirePlatform } from '../auth/context';
import { P } from '../auth/permissions';
import { LiveService } from '../realtime/live.service';
import { SettingsService } from '../settings/settings.service';

export type NotificationType = 'operator' | 'billing' | 'hardware' | 'security' | 'system' | 'announcement';
export type Severity = 'info' | 'success' | 'warning' | 'critical';
export interface NotificationInput {
  title: string;
  body: string;
  type: NotificationType;
  severity?: Severity;
  /** In-app path to open, e.g. /admin/operators/<id> */
  link?: string;
  meta?: Record<string, unknown>;
}

const OPERATOR_ADMIN_ROLES = ['TENANT_OWNER', 'FACILITY_MANAGER'];

/**
 * In-app notifications. Rows are per recipient (read state is personal); each new row is pushed to the
 * recipient's open sockets (room user:<id>) so bells update instantly, with polling as the fallback.
 */
@Injectable()
export class NotificationsService {
  private log = new Logger('Notifications');
  constructor(private prisma: PrismaService, private live: LiveService, private settings: SettingsService) {}

  async notify(userIds: string[], n: NotificationInput) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    const data = { type: n.type, severity: n.severity ?? 'info', link: n.link ?? null, ...(n.meta ?? {}) } as Prisma.InputJsonValue;
    const rows = await this.prisma.notification.createManyAndReturn({ data: ids.map((userId) => ({ userId, title: n.title, body: n.body, data })) });
    for (const r of rows) this.live.toUser(r.userId, 'notification', present(r));
    return rows.length;
  }

  platformAdminIds() {
    return this.prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { scope: 'PLATFORM' } } } }, select: { id: true } }).then((u) => u.map((x) => x.id));
  }

  operatorAdminIds(tenantIds?: string[]) {
    return this.prisma.tenantMember
      .findMany({ where: { active: true, role: { key: { in: OPERATOR_ADMIN_ROLES } }, ...(tenantIds ? { tenantId: { in: tenantIds } } : {}) }, select: { userId: true } })
      .then((m) => m.map((x) => x.userId));
  }

  /** Platform event, gated by Settings → Notifications. Never throws: a failed notification must not fail the business action. */
  async platformEvent(toggle: 'operatorOnboarded' | 'operatorStatusChanged' | 'hardwareAlerts', n: NotificationInput) {
    try {
      if (!(await this.settings.get('notifications'))[toggle]) return;
      await this.notify(await this.platformAdminIds(), n);
    } catch (e) {
      this.log.warn(`platform notification failed: ${(e as Error).message}`);
    }
  }

  /** Hardware fault: the operator's owners/managers always; platform admins too when critical (and enabled). */
  async hardwareAlert(a: { tenantId: string; facilityId: string; title: string; body: string; critical: boolean }) {
    await this.safe(async () => {
      const severity: Severity = a.critical ? 'critical' : 'warning';
      await this.notify(await this.operatorAdminIds([a.tenantId]), { title: a.title, body: a.body, type: 'hardware', severity, link: `/facilities/${a.facilityId}` });
      if (a.critical) await this.platformEvent('hardwareAlerts', { title: a.title, body: a.body, type: 'hardware', severity, link: `/admin/operators/${a.tenantId}` });
    });
  }

  async safe(fn: () => Promise<unknown>) {
    try { await fn(); } catch (e) { this.log.warn(`notification failed: ${(e as Error).message}`); }
  }
}

export const present = (r: { id: string; title: string; body: string; data: Prisma.JsonValue; readAt: Date | null; createdAt: Date }) => {
  const d = (r.data ?? {}) as Record<string, unknown>;
  return { id: r.id, title: r.title, body: r.body, type: (d.type as string) ?? 'system', severity: (d.severity as string) ?? 'info', link: (d.link as string) ?? null, readAt: r.readAt, createdAt: r.createdAt };
};

const listQuery = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  type: z.enum(['operator', 'billing', 'hardware', 'security', 'system', 'announcement']).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** The signed-in user's own notifications (any user kind). */
@ApiTags('notifications')
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.NotificationWhereInput = {
      userId: u.userId,
      ...(q.filter === 'unread' ? { readAt: null } : {}),
      ...(q.type ? { data: { path: ['type'], equals: q.type } } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    };
    const rows = await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit + 1 });
    const items = rows.slice(0, q.limit).map(present);
    return { items, nextBefore: rows.length > q.limit ? items[items.length - 1].createdAt : null };
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { count: await this.prisma.notification.count({ where: { userId: u.userId, readAt: null } }) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { userId: u.userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('unread') unread?: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, userId: u.userId }, data: { readAt: unread === 'true' ? null : new Date() } });
    if (!r.count) throw NotFound('Notification');
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.notification.deleteMany({ where: { id, userId: u.userId } });
    if (!r.count) throw NotFound('Notification');
  }
}

const broadcastSchema = z.object({
  audience: z.enum(['all_operators', 'tenant', 'platform_admins']),
  tenantId: z.string().uuid().optional(),
  title: z.string().min(3).max(120),
  body: z.string().min(3).max(1000),
  severity: z.enum(['info', 'success', 'warning', 'critical']).default('info'),
  link: z.string().startsWith('/').max(300).optional(),
}).refine((b) => b.audience !== 'tenant' || !!b.tenantId, { message: 'tenantId is required for a single operator', path: ['tenantId'] });

@ApiTags('admin')
@Controller('v1/admin/notifications')
export class AdminNotificationsController {
  constructor(private notifications: NotificationsService, private prisma: PrismaService, private audit: AuditService) {}

  /** Announcement to operator owners/managers or to the platform team. */
  @Post('broadcast')
  @RequirePlatform(P.PLATFORM_TENANTS)
  async broadcast(@CurrentUser() u: AuthUser, @Body(new ZodPipe(broadcastSchema)) b: z.infer<typeof broadcastSchema>) {
    if (b.audience === 'tenant' && !(await this.prisma.tenant.count({ where: { id: b.tenantId } }))) throw NotFound('Tenant');
    const recipients = b.audience === 'platform_admins' ? await this.notifications.platformAdminIds()
      : await this.notifications.operatorAdminIds(b.audience === 'tenant' ? [b.tenantId!] : undefined);
    const sent = await this.notifications.notify(recipients, { title: b.title, body: b.body, type: 'announcement', severity: b.severity, link: b.link });
    await this.audit.log({ tenantId: b.tenantId ?? null, actorId: u.userId, actorKind: 'USER', action: 'notification.broadcast', entityType: 'Notification', after: { ...b, recipients: sent } });
    return { sent };
  }
}

@Global()
@Module({ providers: [NotificationsService], controllers: [NotificationsController, AdminNotificationsController], exports: [NotificationsService] })
export class NotificationsModule {}
