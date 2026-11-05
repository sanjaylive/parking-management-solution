import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VehicleClass } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { calculatePrice, parseRateDefinition, rateDefinitionSchema } from './engine';
import { PricingService } from './pricing.service';

const planSchema = z.object({ facilityId: z.string().uuid(), name: z.string().min(2), vehicleClass: z.nativeEnum(VehicleClass) });
const versionSchema = z.object({ definition: z.unknown(), effectiveFrom: z.coerce.date() });
const simulateSchema = z.object({ definition: z.unknown(), timezone: z.string().default('Asia/Kolkata'), entryAt: z.coerce.date(), exitAt: z.coerce.date(), lostTicket: z.boolean().optional(), ev: z.boolean().optional(), valet: z.boolean().optional() });

@ApiTags('rates')
@Controller('v1/rates')
export class RatesController {
  constructor(
    private pricing: PricingService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get('plans')
  @RequirePerm(P.FACILITY_READ)
  plans(@Tenant() t: TenantContext, @Query('facilityId') facilityId: string) {
    t.assertFacility(facilityId);
    return this.prisma.parkingRatePlan.findMany({ where: { tenantId: t.tenantId, facilityId }, include: { versions: { orderBy: { version: 'desc' } } }, orderBy: { vehicleClass: 'asc' } });
  }

  @Post('plans')
  @RequirePerm(P.RATES_MANAGE)
  createPlan(@Tenant() t: TenantContext, @Body(new ZodPipe(planSchema)) b: z.infer<typeof planSchema>) {
    t.assertFacility(b.facilityId);
    return this.pricing.createPlan(t.tenantId, b.facilityId, b);
  }

  @Post('plans/:id/versions')
  @RequirePerm(P.RATES_MANAGE)
  async draft(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(versionSchema)) b: z.infer<typeof versionSchema>) {
    const v = await this.pricing.createDraftVersion(t.tenantId, id, b.definition as any, b.effectiveFrom);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'rate.draft', entityType: 'ParkingRateVersion', entityId: v.id, after: b });
    return v;
  }

  @Post('versions/:id/publish')
  @RequirePerm(P.RATES_MANAGE)
  async publish(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const v = await this.pricing.publish(t.tenantId, id, t.userId);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'rate.publish', entityType: 'ParkingRateVersion', entityId: id });
    return v;
  }

  /** Try a definition against a hypothetical stay before publishing. */
  @Post('simulate')
  @RequirePerm(P.FACILITY_READ)
  simulate(@Body(new ZodPipe(simulateSchema)) b: z.infer<typeof simulateSchema>) {
    return calculatePrice({ ...b, definition: parseRateDefinition(b.definition) });
  }

  @Get('schema')
  @RequirePerm(P.FACILITY_READ)
  schema() {
    return z.toJSONSchema(rateDefinitionSchema, { io: 'input', unrepresentable: 'any' });
  }
}
