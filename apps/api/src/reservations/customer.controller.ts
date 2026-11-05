import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, VehicleClass } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { signQr } from '../common/qr';
import { ZodPipe } from '../common/zod';
import { AuthUser, CurrentUser, Public } from '../auth/context';
import { PricingService } from '../pricing/pricing.service';
import { checkPlate, displayPlate } from '../vehicles/plate';
import { ReservationsService } from './reservations.service';
import { GateService } from '../sessions/gate.service';
import { PaymentsService } from '../payments/payments.service';

const profileSchema = z.object({ name: z.string().min(2).max(80), email: z.string().email().optional() });
const vehicleSchema = z.object({ plate: z.string().min(4).max(20), vehicleClass: z.nativeEnum(VehicleClass), make: z.string().max(40).optional(), model: z.string().max(40).optional(), color: z.string().max(20).optional(), nickname: z.string().max(30).optional(), country: z.string().length(2).default('IN') });
const reserveSchema = z.object({ facilityId: z.string().uuid(), vehicleId: z.string().uuid(), startsAt: z.coerce.date(), endsAt: z.coerce.date() });
const quoteSchema = z.object({ vehicleClass: z.nativeEnum(VehicleClass), startsAt: z.coerce.date(), endsAt: z.coerce.date() });
const searchSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), radiusKm: z.coerce.number().min(0.5).max(100).default(10),
  q: z.string().max(80).optional(), vehicleClass: z.nativeEnum(VehicleClass).optional(), ev: z.coerce.boolean().optional(), covered: z.coerce.boolean().optional(),
  valet: z.coerce.boolean().optional(), open24h: z.coerce.boolean().optional(), reservable: z.coerce.boolean().optional(), maxHeightCm: z.coerce.number().int().optional(),
  sort: z.enum(['distance', 'price', 'availability']).default('distance'), limit: z.coerce.number().int().min(1).max(50).default(20),
});

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

@ApiTags('customer')
@Controller('v1/me')
export class MeController {
  constructor(
    private prisma: PrismaService,
    private reservations: ReservationsService,
    private audit: AuditService,
    private gate: GateService,
    private payments: PaymentsService,
  ) {}

  /** A customer may act on a session only for a vehicle they own, and only for stays after they added it. */
  private async ownedSession(userId: string, sessionId: string) {
    const s = await this.prisma.parkingSession.findUnique({ where: { id: sessionId }, include: { ticket: { select: { number: true } } } });
    if (!s?.vehicleId) throw NotFound('Session');
    const owner = await this.prisma.vehicleOwner.findUnique({ where: { userId_vehicleId: { userId, vehicleId: s.vehicleId } } });
    // Visible if the stay began after the vehicle was added, or was still in progress at that moment
    // (driver adds their car while parked). A previous owner's finished stays stay hidden.
    if (!owner || (s.entryAt < owner.createdAt && s.exitAt !== null && s.exitAt < owner.createdAt)) throw NotFound('Session');
    return s;
  }

  @Get('sessions/:id/estimate')
  async estimate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.ownedSession(u.userId, id);
    return this.gate.estimate(id);
  }

  /**
   * Pay before driving out. Locks in the charge as of now (server-side quote); the exit gate honours it
   * for the facility's grace window. Returns a payment order — success comes only from the provider webhook.
   */
  @Post('sessions/:id/checkout')
  @HttpCode(200)
  async checkout(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const s = await this.ownedSession(u.userId, id);
    if (s.exitAt) throw new DomainError('SESSION_ALREADY_COMPLETED', 'Vehicle has already exited', 409);
    if (!s.ticket) throw new DomainError('NO_TICKET', 'Session has no ticket', 409);
    const quote = await this.gate.exitQuote({ tenantId: s.tenantId, userId: u.userId }, { facilityId: s.facilityId, credential: { type: 'TICKET', number: s.ticket.number } });
    const facility = await this.prisma.parkingFacility.findUniqueOrThrow({ where: { id: s.facilityId }, select: { graceMinutes: true } });
    if (quote.outstandingMinor === 0) return { status: 'EXIT_READY', quote, exitWithinMinutes: facility.graceMinutes };
    const order = await this.payments.createOrder({ purpose: 'PARKING_SESSION', sessionId: id, requester: { userId: u.userId } });
    return { status: 'PAYMENT_REQUIRED', quote, order, exitWithinMinutes: facility.graceMinutes };
  }

  @Patch('profile')
  async profile(@CurrentUser() u: AuthUser, @Body(new ZodPipe(profileSchema)) b: z.infer<typeof profileSchema>) {
    return this.prisma.user.update({ where: { id: u.userId }, data: { name: b.name, email: b.email?.toLowerCase(), profileComplete: true }, select: { id: true, name: true, email: true, phone: true, profileComplete: true } });
  }

  @Get('vehicles')
  vehicles(@CurrentUser() u: AuthUser) {
    return this.prisma.vehicleOwner.findMany({ where: { userId: u.userId }, include: { vehicle: true }, orderBy: { createdAt: 'asc' } });
  }

  @Post('vehicles')
  async addVehicle(@CurrentUser() u: AuthUser, @Body(new ZodPipe(vehicleSchema)) b: z.infer<typeof vehicleSchema>) {
    const c = checkPlate(b.plate, b.country);
    if (!c.valid) throw new DomainError('INVALID_PLATE', 'Enter a valid registration number', 400);
    const count = await this.prisma.vehicleOwner.count({ where: { userId: u.userId } });
    if (count >= 10) throw new DomainError('VEHICLE_LIMIT', 'You can save up to 10 vehicles', 422);
    const vehicle = await this.prisma.vehicle.upsert({
      where: { plateNormalized: c.normalized },
      update: { make: b.make, model: b.model, color: b.color },
      create: { plateNormalized: c.normalized, plateDisplay: displayPlate(c.normalized, b.country), country: b.country, vehicleClass: b.vehicleClass, make: b.make, model: b.model, color: b.color, isEv: b.vehicleClass.startsWith('EV_') },
    });
    return this.prisma.vehicleOwner.upsert({
      where: { userId_vehicleId: { userId: u.userId, vehicleId: vehicle.id } },
      update: { nickname: b.nickname },
      create: { userId: u.userId, vehicleId: vehicle.id, nickname: b.nickname, isDefault: count === 0 },
      include: { vehicle: true },
    });
  }

  @Delete('vehicles/:id')
  @HttpCode(204)
  async removeVehicle(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.vehicleOwner.deleteMany({ where: { userId: u.userId, vehicleId: id } });
  }

  @Get('reservations')
  async myReservations(@CurrentUser() u: AuthUser, @Query('scope') scope: 'upcoming' | 'past' = 'upcoming') {
    const now = new Date();
    const rs = await this.prisma.parkingReservation.findMany({
      where: { userId: u.userId, ...(scope === 'upcoming' ? { endsAt: { gte: now }, status: { in: ['HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'] } } : { OR: [{ endsAt: { lt: now } }, { status: { in: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'] } }] }) },
      include: { facility: { select: { name: true, addressLine: true, latitude: true, longitude: true } }, vehicle: { select: { plateDisplay: true } } },
      orderBy: { startsAt: scope === 'upcoming' ? 'asc' : 'desc' },
      take: 50,
    });
    return rs.map((r) => ({ ...this.reservations.present(r, r.facility.name), facility: r.facility, vehicle: r.vehicle }));
  }

  @Post('reservations')
  reserve(@CurrentUser() u: AuthUser, @Body(new ZodPipe(reserveSchema)) b: z.infer<typeof reserveSchema>) {
    return this.reservations.create(u.userId, b);
  }

  @Get('reservations/:id')
  async reservation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.parkingReservation.findFirst({ where: { id, userId: u.userId }, include: { facility: true, vehicle: true, priceSnapshot: true, history: { orderBy: { at: 'asc' } } } });
    if (!r) throw NotFound('Reservation');
    return { ...this.reservations.present(r, r.facility.name), facility: r.facility, vehicle: r.vehicle, priceSnapshot: r.priceSnapshot, history: r.history };
  }

  @Post('reservations/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.cancel(u.userId, id);
  }

  /** Customer's active + past sessions across all operators (only vehicles they own). */
  @Get('sessions')
  async sessions(@CurrentUser() u: AuthUser, @Query('active') active?: string) {
    const owned = await this.prisma.vehicleOwner.findMany({ where: { userId: u.userId }, select: { vehicleId: true, createdAt: true } });
    if (!owned.length) return [];
    const sessions = await this.prisma.parkingSession.findMany({
      // Only stays after the user added the vehicle, or in progress then — hides a previous owner's history.
      where: { OR: owned.flatMap((o) => [{ vehicleId: o.vehicleId, entryAt: { gte: o.createdAt } }, { vehicleId: o.vehicleId, OR: [{ exitAt: null }, { exitAt: { gte: o.createdAt } }] }]), ...(active === 'true' ? { exitAt: null } : {}), status: active === 'true' ? { notIn: ['COMPLETED', 'CANCELLED'] } : undefined },
      include: { facility: { select: { name: true, addressLine: true, timezone: true } }, ticket: { select: { number: true, qrToken: true } }, assignments: { where: { releasedAt: null }, include: { slot: { select: { code: true } } } } },
      orderBy: { entryAt: 'desc' },
      take: 50,
    });
    return sessions.map((s) => ({ ...s, elapsedMinutes: Math.ceil(((s.exitAt ?? new Date()).getTime() - s.entryAt.getTime()) / 60000) }));
  }

  @Get('passes')
  async passes(@CurrentUser() u: AuthUser) {
    const passes = await this.prisma.parkingPass.findMany({ where: { userId: u.userId }, include: { plan: true, vehicles: { include: { vehicle: true } } }, orderBy: { createdAt: 'desc' } });
    return passes.map((p) => ({ ...p, qrToken: p.status === 'ACTIVE' ? signQr({ k: 'P', id: p.id, exp: Math.floor(p.validUntil.getTime() / 1000) }) : null }));
  }

  /** Right-to-erasure: account flagged; worker anonymises after retention checks (financial records kept per law). */
  @Post('delete-account')
  @HttpCode(202)
  async deleteAccount(@CurrentUser() u: AuthUser) {
    await this.prisma.user.update({ where: { id: u.userId }, data: { status: 'DELETION_REQUESTED' } });
    await this.prisma.userSession.updateMany({ where: { userId: u.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: u.userId, actorKind: 'USER', action: 'account.deletion_requested', entityType: 'User', entityId: u.userId });
    return { status: 'DELETION_REQUESTED' };
  }
}

@ApiTags('public')
@Controller('v1/public')
export class PublicController {
  constructor(
    private prisma: PrismaService,
    private reservations: ReservationsService,
    private pricing: PricingService,
  ) {}

  @Public()
  @Get('facilities')
  async search(@Query(new ZodPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    const where: Prisma.ParkingFacilityWhereInput = {
      isPublished: true,
      tenant: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
      hasEv: q.ev || undefined, covered: q.covered || undefined, hasValet: q.valet || undefined, open24h: q.open24h || undefined, reservable: q.reservable || undefined,
      OR: q.maxHeightCm ? [{ heightLimitCm: null }, { heightLimitCm: { gte: q.maxHeightCm } }] : undefined,
      name: q.q ? { contains: q.q, mode: 'insensitive' } : undefined,
      pools: q.vehicleClass ? { some: { vehicleClass: q.vehicleClass } } : undefined,
    };
    if (q.lat != null && q.lng != null) {
      const dLat = q.radiusKm / 111;
      const dLng = q.radiusKm / (111 * Math.max(0.1, Math.cos((q.lat * Math.PI) / 180)));
      where.latitude = { gte: q.lat - dLat, lte: q.lat + dLat };
      where.longitude = { gte: q.lng - dLng, lte: q.lng + dLng };
    }
    const rows = await this.prisma.parkingFacility.findMany({ where, take: 200, include: { pools: true, amenities: true } });
    const now = new Date();
    const out = await Promise.all(
      rows.map(async (f) => {
        const pools = q.vehicleClass ? f.pools.filter((p) => p.vehicleClass === q.vehicleClass) : f.pools;
        const available = pools.reduce((s, p) => s + Math.max(0, p.totalCapacity - p.occupied - p.blocked), 0);
        const total = pools.reduce((s, p) => s + p.totalCapacity, 0);
        let hourlyMinor: number | null = null;
        try {
          const v = await this.pricing.resolveVersion(f.id, q.vehicleClass ?? pools[0]?.vehicleClass ?? 'CAR', now);
          hourlyMinor = this.pricing.price(v.definition, f.timezone, { entryAt: now, exitAt: new Date(now.getTime() + 3600_000) }).netMinor;
        } catch {
          /* no rate */
        }
        const distanceKm = q.lat != null && q.lng != null ? haversineKm({ lat: q.lat, lng: q.lng }, { lat: Number(f.latitude), lng: Number(f.longitude) }) : null;
        return {
          id: f.id, name: f.name, type: f.type, addressLine: f.addressLine, latitude: Number(f.latitude), longitude: Number(f.longitude), photos: f.photos,
          covered: f.covered, hasEv: f.hasEv, hasValet: f.hasValet, open24h: f.open24h, reservable: f.reservable, heightLimitCm: f.heightLimitCm,
          amenities: f.amenities.map((a) => a.key), available, total, hourlyMinor, distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
        };
      }),
    );
    const filtered = out.filter((f) => f.distanceKm == null || f.distanceKm <= q.radiusKm);
    filtered.sort((a, b) =>
      q.sort === 'price' ? (a.hourlyMinor ?? 1e12) - (b.hourlyMinor ?? 1e12) : q.sort === 'availability' ? b.available - a.available : (a.distanceKm ?? 0) - (b.distanceKm ?? 0),
    );
    return filtered.slice(0, q.limit);
  }

  @Public()
  @Get('facilities/:id')
  async facility(@Param('id', ParseUUIDPipe) id: string) {
    const f = await this.prisma.parkingFacility.findFirst({
      where: { id, isPublished: true },
      include: {
        pools: { select: { vehicleClass: true, totalCapacity: true, occupied: true, blocked: true } },
        amenities: { select: { key: true, label: true } },
        gates: { select: { code: true, name: true, direction: true } },
        reviews: { take: 10, orderBy: { createdAt: 'desc' }, select: { rating: true, comment: true, createdAt: true } },
        ratePlans: { where: { active: true }, select: { vehicleClass: true, name: true, versions: { where: { status: 'PUBLISHED', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { definition: true } } } },
        tenant: { select: { name: true } },
      },
    });
    if (!f) throw NotFound('Facility');
    const rating = await this.prisma.facilityReview.aggregate({ where: { facilityId: id }, _avg: { rating: true }, _count: true });
    return {
      ...f,
      operator: f.tenant.name,
      tenant: undefined,
      tenantId: undefined,
      pools: f.pools.map((p) => ({ vehicleClass: p.vehicleClass, total: p.totalCapacity, available: Math.max(0, p.totalCapacity - p.occupied - p.blocked) })),
      rates: f.ratePlans.map((rp) => ({ vehicleClass: rp.vehicleClass, name: rp.name, definition: rp.versions[0]?.definition ?? null })),
      ratePlans: undefined,
      rating: { average: rating._avg.rating, count: rating._count },
    };
  }

  @Public()
  @Post('facilities/:id/quote')
  @HttpCode(200)
  quote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(quoteSchema)) b: z.infer<typeof quoteSchema>) {
    return this.reservations.quote(id, b.vehicleClass, b.startsAt, b.endsAt);
  }
}
