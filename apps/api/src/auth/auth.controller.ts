import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { AuditService } from '../common/audit.service';
import { DomainError } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './context';

const meta = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const otpReq = z.object({ phone: z.string().min(10).max(16) });
const otpVerify = z.object({ phone: z.string().min(10).max(16), code: z.string().length(6) });
const pwLogin = z.object({ identifier: z.string().min(3).max(120), password: z.string().min(8).max(200) });
const refresh = z.object({ refreshToken: z.string().min(20) });
const profile = z.object({ name: z.string().trim().min(2).max(80) });
const changePw = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) });

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private prisma: PrismaService,
    private audit: AuditService,
    private settings: SettingsService,
    private notifications: NotificationsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodPipe(otpReq)) b: z.infer<typeof otpReq>, @Req() req: any) {
    return this.auth.requestOtp(b.phone, req.ip);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body(new ZodPipe(otpVerify)) b: z.infer<typeof otpVerify>, @Req() req: any) {
    return this.auth.verifyOtp(b.phone, b.code, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(pwLogin)) b: z.infer<typeof pwLogin>, @Req() req: any) {
    return this.auth.passwordLogin(b.identifier, b.password, meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refresh)) b: z.infer<typeof refresh>, @Req() req: any) {
    return this.auth.refresh(b.refreshToken, meta(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() u: AuthUser) {
    await this.auth.logout(u.sessionId);
  }

  /** Who am I + which tenants/roles I can act in (drives portal routing and facility switcher). */
  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: u.userId },
      select: {
        id: true, kind: true, phone: true, email: true, name: true, profileComplete: true, lastLoginAt: true, createdAt: true,
        roles: { select: { role: { select: { key: true, name: true } } } },
        memberships: {
          where: { active: true },
          select: { tenantId: true, facilityIds: true, tenant: { select: { name: true, slug: true, status: true } }, role: { select: { key: true, name: true } } },
        },
      },
    });
    return {
      ...user,
      platformRoles: user.roles.map((r) => r.role.key),
      roles: undefined,
    };
  }

  @Patch('me')
  async updateMe(@CurrentUser() u: AuthUser, @Body(new ZodPipe(profile)) b: z.infer<typeof profile>) {
    const user = await this.prisma.user.update({ where: { id: u.userId }, data: { name: b.name }, select: { id: true, name: true } });
    await this.audit.log({ actorId: u.userId, actorKind: 'USER', action: 'user.profile', entityType: 'User', entityId: u.userId, after: b });
    return user;
  }

  /** Change own password; signs out every other session of this user. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() u: AuthUser, @Body(new ZodPipe(changePw)) b: z.infer<typeof changePw>, @Req() req: any) {
    const { passwordMinLength } = await this.settings.get('security');
    if (b.newPassword.length < passwordMinLength) throw new DomainError('WEAK_PASSWORD', `Use at least ${passwordMinLength} characters`, 400);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    if (!user.passwordHash || !(await argon2.verify(user.passwordHash, b.currentPassword))) throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);
    if (b.currentPassword === b.newPassword) throw new DomainError('VALIDATION', 'Choose a password you have not just used', 400);
    // Refresh rotation creates a new session row per refresh within one family; keep only this sign-in's family.
    const current = await this.prisma.userSession.findUnique({ where: { id: u.sessionId }, select: { familyId: true } });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: u.userId }, data: { passwordHash: await argon2.hash(b.newPassword) } }),
      this.prisma.userSession.updateMany({ where: { userId: u.userId, revokedAt: null, ...(current ? { familyId: { not: current.familyId } } : {}) }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: u.userId, actorKind: 'USER', action: 'user.password_changed', entityType: 'User', entityId: u.userId, ip: req.ip });
    await this.notifications.safe(() => this.notifications.notify([u.userId], { title: 'Password changed', body: 'Your password was changed and your other sessions were signed out. If this was not you, contact support.', type: 'security', severity: 'warning' }));
    return { ok: true };
  }

  /** Active sign-ins of this user (for the profile drawer). */
  @Get('sessions')
  async sessions(@CurrentUser() u: AuthUser) {
    const current = await this.prisma.userSession.findUnique({ where: { id: u.sessionId }, select: { familyId: true } });
    const rows = await this.prisma.userSession.findMany({ where: { userId: u.userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, familyId: true, ip: true, userAgent: true, createdAt: true } });
    return rows.map(({ familyId, ...r }) => ({ ...r, current: familyId === current?.familyId }));
  }
}
