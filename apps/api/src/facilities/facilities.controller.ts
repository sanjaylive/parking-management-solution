import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DeviceKind, Prisma, VehicleClass } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { OccupancyService } from '../occupancy/occupancy.service';
import { EntitlementService } from '../tenancy/entitlement.service';

const vehicleClass = z.nativeEnum(VehicleClass);

export const facilitySchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{2,8}$/, '2–8 uppercase letters/digits'),
  name: z.string().min(2).max(120),
  type: z.enum(['MALL', 'AIRPORT', 'RAILWAY', 'HOSPITAL', 'OFFICE', 'RESIDENTIAL', 'HOTEL', 'RESTAURANT', 'PUBLIC', 'EVENT', 'CORPORATE', 'GARAGE', 'OTHER']).default('PUBLIC'),
  occupancyMode: z.enum(['SLOT_BASED', 'CAPACITY_BASED']).default('CAPACITY_BASED'),
  timezone: z.string().default('Asia/Kolkata').refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Invalid timezone'),
  addressLine: z.string().min(3).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  open24h: z.boolean().default(true),
  covered: z.boolean().default(false),
  hasEv: z.boolean().default(false),
  hasValet: z.boolean().default(false),
  heightLimitCm: z.number().int().positive().optional(),
  reservable: z.boolean().default(true),
  isPublished: z.boolean().default(false),
  rules: z.string().max(2000).optional(),
  graceMinutes: z.number().int().min(0).max(120).default(10),
  anprConfidenceThreshold: z.number().min(0.5).max(1).default(0.9),
  failSafeBarrierPolicy: z.enum(['FAIL_CLOSED', 'FAIL_OPEN_EXIT_ONLY']).default('FAIL_CLOSED'),
  offlineMaxProvisionalEntries: z.number().int().min(0).max(1000).default(50),
  photos: z.array(z.string().url()).max(12).default([]),
  amenities: z.array(z.string()).default([]),
});
const facilityPatch = facilitySchema.partial().omit({ code: true });

const poolSchema = z.object({ vehicleClass, totalCapacity: z.number().int().min(0).max(100_000), reservableCapacity: z.number().int().min(0).default(0) });
const floorSchema = z.object({ name: z.string().min(1), level: z.number().int().min(-20).max(200) });
const zoneSchema = z.object({
  floorId: z.string().uuid().optional(), code: z.string().min(1).max(10), name: z.string().min(1), vehicleClasses: z.array(vehicleClass).min(1),
  isEv: z.boolean().default(false), isAccessible: z.boolean().default(false), isReservedOnly: z.boolean().default(false), isStaffOnly: z.boolean().default(false), isCorporate: z.boolean().default(false),
});
const slotsBulk = z.object({ zoneId: z.string().uuid(), prefix: z.string().max(6), count: z.number().int().min(1).max(500), startAt: z.number().int().min(1).default(1), vehicleClass, isEv: z.boolean().default(false), row: z.string().optional() });
const slotState = z.object({ state: z.enum(['AVAILABLE', 'BLOCKED', 'OUT_OF_SERVICE']), reason: z.string().min(3) });
const gateSchema = z.object({ code: z.string().min(1).max(10), name: z.string().min(1), direction: z.enum(['ENTRY', 'EXIT', 'BOTH']) });
const deviceSchema = z.object({ gateId: z.string().uuid().optional(), kind: z.nativeEnum(DeviceKind), vendor: z.string(), model: z.string().optional(), serial: z.string().optional(), adapter: z.string(), config: z.record(z.string(), z.unknown()).default({}) });

@ApiTags('facilities')
@Controller('v1/facilities')
export class FacilitiesController {
  constructor(
    private prisma: PrismaService,
    private occupancy: OccupancyService,
    private audit: AuditService,
    private entitlements: EntitlementService,
  ) {}

  private async own(t: TenantContext, id: string) {
    t.assertFacility(id);
    const f = await this.prisma.parkingFacility.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!f) throw NotFound('Facility');
    return f;
  }

  @Get()
  @RequirePerm(P.FACILITY_READ)
  async list(@Tenant() t: TenantContext, @Query('q') q?: string) {
    const facilities = await this.prisma.parkingFacility.findMany({
      where: { tenantId: t.tenantId, id: t.facilityIds ? { in: [...t.facilityIds] } : undefined, name: q ? { contains: q, mode: 'insensitive' } : undefined },
      orderBy: { name: 'asc' },
      include: { pools: true, _count: { select: { gates: true, slots: true } } },
    });
    return facilities.map((f) => {
      const total = f.pools.reduce((s, p) => s + p.totalCapacity, 0);
      const occupied = f.pools.reduce((s, p) => s + p.occupied, 0);
      return { ...f, capacity: { total, occupied, available: Math.max(0, total - occupied - f.pools.reduce((s, p) => s + p.blocked, 0)) } };
    });
  }

  @Post()
  @RequirePerm(P.FACILITY_MANAGE)
  async create(@Tenant() t: TenantContext, @Body(new ZodPipe(facilitySchema)) b: z.infer<typeof facilitySchema>) {
    await this.entitlements.assertWithin(t.tenantId, 'maxFacilities', () => this.prisma.parkingFacility.count({ where: { tenantId: t.tenantId } }));
    const { amenities, ...data } = b;
    const f = await this.prisma.parkingFacility.create({
      data: { ...data, tenantId: t.tenantId, anprConfidenceThreshold: new Prisma.Decimal(b.anprConfidenceThreshold), amenities: { create: amenities.map((k) => ({ key: k, label: k.replace(/_/g, ' ').toLowerCase() })) } },
    });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'facility.create', entityType: 'ParkingFacility', entityId: f.id, after: b });
    return f;
  }

  @Get(':id')
  @RequirePerm(P.FACILITY_READ)
  async get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(t, id);
    return this.prisma.parkingFacility.findUnique({
      where: { id },
      include: {
        pools: { orderBy: { vehicleClass: 'asc' } },
        floors: { orderBy: { level: 'asc' } },
        zones: { orderBy: { code: 'asc' }, include: { _count: { select: { slots: true } } } },
        gates: { orderBy: { code: 'asc' }, include: { devices: { select: { id: true, kind: true, status: true, vendor: true, lastSeenAt: true } } } },
        amenities: true,
      },
    });
  }

  @Patch(':id')
  @RequirePerm(P.FACILITY_MANAGE)
  async update(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(facilityPatch)) b: z.infer<typeof facilityPatch>) {
    const before = await this.own(t, id);
    const { amenities, anprConfidenceThreshold, ...data } = b;
    const f = await this.prisma.parkingFacility.update({
      where: { id },
      data: {
        ...data,
        ...(anprConfidenceThreshold !== undefined ? { anprConfidenceThreshold: new Prisma.Decimal(anprConfidenceThreshold) } : {}),
        ...(amenities ? { amenities: { deleteMany: {}, create: amenities.map((k) => ({ key: k, label: k.replace(/_/g, ' ').toLowerCase() })) } } : {}),
      },
    });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'facility.update', entityType: 'ParkingFacility', entityId: id, before, after: b });
    return f;
  }

  @Get(':id/occupancy')
  @RequirePerm(P.FACILITY_READ)
  async occupancyView(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(t, id);
    const [pools, slots, gates] = await Promise.all([
      this.occupancy.snapshot(id),
      this.prisma.parkingSlot.groupBy({ by: ['state'], where: { facilityId: id }, _count: true }),
      this.prisma.parkingGate.findMany({ where: { facilityId: id }, select: { id: true, code: true, name: true, direction: true, status: true, lastHeartbeatAt: true } }),
    ]);
    return { pools, slotStates: Object.fromEntries(slots.map((s) => [s.state, s._count])), gates };
  }

  @Post(':id/occupancy/reconcile')
  @RequirePerm(P.FACILITY_MANAGE)
  async reconcile(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(t, id);
    const r = await this.occupancy.reconcile(t.tenantId, id);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'occupancy.reconcile', entityType: 'ParkingFacility', entityId: id, after: r });
    return r;
  }

  @Post(':id/pools')
  @RequirePerm(P.FACILITY_MANAGE)
  async upsertPool(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(poolSchema)) b: z.infer<typeof poolSchema>) {
    await this.own(t, id);
    if (b.reservableCapacity > b.totalCapacity) throw new DomainError('INVALID_CAPACITY', 'Reservable capacity cannot exceed total', 400);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.parkingCapacityPool.findUnique({ where: { facilityId_vehicleClass: { facilityId: id, vehicleClass: b.vehicleClass } } });
      if (existing) {
        await this.occupancy.lockPool(tx, id, b.vehicleClass);
        if (existing.occupied + existing.blocked > b.totalCapacity) throw new DomainError('CAPACITY_BELOW_OCCUPANCY', 'Capacity cannot be below current occupancy', 409);
        return tx.parkingCapacityPool.update({ where: { id: existing.id }, data: { totalCapacity: b.totalCapacity, reservableCapacity: b.reservableCapacity } });
      }
      return tx.parkingCapacityPool.create({ data: { tenantId: t.tenantId, facilityId: id, ...b } });
    });
  }

  @Post(':id/floors')
  @RequirePerm(P.FACILITY_MANAGE)
  async addFloor(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(floorSchema)) b: z.infer<typeof floorSchema>) {
    await this.own(t, id);
    return this.prisma.parkingFloor.create({ data: { tenantId: t.tenantId, facilityId: id, ...b } });
  }

  @Post(':id/zones')
  @RequirePerm(P.FACILITY_MANAGE)
  async addZone(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(zoneSchema)) b: z.infer<typeof zoneSchema>) {
    await this.own(t, id);
    if (b.floorId && !(await this.prisma.parkingFloor.count({ where: { id: b.floorId, facilityId: id } }))) throw NotFound('Floor');
    return this.prisma.parkingZone.create({ data: { tenantId: t.tenantId, facilityId: id, ...b } });
  }

  /** Bulk-create numbered slots; capacity pool for the class is increased in the same transaction. */
  @Post(':id/slots/bulk')
  @RequirePerm(P.FACILITY_MANAGE)
  async addSlots(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(slotsBulk)) b: z.infer<typeof slotsBulk>) {
    await this.own(t, id);
    const zone = await this.prisma.parkingZone.findFirst({ where: { id: b.zoneId, facilityId: id } });
    if (!zone) throw NotFound('Zone');
    return this.prisma.$transaction(async (tx) => {
      const data = Array.from({ length: b.count }, (_, i) => ({
        tenantId: t.tenantId, facilityId: id, zoneId: zone.id, code: `${b.prefix}${String(b.startAt + i).padStart(3, '0')}`,
        row: b.row, position: b.startAt + i, vehicleClass: b.vehicleClass, isEv: b.isEv || zone.isEv, isAccessible: zone.isAccessible,
      }));
      const created = await tx.parkingSlot.createMany({ data });
      await tx.parkingCapacityPool.upsert({
        where: { facilityId_vehicleClass: { facilityId: id, vehicleClass: b.vehicleClass } },
        update: { totalCapacity: { increment: created.count } },
        create: { tenantId: t.tenantId, facilityId: id, vehicleClass: b.vehicleClass, totalCapacity: created.count },
      });
      return { created: created.count };
    });
  }

  @Get(':id/slots')
  @RequirePerm(P.FACILITY_READ)
  async slots(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Query('zoneId') zoneId?: string) {
    await this.own(t, id);
    return this.prisma.parkingSlot.findMany({
      where: { facilityId: id, zoneId: zoneId || undefined },
      orderBy: [{ zoneId: 'asc' }, { position: 'asc' }, { code: 'asc' }],
      select: {
        id: true, code: true, row: true, position: true, vehicleClass: true, state: true, isEv: true, isAccessible: true, zoneId: true,
        assignments: { where: { releasedAt: null }, select: { session: { select: { id: true, plateNormalized: true, entryAt: true } } } },
      },
    });
  }

  /** Block / unblock / mark out-of-service. Never touches OCCUPIED slots. Adjusts pool.blocked. */
  @Patch(':id/slots/:slotId/state')
  @RequirePerm(P.FACILITY_MANAGE)
  async setSlotState(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Param('slotId', ParseUUIDPipe) slotId: string, @Body(new ZodPipe(slotState)) b: z.infer<typeof slotState>) {
    await this.own(t, id);
    return this.prisma.$transaction(async (tx) => {
      const [slot] = await tx.$queryRaw<{ id: string; state: string; vehicleClass: VehicleClass }[]>`SELECT id, state, "vehicleClass" FROM "ParkingSlot" WHERE id = ${slotId}::uuid AND "facilityId" = ${id}::uuid FOR UPDATE`;
      if (!slot) throw NotFound('Slot');
      if (slot.state === 'OCCUPIED' || slot.state === 'HELD' || slot.state === 'RESERVED') throw new DomainError('SLOT_IN_USE', `Slot is ${slot.state}`, 409);
      const wasBlocked = slot.state === 'BLOCKED' || slot.state === 'OUT_OF_SERVICE';
      const willBlock = b.state !== 'AVAILABLE';
      const pool = await this.occupancy.lockPool(tx, id, slot.vehicleClass);
      if (willBlock && !wasBlocked) {
        if (pool.occupied + pool.blocked + 1 > pool.totalCapacity) throw new DomainError('CAPACITY_EXHAUSTED', 'Cannot block: all capacity is in use', 409);
        await tx.parkingCapacityPool.update({ where: { id: pool.id }, data: { blocked: { increment: 1 } } });
      } else if (!willBlock && wasBlocked && pool.blocked > 0) {
        await tx.parkingCapacityPool.update({ where: { id: pool.id }, data: { blocked: { decrement: 1 } } });
      }
      const updated = await tx.parkingSlot.update({ where: { id: slotId }, data: { state: b.state, version: { increment: 1 } } });
      await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'slot.state', entityType: 'ParkingSlot', entityId: slotId, before: { state: slot.state }, after: b }, tx);
      return updated;
    });
  }

  @Post(':id/gates')
  @RequirePerm(P.FACILITY_MANAGE)
  async addGate(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(gateSchema)) b: z.infer<typeof gateSchema>) {
    await this.own(t, id);
    await this.entitlements.assertWithin(t.tenantId, 'maxGates', () => this.prisma.parkingGate.count({ where: { tenantId: t.tenantId } }));
    return this.prisma.parkingGate.create({ data: { tenantId: t.tenantId, facilityId: id, ...b } });
  }

  @Post(':id/devices')
  @RequirePerm(P.HARDWARE_MANAGE)
  async addDevice(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(deviceSchema)) b: z.infer<typeof deviceSchema>) {
    await this.own(t, id);
    if (b.gateId && !(await this.prisma.parkingGate.count({ where: { id: b.gateId, facilityId: id } }))) throw NotFound('Gate');
    const d = await this.prisma.hardwareDevice.create({ data: { tenantId: t.tenantId, facilityId: id, ...b, config: b.config as Prisma.InputJsonValue } });
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'device.create', entityType: 'HardwareDevice', entityId: d.id, after: { ...b } });
    return d;
  }
}
