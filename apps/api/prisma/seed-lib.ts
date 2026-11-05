import { PrismaClient, VehicleClass } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_ROLES } from '../src/auth/permissions';

export const PLANS = [
  { code: 'STARTER', name: 'Starter', priceMonthlyMinor: 249900, priceYearlyMinor: 2499000, ent: { maxFacilities: 1, maxGates: 2, maxStaff: 5, monthlySessions: 5000, 'feature.anpr': 0, 'feature.corporate': 0, 'feature.api': 0, 'feature.advancedReports': 0 } },
  { code: 'GROWTH', name: 'Growth', priceMonthlyMinor: 799900, priceYearlyMinor: 7999000, ent: { maxFacilities: 5, maxGates: 15, maxStaff: 40, monthlySessions: 50000, 'feature.anpr': 1, 'feature.corporate': 0, 'feature.api': 0, 'feature.advancedReports': 1 } },
  { code: 'BUSINESS', name: 'Business', priceMonthlyMinor: 1999900, priceYearlyMinor: 19999000, ent: { maxFacilities: 25, maxGates: 100, maxStaff: 250, monthlySessions: 500000, 'feature.anpr': 1, 'feature.corporate': 1, 'feature.api': 1, 'feature.advancedReports': 1 } },
  { code: 'ENTERPRISE', name: 'Enterprise', priceMonthlyMinor: 0, priceYearlyMinor: 0, ent: { maxFacilities: -1, maxGates: -1, maxStaff: -1, monthlySessions: -1, 'feature.anpr': 1, 'feature.corporate': 1, 'feature.api': 1, 'feature.advancedReports': 1 } },
];

/** Idempotent: roles, permissions, plans, vehicle types. */
export async function seedBase(prisma: PrismaClient) {
  const allPerms = new Set(DEFAULT_ROLES.flatMap((r) => r.permissions));
  for (const key of allPerms) await prisma.permission.upsert({ where: { key }, update: {}, create: { key, name: key } });
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({ where: { key: r.key }, update: { name: r.name, scope: r.scope }, create: { key: r.key, name: r.name, scope: r.scope } });
    const perms = await prisma.permission.findMany({ where: { key: { in: r.permissions } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  }
  for (const p of PLANS) {
    const plan = await prisma.subscriptionPlan.upsert({ where: { code: p.code }, update: { name: p.name, priceMonthlyMinor: p.priceMonthlyMinor, priceYearlyMinor: p.priceYearlyMinor }, create: { code: p.code, name: p.name, priceMonthlyMinor: p.priceMonthlyMinor, priceYearlyMinor: p.priceYearlyMinor } });
    for (const [key, value] of Object.entries(p.ent)) await prisma.subscriptionEntitlement.upsert({ where: { planId_key: { planId: plan.id, key } }, update: { value }, create: { planId: plan.id, key, value } });
  }
  const types: [VehicleClass, string][] = [['TWO_WHEELER', 'Two-wheeler'], ['CAR', 'Car'], ['SUV', 'SUV'], ['LCV', 'Light commercial'], ['BUS', 'Bus'], ['TRUCK', 'Truck'], ['EV_CAR', 'Electric car'], ['EV_TWO_WHEELER', 'Electric two-wheeler']];
  for (const [vehicleClass, label] of types) await prisma.vehicleType.upsert({ where: { vehicleClass }, update: { label }, create: { vehicleClass, label } });
}

export async function ensureUser(prisma: PrismaClient, u: { email?: string; phone?: string; name: string; password?: string; kind: 'STAFF' | 'PLATFORM' | 'CUSTOMER' }) {
  const where = u.email ? { email: u.email } : { phone: u.phone! };
  const existing = await prisma.user.findUnique({ where });
  if (existing) return existing;
  return prisma.user.create({ data: { email: u.email, phone: u.phone, name: u.name, kind: u.kind, profileComplete: true, passwordHash: u.password ? await argon2.hash(u.password) : null } });
}

export const DEFAULT_RATE = {
  graceMinutes: 10,
  base: { unitMinutes: 60, amount: 40, firstUnitAmount: 50 },
  windows: [{ name: 'Evening peak', days: [1, 2, 3, 4, 5], from: '17:00', to: '21:00', multiplier: 1.25 }],
  overnight: { from: '23:00', to: '06:00', flat: 100 },
  dailyCap: 400,
  lostTicketFee: 300,
  evSurcharge: 50,
  valetFee: 150,
};

/** Creates an operator tenant with one facility, gates, simulator barriers, zones/slots and published rates. */
export async function seedOperator(
  prisma: PrismaClient,
  o: { slug: string; name: string; facilityCode: string; facilityName: string; lat: number; lng: number; ownerEmail: string; password: string; plan?: string; slotBased?: boolean; carCapacity?: number },
) {
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: o.plan ?? 'BUSINESS' } });
  const tenant = await prisma.tenant.upsert({ where: { slug: o.slug }, update: {}, create: { slug: o.slug, name: o.name, status: 'ACTIVE', contactEmail: o.ownerEmail } });
  if (!(await prisma.subscription.count({ where: { tenantId: tenant.id } })))
    await prisma.subscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86400_000) } });

  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const owner = await ensureUser(prisma, { email: o.ownerEmail, name: `${o.name} Owner`, password: o.password, kind: 'STAFF' });
  const local = o.ownerEmail.split('@');
  const staff = {
    owner,
    manager: await ensureUser(prisma, { email: `manager+${local[0]}@${local[1]}`, name: 'Facility Manager', password: o.password, kind: 'STAFF' }),
    supervisor: await ensureUser(prisma, { email: `supervisor+${local[0]}@${local[1]}`, name: 'Shift Supervisor', password: o.password, kind: 'STAFF' }),
    attendant: await ensureUser(prisma, { email: `gate+${local[0]}@${local[1]}`, name: 'Gate Attendant', password: o.password, kind: 'STAFF' }),
    cashier: await ensureUser(prisma, { email: `cashier+${local[0]}@${local[1]}`, name: 'Cashier', password: o.password, kind: 'STAFF' }),
  };
  const roleOf: Record<keyof typeof staff, string> = { owner: 'TENANT_OWNER', manager: 'FACILITY_MANAGER', supervisor: 'SUPERVISOR', attendant: 'GATE_ATTENDANT', cashier: 'CASHIER' };
  for (const [k, u] of Object.entries(staff)) {
    await prisma.tenantMember.upsert({ where: { tenantId_userId: { tenantId: tenant.id, userId: u.id } }, update: {}, create: { tenantId: tenant.id, userId: u.id, roleId: roles[roleOf[k as keyof typeof staff]] } });
  }

  let facility = await prisma.parkingFacility.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: o.facilityCode } } });
  if (!facility) {
    facility = await prisma.parkingFacility.create({
      data: {
        tenantId: tenant.id, code: o.facilityCode, name: o.facilityName, type: 'MALL', occupancyMode: o.slotBased ? 'SLOT_BASED' : 'CAPACITY_BASED',
        addressLine: `${o.facilityName}, Bengaluru`, latitude: o.lat, longitude: o.lng, covered: true, hasEv: true, hasValet: true, heightLimitCm: 210, isPublished: true,
        rules: 'Max speed 10 km/h. Keep your ticket safe. Lost ticket fee applies.', cancellationPolicy: { freeUntilMinutesBefore: 60, feePercent: 20 },
        amenities: { create: [{ key: 'CCTV', label: 'CCTV' }, { key: 'SECURITY_GUARD', label: '24×7 security' }, { key: 'EV_CHARGING', label: 'EV charging' }, { key: 'VALET', label: 'Valet' }, { key: 'COVERED', label: 'Covered' }] },
      },
    });
    const entry = await prisma.parkingGate.create({ data: { tenantId: tenant.id, facilityId: facility.id, code: 'G1', name: 'Main Entry', direction: 'ENTRY' } });
    const exit = await prisma.parkingGate.create({ data: { tenantId: tenant.id, facilityId: facility.id, code: 'G2', name: 'Main Exit', direction: 'EXIT' } });
    for (const g of [entry, exit]) {
      await prisma.hardwareDevice.create({ data: { tenantId: tenant.id, facilityId: facility.id, gateId: g.id, kind: 'BARRIER', vendor: 'simulator', adapter: 'simulator', config: { simulate: 'ok' }, status: 'ONLINE' } });
      await prisma.hardwareDevice.create({ data: { tenantId: tenant.id, facilityId: facility.id, gateId: g.id, kind: 'ANPR_CAMERA', vendor: 'simulator', adapter: 'simulator', status: 'ONLINE' } });
    }
    const carCap = o.carCapacity ?? 120;
    if (o.slotBased) {
      const floor = await prisma.parkingFloor.create({ data: { tenantId: tenant.id, facilityId: facility.id, name: 'Basement 1', level: -1 } });
      const zA = await prisma.parkingZone.create({ data: { tenantId: tenant.id, facilityId: facility.id, floorId: floor.id, code: 'A', name: 'Zone A', vehicleClasses: ['CAR', 'SUV'], layout: { cols: 10 } } });
      await prisma.parkingSlot.createMany({ data: Array.from({ length: carCap }, (_, i) => ({ tenantId: tenant.id, facilityId: facility!.id, zoneId: zA.id, code: `A${String(i + 1).padStart(3, '0')}`, position: i + 1, row: String.fromCharCode(65 + Math.floor(i / 10)), vehicleClass: 'CAR' as const })) });
    }
    await prisma.parkingCapacityPool.createMany({
      data: [
        { tenantId: tenant.id, facilityId: facility.id, vehicleClass: 'CAR', totalCapacity: carCap, reservableCapacity: Math.floor(carCap / 4) },
        { tenantId: tenant.id, facilityId: facility.id, vehicleClass: 'TWO_WHEELER', totalCapacity: 200, reservableCapacity: 20 },
        { tenantId: tenant.id, facilityId: facility.id, vehicleClass: 'EV_CAR', totalCapacity: 12, reservableCapacity: 6 },
      ],
    });
    for (const [vc, def] of [
      ['CAR', DEFAULT_RATE],
      ['TWO_WHEELER', { ...DEFAULT_RATE, base: { unitMinutes: 60, amount: 15, firstUnitAmount: 20 }, dailyCap: 150, overnight: { from: '23:00', to: '06:00', flat: 40 } }],
      ['EV_CAR', DEFAULT_RATE],
    ] as const) {
      const plan = await prisma.parkingRatePlan.create({ data: { tenantId: tenant.id, facilityId: facility.id, name: `${vc} standard`, vehicleClass: vc } });
      await prisma.parkingRateVersion.create({ data: { tenantId: tenant.id, ratePlanId: plan.id, version: 1, status: 'PUBLISHED', effectiveFrom: new Date('2020-01-01T00:00:00Z'), publishedAt: new Date(), definition: def as any } });
    }
  }
  const gates = await prisma.parkingGate.findMany({ where: { facilityId: facility.id }, orderBy: { code: 'asc' } });
  return { tenant, facility, staff, entryGate: gates.find((g) => g.direction !== 'EXIT')!, exitGate: gates.find((g) => g.direction !== 'ENTRY')! };
}
