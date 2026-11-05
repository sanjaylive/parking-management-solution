import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, VehicleClass } from '@prisma/client';
import { env } from '../config/env';
import { AuditService } from '../common/audit.service';
import { humanCode } from '../common/crypto';
import { DomainError, Forbidden, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { signQr } from '../common/qr';
import { OccupancyService } from '../occupancy/occupancy.service';
import { PricingService } from '../pricing/pricing.service';

const MIN_DURATION_MIN = 30;
const MAX_DURATION_DAYS = 30;
const MAX_ADVANCE_DAYS = 90;

@Injectable()
export class ReservationsService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Reservations');
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private occupancy: OccupancyService,
    private audit: AuditService,
  ) {}

  onModuleInit() {
    // Lightweight in-process sweeper. In production the background-worker runs the same method via BullMQ repeatable job.
    if (env().NODE_ENV !== 'test') this.timer = setInterval(() => this.sweep().catch((e) => this.log.error(e)), 60_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private validateWindow(startsAt: Date, endsAt: Date) {
    const now = Date.now();
    if (startsAt.getTime() < now - 5 * 60_000) throw new DomainError('START_IN_PAST', 'Start time is in the past', 400);
    if (startsAt.getTime() > now + MAX_ADVANCE_DAYS * 86400_000) throw new DomainError('TOO_FAR_AHEAD', `Bookings open ${MAX_ADVANCE_DAYS} days ahead`, 400);
    const mins = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (mins < MIN_DURATION_MIN) throw new DomainError('DURATION_TOO_SHORT', `Minimum booking is ${MIN_DURATION_MIN} minutes`, 400);
    if (mins > MAX_DURATION_DAYS * 1440) throw new DomainError('DURATION_TOO_LONG', 'Booking too long; consider a pass', 400);
  }

  async quote(facilityId: string, vehicleClass: VehicleClass, startsAt: Date, endsAt: Date) {
    this.validateWindow(startsAt, endsAt);
    const f = await this.prisma.parkingFacility.findFirst({ where: { id: facilityId, isPublished: true } });
    if (!f) throw NotFound('Facility');
    if (!f.reservable) throw new DomainError('NOT_RESERVABLE', 'This facility does not accept advance bookings', 422);
    const v = await this.pricing.resolveVersion(f.id, vehicleClass, startsAt);
    const price = this.pricing.price(v.definition, f.timezone, { entryAt: startsAt, exitAt: endsAt, ev: vehicleClass.startsWith('EV_') });
    const pool = await this.prisma.parkingCapacityPool.findUnique({ where: { facilityId_vehicleClass: { facilityId, vehicleClass } } });
    const overlapping = await this.prisma.parkingReservation.count({
      where: { facilityId, vehicleClass, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, OR: [{ status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_PAYMENT'] } }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] },
    });
    const limit = pool ? Math.min(pool.reservableCapacity, pool.totalCapacity - pool.blocked) : 0;
    return { facilityId, vehicleClass, startsAt, endsAt, rateVersionId: v.id, available: Math.max(0, limit - overlapping), ...price };
  }

  async create(userId: string, b: { facilityId: string; vehicleId: string; startsAt: Date; endsAt: Date }) {
    this.validateWindow(b.startsAt, b.endsAt);
    const owner = await this.prisma.vehicleOwner.findUnique({ where: { userId_vehicleId: { userId, vehicleId: b.vehicleId } }, include: { vehicle: true } });
    if (!owner) throw Forbidden('Vehicle is not in your garage');
    const vehicleClass = owner.vehicle.vehicleClass;

    return this.prisma.$transaction(async (tx) => {
      const f = await tx.parkingFacility.findFirst({ where: { id: b.facilityId, isPublished: true, reservable: true } });
      if (!f) throw NotFound('Facility');
      const dup = await tx.parkingReservation.findFirst({
        where: { vehicleId: b.vehicleId, facilityId: f.id, startsAt: { lt: b.endsAt }, endsAt: { gt: b.startsAt }, OR: [{ status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'CHECKED_IN'] } }, { status: 'HELD', holdExpiresAt: { gt: new Date() } }] },
      });
      if (dup) throw new DomainError('OVERLAPPING_RESERVATION', 'This vehicle already has a booking for that time', 409, { reservationId: dup.id });
      await this.occupancy.assertReservable(tx, { facilityId: f.id, vehicleClass, startsAt: b.startsAt, endsAt: b.endsAt });
      const v = await this.pricing.resolveVersion(f.id, vehicleClass, b.startsAt, tx);
      const price = this.pricing.price(v.definition, f.timezone, { entryAt: b.startsAt, exitAt: b.endsAt, ev: vehicleClass.startsWith('EV_') });
      const r = await tx.parkingReservation.create({
        data: {
          tenantId: f.tenantId, facilityId: f.id, userId, vehicleId: b.vehicleId, vehicleClass, code: `P2A-${humanCode(6)}`,
          status: price.netMinor > 0 ? 'HELD' : 'CONFIRMED', startsAt: b.startsAt, endsAt: b.endsAt,
          holdExpiresAt: price.netMinor > 0 ? new Date(Date.now() + f.reservationHoldMinutes * 60_000) : null, amountMinor: price.netMinor,
          priceSnapshot: { create: { rateVersionId: v.id, breakdown: price as unknown as Prisma.InputJsonValue, totalMinor: price.netMinor } },
          history: { create: { to: price.netMinor > 0 ? 'HELD' : 'CONFIRMED', actorId: userId } },
        },
      });
      return this.present(r, f.name);
    });
  }

  present(r: Prisma.ParkingReservationGetPayload<{}>, facilityName?: string) {
    const showQr = r.status === 'CONFIRMED' || r.status === 'CHECKED_IN';
    return {
      ...r,
      facilityName,
      qrToken: showQr ? signQr({ k: 'R', id: r.id, exp: Math.floor(r.endsAt.getTime() / 1000) }) : null,
    };
  }

  async cancel(userId: string, id: string, reason = 'Customer cancelled') {
    const r = await this.prisma.parkingReservation.findUnique({ where: { id }, include: { facility: true } });
    if (!r || r.userId !== userId) throw NotFound('Reservation');
    if (!['HELD', 'PENDING_PAYMENT', 'CONFIRMED'].includes(r.status)) throw new DomainError('NOT_CANCELLABLE', `Reservation is ${r.status}`, 409);
    const policy = (r.facility.cancellationPolicy as { freeUntilMinutesBefore?: number; feePercent?: number } | null) ?? { freeUntilMinutesBefore: 60, feePercent: 0 };
    const minutesBefore = (r.startsAt.getTime() - Date.now()) / 60_000;
    const feeMinor = minutesBefore >= (policy.freeUntilMinutesBefore ?? 60) ? 0 : Math.round((r.paidMinor * (policy.feePercent ?? 0)) / 100);
    const refundMinor = Math.max(0, r.paidMinor - feeMinor);
    const upd = await this.prisma.parkingReservation.updateMany({ where: { id, version: r.version }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
    if (!upd.count) throw new DomainError('CONCURRENT_UPDATE', 'Reservation changed, retry', 409);
    await this.prisma.reservationStatusHistory.create({ data: { reservationId: id, from: r.status, to: 'CANCELLED', actorId: userId, reason } });
    await this.audit.log({ tenantId: r.tenantId, actorId: userId, actorKind: 'USER', action: 'reservation.cancel', entityType: 'ParkingReservation', entityId: id, after: { feeMinor, refundMinor } });
    // Refund execution goes through PaymentsService.requestRefund by operator/worker (pending automatic refunds job).
    return { status: 'CANCELLED', cancellationFeeMinor: feeMinor, refundDueMinor: refundMinor };
  }

  /** Expire unpaid holds; mark no-shows after window end. Idempotent. */
  async sweep(now = new Date()) {
    const expired = await this.prisma.parkingReservation.findMany({ where: { status: { in: ['HELD', 'PENDING_PAYMENT'] }, holdExpiresAt: { lt: now } }, select: { id: true, status: true } });
    for (const r of expired) {
      const ok = await this.prisma.parkingReservation.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'EXPIRED' } });
      if (ok.count) await this.prisma.reservationStatusHistory.create({ data: { reservationId: r.id, from: r.status, to: 'EXPIRED', reason: 'hold timeout' } });
    }
    const noShows = await this.prisma.parkingReservation.findMany({ where: { status: 'CONFIRMED', endsAt: { lt: now } }, select: { id: true } });
    for (const r of noShows) {
      const ok = await this.prisma.parkingReservation.updateMany({ where: { id: r.id, status: 'CONFIRMED' }, data: { status: 'NO_SHOW' } });
      if (ok.count) await this.prisma.reservationStatusHistory.create({ data: { reservationId: r.id, from: 'CONFIRMED', to: 'NO_SHOW', reason: 'window ended' } });
    }
    return { expired: expired.length, noShows: noShows.length };
  }
}
