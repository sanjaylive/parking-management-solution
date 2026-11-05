import { Injectable } from '@nestjs/common';
import { Prisma, VehicleClass } from '@prisma/client';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { calculatePrice, parseRateDefinition, PriceInput, PriceResult, RateDefinitionInput } from './engine';

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  /** Latest PUBLISHED version effective at `at` for an active plan of this facility + class. */
  async resolveVersion(facilityId: string, vehicleClass: VehicleClass, at: Date, db: Tx | PrismaService = this.prisma) {
    const v = await db.parkingRateVersion.findFirst({
      where: { status: 'PUBLISHED', effectiveFrom: { lte: at }, ratePlan: { facilityId, vehicleClass, active: true } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
    if (!v) throw new DomainError('NO_RATE_CONFIGURED', `No published rate for ${vehicleClass} at this facility`, 422);
    return v;
  }

  async versionById(id: string, db: Tx | PrismaService = this.prisma) {
    const v = await db.parkingRateVersion.findUnique({ where: { id } });
    if (!v) throw NotFound('Rate version');
    return v;
  }

  price(definitionJson: Prisma.JsonValue, timezone: string, opts: Omit<PriceInput, 'definition' | 'timezone'>): PriceResult {
    return calculatePrice({ definition: parseRateDefinition(definitionJson), timezone, ...opts });
  }

  // ── Rate plan management ──

  async createPlan(tenantId: string, facilityId: string, data: { name: string; vehicleClass: VehicleClass }) {
    await this.prisma.parkingFacility.findFirstOrThrow({ where: { id: facilityId, tenantId } });
    return this.prisma.parkingRatePlan.create({ data: { tenantId, facilityId, ...data } });
  }

  async createDraftVersion(tenantId: string, ratePlanId: string, definition: RateDefinitionInput, effectiveFrom: Date) {
    parseRateDefinition(definition); // validate
    const plan = await this.prisma.parkingRatePlan.findFirst({ where: { id: ratePlanId, tenantId } });
    if (!plan) throw NotFound('Rate plan');
    const last = await this.prisma.parkingRateVersion.findFirst({ where: { ratePlanId }, orderBy: { version: 'desc' } });
    return this.prisma.parkingRateVersion.create({
      data: { tenantId, ratePlanId, version: (last?.version ?? 0) + 1, effectiveFrom, definition: definition as Prisma.InputJsonValue },
    });
  }

  /** Publishing is one-way; published definitions are immutable (sessions reference them by id). */
  async publish(tenantId: string, versionId: string, userId: string) {
    const v = await this.prisma.parkingRateVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!v) throw NotFound('Rate version');
    if (v.status !== 'DRAFT') throw new DomainError('RATE_NOT_DRAFT', 'Only drafts can be published', 409);
    return this.prisma.parkingRateVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: userId } });
  }
}
