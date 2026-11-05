import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { env } from '../config/env';
import { DomainError, Forbidden } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AuthUser, IS_PUBLIC, PERMS, PLATFORM_PERMS, TenantContext } from './context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard: authenticates JWT, then (if the route declares permissions) resolves
 * tenant membership + role permissions from the DB and attaches TenantContext.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = ctx.switchToHttp().getRequest();

    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing bearer token');
    }
    let payload: { sub: string; kind: AuthUser['kind']; sid: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), { secret: env().JWT_ACCESS_SECRET });
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
    const session = await this.prisma.userSession.findUnique({ where: { id: payload.sid }, select: { revokedAt: true } });
    if (!session || session.revokedAt) {
      if (isPublic) return true;
      throw new UnauthorizedException('Session revoked');
    }
    req.user = { userId: payload.sub, kind: payload.kind, sessionId: payload.sid } satisfies AuthUser;
    if (isPublic) return true;

    const platformPerms = this.reflector.getAllAndOverride<string[]>(PLATFORM_PERMS, targets);
    const perms = this.reflector.getAllAndOverride<string[]>(PERMS, targets);

    if (platformPerms?.length) {
      const granted = await this.platformPermissions(payload.sub);
      if (!platformPerms.every((p) => granted.has(p))) throw Forbidden('Platform permission required');
      req.platformPermissions = granted;
      return true;
    }

    if (perms?.length) {
      const tenantId = req.headers['x-tenant-id'];
      if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId))
        throw new DomainError('TENANT_REQUIRED', 'x-tenant-id header required', 400);
      req.tenant = await this.resolveTenant(payload.sub, tenantId);
      if (!perms.every((p) => req.tenant.can(p))) throw Forbidden('Missing permission: ' + perms.filter((p) => !req.tenant.can(p)).join(', '));
    }
    return true;
  }

  private async platformPermissions(userId: string): Promise<Set<string>> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    return new Set(roles.flatMap((r) => r.role.permissions.map((rp) => rp.permission.key)));
  }

  async resolveTenant(userId: string, tenantId: string): Promise<TenantContext> {
    const member = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { role: { include: { permissions: { include: { permission: true } } } }, tenant: { select: { status: true } } },
    });
    if (member?.active) {
      if (member.tenant.status === 'SUSPENDED' || member.tenant.status === 'CLOSED') throw new DomainError('TENANT_SUSPENDED', 'Operator account suspended', 403);
      const keys = new Set(member.role.permissions.map((rp) => rp.permission.key));
      return new TenantContext(userId, tenantId, keys, member.facilityIds.length ? member.facilityIds : null, false);
    }
    // Platform admins get controlled cross-tenant access (audited at the action level).
    const platform = await this.platformPermissions(userId);
    if (platform.has('platform.tenants.manage')) {
      const exists = await this.prisma.tenant.count({ where: { id: tenantId } });
      if (!exists) throw Forbidden('Not a member of this tenant');
      return new TenantContext(userId, tenantId, platform, null, true);
    }
    throw Forbidden('Not a member of this tenant');
  }
}
