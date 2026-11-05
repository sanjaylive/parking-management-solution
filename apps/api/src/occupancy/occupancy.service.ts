import { Injectable } from '@nestjs/common';
import { ParkingCapacityPool, VehicleClass } from '@prisma/client';
import { Conflict, DomainError } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';

/** Reservations become "due" (protected from walk-ins) this long before their start. */
export const RESERVATION_EARLY_ARRIVAL_MIN = 30;

export interface OccupancySnapshot {
  vehicleClass: VehicleClass;
  total: number;
  occupied: number;
  blocked: number;
  reservedDue: number;
  available: number;
  sensorCount: number | null;
  sensorDrift: number | null;
}

/**
 * Capacity is authoritative in ParkingCapacityPool rows. Every mutation locks the row
 * (SELECT … FOR UPDATE) inside the caller's transaction, which serialises concurrent
 * gate entries / bookings for the same facility+class and prevents overbooking.
 */
@Injectable()
export class OccupancyService {
  constructor(private prisma: PrismaService) {}

  async lockPool(tx: Tx, facilityId: string, vehicleClass: VehicleClass): Promise<ParkingCapacityPool> {
    const rows = await tx.$queryRaw<ParkingCapacityPool[]>`
      SELECT * FROM "ParkingCapacityPool" WHERE "facilityId" = ${facilityId}::uuid AND "vehicleClass" = ${vehicleClass}::"VehicleClass" FOR UPDATE`;
    if (!rows[0]) throw new DomainError('VEHICLE_CLASS_NOT_SUPPORTED', `This facility does not accept ${vehicleClass}`, 422);
    return rows[0];
  }

  private reservedDueNow(tx: Tx, facilityId: string, vehicleClass: VehicleClass, now: Date) {
    return tx.parkingReservation.count({
      where: {
        facilityId,
        vehicleClass,
        status: 'CONFIRMED',
        startsAt: { lte: new Date(now.getTime() + RESERVATION_EARLY_ARRIVAL_MIN * 60_000) },
        endsAt: { gte: now },
      },
    });
  }

  /**
   * Take one unit for an entering vehicle. Reservation holders always get in (their unit was
   * protected); walk-ins/pass holders only if free units remain after protecting due reservations.
   */
  async claimForEntry(tx: Tx, p: { facilityId: string; vehicleClass: VehicleClass; viaReservation: boolean; allowOverCapacity?: boolean; now?: Date }) {
    const now = p.now ?? new Date();
    const pool = await this.lockPool(tx, p.facilityId, p.vehicleClass);
    if (!p.viaReservation && !p.allowOverCapacity) {
      const due = await this.reservedDueNow(tx, p.facilityId, p.vehicleClass, now);
      const free = pool.totalCapacity - pool.occupied - pool.blocked - due;
      if (free <= 0) throw Conflict('FACILITY_FULL', 'No space available for this vehicle type', { occupied: pool.occupied, total: pool.totalCapacity, reservedDue: due });
    } else if (pool.occupied + pool.blocked >= pool.totalCapacity && !p.allowOverCapacity) {
      throw Conflict('FACILITY_FULL', 'Facility physically full', { occupied: pool.occupied, total: pool.totalCapacity });
    }
    await tx.parkingCapacityPool.update({ where: { id: pool.id }, data: { occupied: { increment: 1 } } });
  }

  async releaseForExit(tx: Tx, facilityId: string, vehicleClass: VehicleClass) {
    const pool = await this.lockPool(tx, facilityId, vehicleClass);
    if (pool.occupied > 0) await tx.parkingCapacityPool.update({ where: { id: pool.id }, data: { occupied: { decrement: 1 } } });
  }

  /** Ensures a new reservation over [startsAt, endsAt) does not exceed reservable capacity. */
  async assertReservable(tx: Tx, p: { facilityId: string; vehicleClass: VehicleClass; startsAt: Date; endsAt: Date; excludeReservationId?: string }) {
    const pool = await this.lockPool(tx, p.facilityId, p.vehicleClass);
    const limit = Math.min(pool.reservableCapacity, pool.totalCapacity - pool.blocked);
    const overlapping = await tx.parkingReservation.count({
      where: {
        facilityId: p.facilityId,
        vehicleClass: p.vehicleClass,
        id: p.excludeReservationId ? { not: p.excludeReservationId } : undefined,
        startsAt: { lt: p.endsAt },
        endsAt: { gt: p.startsAt },
        OR: [
          { status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING_PAYMENT'] } },
          { status: 'HELD', holdExpiresAt: { gt: new Date() } },
        ],
      },
    });
    if (overlapping >= limit) throw Conflict('NO_RESERVABLE_CAPACITY', 'No reservable spaces for the selected time', { limit, overlapping });
    return { limit, overlapping };
  }

  /** Lock and occupy a compatible slot (or the specific requested one). SKIP LOCKED avoids gate contention. */
  async assignSlot(tx: Tx, p: { facilityId: string; vehicleClass: VehicleClass; sessionId: string; slotId?: string | null; preferEv?: boolean }) {
    let slotId = p.slotId ?? null;
    if (slotId) {
      const rows = await tx.$queryRaw<{ id: string; state: string }[]>`
        SELECT id, state FROM "ParkingSlot" WHERE id = ${slotId}::uuid AND "facilityId" = ${p.facilityId}::uuid FOR UPDATE`;
      if (!rows[0] || !['AVAILABLE', 'RESERVED', 'HELD'].includes(rows[0].state)) slotId = null;
    }
    if (!slotId) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM "ParkingSlot" s JOIN "ParkingZone" z ON z.id = s."zoneId"
        WHERE s."facilityId" = ${p.facilityId}::uuid AND s."vehicleClass" = ${p.vehicleClass}::"VehicleClass"
          AND s.state = 'AVAILABLE' AND z."isReservedOnly" = false AND z."isStaffOnly" = false AND z."isCorporate" = false
        ORDER BY (s."isEv" = ${!!p.preferEv}) DESC, z.code, s.position NULLS LAST, s.code
        LIMIT 1 FOR UPDATE OF s SKIP LOCKED`;
      slotId = rows[0]?.id ?? null;
    }
    if (!slotId) return null;
    await tx.parkingSlot.update({ where: { id: slotId }, data: { state: 'OCCUPIED', version: { increment: 1 } } });
    await tx.parkingAssignment.create({ data: { sessionId: p.sessionId, slotId } });
    return tx.parkingSlot.findUnique({ where: { id: slotId }, select: { id: true, code: true, zone: { select: { code: true, name: true } } } });
  }

  async releaseSlots(tx: Tx, sessionId: string) {
    const open = await tx.parkingAssignment.findMany({ where: { sessionId, releasedAt: null } });
    for (const a of open) {
      await tx.parkingAssignment.update({ where: { id: a.id }, data: { releasedAt: new Date() } });
      await tx.parkingSlot.updateMany({ where: { id: a.slotId, state: 'OCCUPIED' }, data: { state: 'AVAILABLE', version: { increment: 1 } } });
    }
  }

  async snapshot(facilityId: string, now = new Date()): Promise<OccupancySnapshot[]> {
    const pools = await this.prisma.parkingCapacityPool.findMany({ where: { facilityId }, orderBy: { vehicleClass: 'asc' } });
    return Promise.all(
      pools.map(async (p) => {
        const reservedDue = await this.reservedDueNow(this.prisma as unknown as Tx, facilityId, p.vehicleClass, now);
        return {
          vehicleClass: p.vehicleClass,
          total: p.totalCapacity,
          occupied: p.occupied,
          blocked: p.blocked,
          reservedDue,
          available: Math.max(0, p.totalCapacity - p.occupied - p.blocked - reservedDue),
          sensorCount: p.sensorCount,
          sensorDrift: p.sensorCount == null ? null : p.sensorCount - p.occupied,
        };
      }),
    );
  }

  /** Recompute `occupied` from active sessions (source of truth) and record any discrepancy. */
  async reconcile(tenantId: string, facilityId: string) {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      const pools = await tx.parkingCapacityPool.findMany({ where: { facilityId } });
      for (const p of pools) {
        await this.lockPool(tx, facilityId, p.vehicleClass);
        const actual = await tx.parkingSession.count({
          where: { facilityId, vehicleClass: p.vehicleClass, status: { notIn: ['COMPLETED', 'CANCELLED', 'CREATED'] } },
        });
        if (actual !== p.occupied) {
          await tx.parkingCapacityPool.update({ where: { id: p.id }, data: { occupied: actual } });
          await tx.reconciliationRecord.create({
            data: { tenantId, kind: 'OCCUPANCY', refId: p.id, expected: p.occupied, actual, difference: actual - p.occupied, status: 'RESOLVED', notes: 'Counter corrected from active sessions' },
          });
        }
        results.push({ vehicleClass: p.vehicleClass, counter: p.occupied, sessions: actual, sensor: p.sensorCount, corrected: actual !== p.occupied });
      }
      return results;
    });
  }
}
