import { Global, Injectable, Module } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export type EntitlementKey = 'maxFacilities' | 'maxGates' | 'maxStaff' | 'monthlySessions' | 'feature.anpr' | 'feature.corporate' | 'feature.api' | 'feature.advancedReports';

/** SaaS plan limits. -1 = unlimited. Missing entitlement on a plan = not included (0). */
@Injectable()
export class EntitlementService {
  constructor(private prisma: PrismaService) {}

  async limits(tenantId: string): Promise<Record<string, number>> {
    const sub = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      orderBy: { createdAt: 'desc' },
      include: { plan: { include: { entitlements: true } } },
    });
    if (!sub) return {};
    return Object.fromEntries(sub.plan.entitlements.map((e) => [e.key, e.value]));
  }

  async assertWithin(tenantId: string, key: EntitlementKey, current: () => Promise<number>) {
    const limits = await this.limits(tenantId);
    if (!(key in limits)) throw new DomainError('NO_ACTIVE_SUBSCRIPTION', 'An active subscription that includes this feature is required', 402, { key });
    const limit = limits[key];
    if (limit === -1) return;
    const used = await current();
    if (used >= limit) throw new DomainError('PLAN_LIMIT_REACHED', `Your plan allows ${limit} (${key}). Upgrade to add more.`, 402, { key, limit, used });
  }

  async hasFeature(tenantId: string, key: EntitlementKey) {
    const limits = await this.limits(tenantId);
    return (limits[key] ?? 0) !== 0;
  }
}

@Global()
@Module({ providers: [EntitlementService], exports: [EntitlementService] })
export class EntitlementModule {}
