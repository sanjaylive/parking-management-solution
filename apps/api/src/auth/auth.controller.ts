import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './context';

const meta = (req: any) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const otpReq = z.object({ phone: z.string().min(10).max(16) });
const otpVerify = z.object({ phone: z.string().min(10).max(16), code: z.string().length(6) });
const pwLogin = z.object({ identifier: z.string().min(3).max(120), password: z.string().min(8).max(200) });
const refresh = z.object({ refreshToken: z.string().min(20) });

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private prisma: PrismaService,
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
        id: true, kind: true, phone: true, email: true, name: true, profileComplete: true,
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
}
