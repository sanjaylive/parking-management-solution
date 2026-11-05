import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';
import { env, sandboxAllowed } from '../config/env';
import { hmacSha256, randomToken, safeEqualHex, sha256 } from '../common/crypto';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 30_000;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_PER_IP_PER_HOUR = 20;

export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/** Dev-only sender. env() refuses OTP_PROVIDER=console in production. */
export class ConsoleOtpSender implements OtpSender {
  private log = new Logger('OTP');
  async send(phone: string, code: string) {
    this.log.warn(`[DEV ONLY] OTP for ${phone.slice(0, -4).replace(/\d/g, '•')}${phone.slice(-4)}: ${code}`);
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private sender: OtpSender = new ConsoleOtpSender();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  static normalizePhone(raw: string): string {
    const digits = raw.replace(/[^\d+]/g, '');
    if (/^\+\d{10,15}$/.test(digits)) return digits;
    if (/^\d{10}$/.test(digits)) return '+91' + digits; // default India
    throw new DomainError('INVALID_PHONE', 'Enter a valid mobile number', 400);
  }

  private hashOtp(phone: string, code: string) {
    return hmacSha256(env().JWT_REFRESH_SECRET, `${phone}:${code}`);
  }

  async requestOtp(rawPhone: string, ip?: string): Promise<{ sentTo: string; expiresIn: number; devCode?: string }> {
    const phone = AuthService.normalizePhone(rawPhone);
    const hourAgo = new Date(Date.now() - 3600_000);
    const [recent, ipCount] = await Promise.all([
      this.prisma.otpChallenge.findMany({ where: { phone, createdAt: { gte: hourAgo } }, orderBy: { createdAt: 'desc' } }),
      ip ? this.prisma.otpChallenge.count({ where: { ip, createdAt: { gte: hourAgo } } }) : Promise.resolve(0),
    ]);
    if (recent.length >= OTP_MAX_PER_HOUR || ipCount >= OTP_MAX_PER_IP_PER_HOUR)
      throw new DomainError('OTP_RATE_LIMITED', 'Too many OTP requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_COOLDOWN_MS)
      throw new DomainError('OTP_COOLDOWN', 'Please wait before requesting another OTP.', HttpStatus.TOO_MANY_REQUESTS, {
        retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - recent[0].createdAt.getTime())) / 1000),
      });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: { phone, codeHash: this.hashOtp(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), ip },
    });
    await this.sender.send(phone, code);
    const exposeDev = env().OTP_PROVIDER === 'console' && sandboxAllowed();
    return { sentTo: phone.slice(0, 3) + '******' + phone.slice(-4), expiresIn: OTP_TTL_MS / 1000, ...(exposeDev ? { devCode: code } : {}) };
  }

  async verifyOtp(rawPhone: string, code: string, meta: { ip?: string; userAgent?: string }) {
    const phone = AuthService.normalizePhone(rawPhone);
    const ch = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ch) throw new DomainError('OTP_INVALID', 'OTP expired or not requested', 400);
    if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError('OTP_LOCKED', 'Too many attempts. Request a new OTP.', 429);

    // Atomic attempt increment guards against parallel brute force.
    const inc = await this.prisma.otpChallenge.updateMany({
      where: { id: ch.id, attempts: { lt: OTP_MAX_ATTEMPTS }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    if (inc.count === 0) throw new DomainError('OTP_LOCKED', 'Too many attempts. Request a new OTP.', 429);
    if (!/^\d{6}$/.test(code) || !safeEqualHex(this.hashOtp(phone, code), ch.codeHash))
      throw new DomainError('OTP_INVALID', 'Incorrect OTP', 400, { attemptsLeft: OTP_MAX_ATTEMPTS - ch.attempts - 1 });

    const consumed = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw new DomainError('OTP_INVALID', 'OTP already used', 400);

    let user = await this.prisma.user.findUnique({ where: { phone } });
    const isNewUser = !user;
    if (!user) user = await this.prisma.user.create({ data: { phone, kind: 'CUSTOMER' } });
    if (user.status !== 'ACTIVE') throw new DomainError('ACCOUNT_DISABLED', 'Account is not active', 403);

    const tokens = await this.issueTokens(user.id, user.kind, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...tokens, isNewUser, user: { id: user.id, phone: user.phone, name: user.name, profileComplete: user.profileComplete } };
  }

  /** Password login for staff/operator/admin web portals. */
  async passwordLogin(identifier: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const where = identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: AuthService.normalizePhone(identifier) };
    const user = await this.prisma.user.findUnique({ where });
    // Constant-ish work even when user missing.
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, password) : (await argon2.hash(password), false);
    if (!user || !ok) {
      await this.audit.log({ action: 'auth.login_failed', entityType: 'User', entityId: user?.id, actorKind: 'USER', ip: meta.ip });
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    }
    if (user.status !== 'ACTIVE') throw new DomainError('ACCOUNT_DISABLED', 'Account is not active', 403);
    const tokens = await this.issueTokens(user.id, user.kind, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...tokens, user: { id: user.id, email: user.email, name: user.name, kind: user.kind } };
  }

  async issueTokens(userId: string, kind: string, meta: { ip?: string; userAgent?: string }, familyId: string = randomUUID()): Promise<TokenPair> {
    const refreshToken = randomToken(48);
    const s = await this.prisma.userSession.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: sha256(refreshToken),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + env().JWT_REFRESH_TTL_SECONDS * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, kind, sid: s.id },
      { secret: env().JWT_ACCESS_SECRET, expiresIn: env().JWT_ACCESS_TTL_SECONDS },
    );
    return { accessToken, refreshToken: `${s.id}.${refreshToken}`, expiresIn: env().JWT_ACCESS_TTL_SECONDS };
  }

  /** Refresh-token rotation with reuse detection: replaying a rotated token revokes the whole family. */
  async refresh(presented: string, meta: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const [, raw] = presented.split('.');
    if (!raw) throw new DomainError('INVALID_REFRESH', 'Invalid refresh token', 401);
    const s = await this.prisma.userSession.findUnique({ where: { refreshTokenHash: sha256(raw) }, include: { user: true } });
    if (!s) throw new DomainError('INVALID_REFRESH', 'Invalid refresh token', 401);
    if (s.rotatedAt || s.revokedAt) {
      await this.prisma.userSession.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ action: 'auth.refresh_reuse_detected', entityType: 'UserSession', entityId: s.id, actorId: s.userId, actorKind: 'USER', ip: meta.ip });
      throw new DomainError('REFRESH_REUSED', 'Session invalidated. Please sign in again.', 401);
    }
    if (s.expiresAt < new Date() || s.user.status !== 'ACTIVE') throw new DomainError('INVALID_REFRESH', 'Session expired', 401);
    const rotated = await this.prisma.userSession.updateMany({ where: { id: s.id, rotatedAt: null }, data: { rotatedAt: new Date() } });
    if (rotated.count === 0) throw new DomainError('REFRESH_REUSED', 'Session invalidated. Please sign in again.', 401);
    return this.issueTokens(s.userId, s.user.kind, meta, s.familyId);
  }

  async logout(sessionId: string) {
    const s = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    if (s) await this.prisma.userSession.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
