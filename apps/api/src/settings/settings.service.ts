import { Body, Controller, Get, Global, Injectable, Module, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { AuthUser, CurrentUser, Public, RequirePlatform } from '../auth/context';
import { P } from '../auth/permissions';
import { env, sandboxAllowed } from '../config/env';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #4f46e5');
const optUrl = z.union([z.string().url().max(500), z.literal('')]);

/**
 * Platform settings, one SystemSetting row per group. Each group has a schema and defaults, so reads always
 * return a complete object and old rows pick up new fields automatically.
 */
export const SETTING_GROUPS = {
  brand: z.object({
    platformName: z.string().min(2).max(60).default('Park2All'),
    tagline: z.string().max(120).default('Smart Mobility & Parking'),
    logoUrl: optUrl.default(''),
    primaryColor: hex.default('#2257ff'),
    accentColor: hex.default('#00b8d9'),
    supportEmail: z.union([z.string().email(), z.literal('')]).default(''),
    supportPhone: z.string().max(30).default(''),
    website: optUrl.default(''),
  }),
  operators: z.object({
    defaultPlanCode: z.string().min(2).max(40).default('STARTER'),
    defaultTrialDays: z.number().int().min(0).max(90).default(14),
  }),
  notifications: z.object({
    operatorOnboarded: z.boolean().default(true),
    operatorStatusChanged: z.boolean().default(true),
    hardwareAlerts: z.boolean().default(true),
    welcomeOwner: z.boolean().default(true),
  }),
  security: z.object({
    passwordMinLength: z.number().int().min(8).max(64).default(10),
  }),
} as const;
export type SettingGroup = keyof typeof SETTING_GROUPS;
export type Settings = { [K in SettingGroup]: z.infer<(typeof SETTING_GROUPS)[K]> };
const isGroup = (g: string): g is SettingGroup => g in SETTING_GROUPS;

@Injectable()
export class SettingsService {
  private cache?: { at: number; value: Settings };
  constructor(private prisma: PrismaService) {}

  async all(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: Object.keys(SETTING_GROUPS) } } });
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const value = Object.fromEntries(
      (Object.keys(SETTING_GROUPS) as SettingGroup[]).map((g) => {
        const parsed = SETTING_GROUPS[g].safeParse(stored[g] ?? {});
        return [g, parsed.success ? parsed.data : SETTING_GROUPS[g].parse({})];
      }),
    ) as Settings;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async get<G extends SettingGroup>(g: G): Promise<Settings[G]> {
    return (await this.all())[g];
  }

  async set<G extends SettingGroup>(g: G, value: Settings[G]) {
    await this.prisma.systemSetting.upsert({ where: { key: g }, update: { value: value as Prisma.InputJsonValue }, create: { key: g, value: value as Prisma.InputJsonValue } });
    this.cache = undefined;
    return this.get(g);
  }
}

@ApiTags('admin')
@Controller('v1/admin/settings')
export class AdminSettingsController {
  constructor(private settings: SettingsService, private audit: AuditService, private prisma: PrismaService) {}

  @Get()
  @RequirePlatform(P.PLATFORM_READ_ALL)
  all() {
    return this.settings.all();
  }

  /** Read-only facts about this deployment (configured through the server's environment, not the UI). */
  @Get('system')
  @RequirePlatform(P.PLATFORM_READ_ALL)
  async system() {
    const e = env();
    const [users, tenants] = await Promise.all([this.prisma.user.count(), this.prisma.tenant.count()]);
    return {
      release: process.env.RELEASE_SHA ?? 'dev', nodeVersion: process.version, environment: e.NODE_ENV, sandbox: sandboxAllowed(),
      otpProvider: e.OTP_PROVIDER, paymentProvider: e.PAYMENT_PROVIDER, publicUrl: process.env.PUBLIC_URL ?? null,
      uptimeSeconds: Math.round(process.uptime()), users, tenants,
    };
  }

  @Put(':group')
  @RequirePlatform(P.PLATFORM_SETTINGS)
  async update(@CurrentUser() u: AuthUser, @Param('group') group: string, @Body() body: unknown) {
    if (!isGroup(group)) throw new DomainError('NOT_FOUND', `Unknown settings group "${group}"`, 404);
    const value = new ZodPipe(SETTING_GROUPS[group] as z.ZodTypeAny).transform(body) as Settings[typeof group];
    if (group === 'operators') {
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { code: (value as Settings['operators']).defaultPlanCode } });
      if (!plan) throw new DomainError('VALIDATION', 'Default plan does not exist', 400);
    }
    const before = await this.settings.get(group);
    const after = await this.settings.set(group, value);
    await this.audit.log({ actorId: u.userId, actorKind: 'USER', action: `settings.${group}`, entityType: 'SystemSetting', entityId: group, before, after });
    return after;
  }
}

/** Brand details for login pages and public sites. */
@ApiTags('public')
@Controller('v1/public/brand')
export class PublicBrandController {
  constructor(private settings: SettingsService) {}
  @Public()
  @Get()
  brand() {
    return this.settings.get('brand');
  }
}

@Global()
@Module({ providers: [SettingsService], controllers: [AdminSettingsController, PublicBrandController], exports: [SettingsService] })
export class SettingsModule {}
