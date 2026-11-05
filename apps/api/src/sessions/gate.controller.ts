import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, SessionStatus, VehicleClass } from '@prisma/client';
import { z } from 'zod';
import { IdempotencyService } from '../common/idempotency.service';
import { NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { GateService } from './gate.service';

export const credentialSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QR'), token: z.string().min(10).max(2000), plate: z.string().max(20).optional() }),
  z.object({ type: z.literal('PLATE_MANUAL'), plate: z.string().min(2).max(20) }),
  z.object({ type: z.literal('PLATE_ANPR'), plate: z.string().min(2).max(20) }),
  z.object({ type: z.literal('TICKET'), number: z.string().min(4).max(40) }),
]);

export const entrySchema = z.object({
  facilityId: z.string().uuid(),
  gateId: z.string().uuid().optional(),
  credential: credentialSchema,
  vehicleClass: z.nativeEnum(VehicleClass).optional(),
  photoKey: z.string().max(300).optional(),
  allowNonStandardPlate: z.boolean().optional(),
  valet: z.boolean().optional(),
});
export const exitSchema = z.object({
  facilityId: z.string().uuid(),
  gateId: z.string().uuid().optional(),
  credential: credentialSchema,
  lostTicket: z.boolean().optional(),
});
const cashSchema = z.object({ amountMinor: z.number().int().positive() });

@ApiTags('gate')
@Controller('v1/gate')
export class GateController {
  constructor(
    private gate: GateService,
    private idem: IdempotencyService,
  ) {}

  @Post('entry')
  @RequirePerm(P.SESSION_ENTRY)
  entry(@Tenant() t: TenantContext, @Body(new ZodPipe(entrySchema)) b: z.infer<typeof entrySchema>, @Headers('idempotency-key') key?: string) {
    t.assertFacility(b.facilityId);
    return this.idem.run(`${t.tenantId}:entry`, key, b, () => this.gate.entry({ tenantId: t.tenantId, userId: t.userId }, b));
  }

  @Post('exit/quote')
  @HttpCode(200)
  @RequirePerm(P.SESSION_EXIT)
  quote(@Tenant() t: TenantContext, @Body(new ZodPipe(exitSchema)) b: z.infer<typeof exitSchema>) {
    t.assertFacility(b.facilityId);
    return this.gate.exitQuote({ tenantId: t.tenantId, userId: t.userId }, b);
  }

  @Post('exit/confirm')
  @HttpCode(200)
  @RequirePerm(P.SESSION_EXIT)
  confirm(@Tenant() t: TenantContext, @Body(new ZodPipe(exitSchema)) b: z.infer<typeof exitSchema>, @Headers('idempotency-key') key?: string) {
    t.assertFacility(b.facilityId);
    return this.idem.run(`${t.tenantId}:exit`, key, b, () => this.gate.exitConfirm({ tenantId: t.tenantId, userId: t.userId }, b));
  }

  @Post('sessions/:id/cash')
  @RequirePerm(P.PAYMENT_COLLECT_CASH)
  cash(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cashSchema)) b: z.infer<typeof cashSchema>, @Headers('idempotency-key') key?: string) {
    return this.idem.run(`${t.tenantId}:cash`, key, { id, ...b }, () => this.gate.collectCash({ tenantId: t.tenantId, userId: t.userId }, id, b.amountMinor));
  }
}

@ApiTags('sessions')
@Controller('v1/sessions')
export class SessionsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePerm(P.SESSION_READ)
  async list(
    @Tenant() t: TenantContext,
    @Query('facilityId') facilityId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('active') active?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    if (facilityId) t.assertFacility(facilityId);
    const where: Prisma.ParkingSessionWhereInput = {
      tenantId: t.tenantId,
      facilityId: facilityId || (t.facilityIds ? { in: [...t.facilityIds] } : undefined),
      ...(active === 'true' ? { exitAt: null } : {}),
      status: active === 'true' ? { notIn: ['COMPLETED', 'CANCELLED'] } : status ? (status as SessionStatus) : undefined,
      plateNormalized: q ? { contains: q.toUpperCase().replace(/[^A-Z0-9]/g, '') } : undefined,
    };
    const take = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.parkingSession.findMany({
        where, orderBy: { entryAt: 'desc' }, take, skip,
        include: { facility: { select: { name: true, code: true } }, ticket: { select: { number: true } }, assignments: { where: { releasedAt: null }, select: { slot: { select: { code: true } } } } },
      }),
      this.prisma.parkingSession.count({ where }),
    ]);
    return { items, total, page: skip / take + 1, pageSize: take };
  }

  @Get(':id')
  @RequirePerm(P.SESSION_READ)
  async get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const s = await this.prisma.parkingSession.findFirst({
      where: { id, tenantId: t.tenantId },
      include: {
        facility: { select: { name: true, code: true, timezone: true } }, entry: true, exit: true, ticket: { select: { number: true, lost: true } },
        events: { orderBy: { at: 'asc' } }, feeCalculations: { orderBy: { calculatedAt: 'desc' }, take: 1 }, adjustments: true,
        assignments: { include: { slot: { select: { code: true } } } }, vehicle: true,
      },
    });
    if (!s) throw NotFound('Session');
    t.assertFacility(s.facilityId);
    const payments = await this.prisma.payment.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } });
    return { ...s, payments };
  }
}
