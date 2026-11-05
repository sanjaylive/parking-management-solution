import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Forbidden } from '../common/errors';
import type { PermissionKey } from './permissions';

export interface AuthUser {
  userId: string;
  kind: 'CUSTOMER' | 'STAFF' | 'PLATFORM';
  sessionId: string;
}

/** Resolved per request by PermissionGuard. Never built from request body. */
export class TenantContext {
  constructor(
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly permissions: ReadonlySet<string>,
    /** null = all facilities in tenant */
    public readonly facilityIds: readonly string[] | null,
    public readonly isPlatform: boolean,
  ) {}

  can(p: PermissionKey) {
    return this.permissions.has(p);
  }

  assertFacility(facilityId: string) {
    if (this.facilityIds && !this.facilityIds.includes(facilityId)) throw Forbidden('No access to this facility');
  }
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMS = 'perms';
/** Requires a tenant context (x-tenant-id header) and all listed permissions. */
export const RequirePerm = (...perms: PermissionKey[]) => SetMetadata(PERMS, perms);

export const PLATFORM_PERMS = 'platformPerms';
/** Requires a platform role granting these permissions. No tenant header needed. */
export const RequirePlatform = (...perms: PermissionKey[]) => SetMetadata(PLATFORM_PERMS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const t = ctx.switchToHttp().getRequest().tenant;
  if (!t) throw Forbidden('Tenant context required');
  return t;
});
