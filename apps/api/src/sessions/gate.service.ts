import { HttpStatus, Injectable } from '@nestjs/common';
import { ParkingFacility, ParkingPass, ParkingReservation, Prisma, SessionSource, VehicleClass } from '@prisma/client';
import { randomInt } from 'crypto';
import { AuditService } from '../common/audit.service';
import { Conflict, DomainError, NotFound } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { signQr, verifyQr } from '../common/qr';
import { BarrierOutcome, BarrierService } from '../hardware/barrier.service';
import { LedgerService } from '../payments/ledger.service';
import { OccupancyService, RESERVATION_EARLY_ARRIVAL_MIN } from '../occupancy/occupancy.service';
import { PricingService } from '../pricing/pricing.service';
import { LiveService } from '../realtime/live.service';
import { checkPlate, displayPlate, normalizePlate } from '../vehicles/plate';

export type Credential =
  | { type: 'QR'; token: string; plate?: string }
  | { type: 'PLATE_MANUAL' | 'PLATE_ANPR'; plate: string }
  | { type: 'TICKET'; number: string };

export interface Actor {
  tenantId: string;
  userId?: string;
  deviceId?: string;
}

export interface EntryInput {
  facilityId: string;
  gateId?: string;
  credential: Credential;
  vehicleClass?: VehicleClass;
  photoKey?: string;
  anprEventId?: string;
  allowNonStandardPlate?: boolean;
  /** Offline sync: original event time from the gate device. */
  occurredAt?: Date;
  provisional?: boolean;
  valet?: boolean;
}

export interface ExitInput {
  facilityId: string;
  gateId?: string;
  credential: Credential;
  lostTicket?: boolean;
  occurredAt?: Date;
}

const ACTIVE_STATES = ['CREATED', 'ENTRY_PENDING', 'ACTIVE', 'PAYMENT_PENDING', 'EXIT_READY', 'EXIT_IN_PROGRESS', 'EXCEPTION'] as const;
const OFFLINE_MAX_AGE_MS = 72 * 3600_000;

@Injectable()
export class GateService {
  constructor(
    private prisma: PrismaService,
    private occupancy: OccupancyService,
    private pricing: PricingService,
    private barrier: BarrierService,
    private live: LiveService,
    private audit: AuditService,
    private ledger: LedgerService,
  ) {}

  private async facility(tx: Tx | PrismaService, actor: Actor, facilityId: string) {
    const f = await tx.parkingFacility.findFirst({ where: { id: facilityId, tenantId: actor.tenantId } });
    if (!f) throw NotFound('Facility');
    return f;
  }

  private async assertGate(tx: Tx, facility: ParkingFacility, gateId: string | undefined, direction: 'ENTRY' | 'EXIT') {
    if (!gateId) return;
    const g = await tx.parkingGate.findFirst({ where: { id: gateId, facilityId: facility.id } });
    if (!g) throw NotFound('Gate');
    if (g.direction !== 'BOTH' && g.direction !== direction) throw new DomainError('WRONG_GATE_DIRECTION', `Gate ${g.code} is ${g.direction} only`, 422);
    if (g.status === 'MAINTENANCE') throw new DomainError('GATE_IN_MAINTENANCE', `Gate ${g.code} is under maintenance`, 422);
  }

  private resolveTime(occurredAt?: Date) {
    const now = new Date();
    if (!occurredAt) return now;
    if (occurredAt.getTime() > now.getTime() + 60_000) throw new DomainError('EVENT_IN_FUTURE', 'Event time is in the future', 400);
    if (now.getTime() - occurredAt.getTime() > OFFLINE_MAX_AGE_MS) throw new DomainError('EVENT_TOO_OLD', 'Offline event older than 72h requires supervisor entry', 400);
    return occurredAt;
  }

  private plateOrThrow(raw: string, facility: ParkingFacility, allowNonStandard?: boolean) {
    const c = checkPlate(raw, facility.plateCountry);
    if (!c.normalized) throw new DomainError('INVALID_PLATE', 'Number plate is required', 400);
    if (!c.valid && !allowNonStandard) throw new DomainError('INVALID_PLATE', `"${raw}" is not a valid ${facility.plateCountry} plate`, 400, { normalized: c.normalized });
    return c.normalized;
  }

  private async findActivePass(tx: Tx, tenantId: string, facilityId: string, plate: string, at: Date) {
    return tx.parkingPass.findFirst({
      where: {
        tenantId, status: 'ACTIVE', validFrom: { lte: at }, validUntil: { gte: at },
        vehicles: { some: { vehicle: { plateNormalized: plate } } },
        plan: { OR: [{ facilityIds: { isEmpty: true } }, { facilityIds: { has: facilityId } }] },
      },
      include: { plan: true },
    });
  }

  private assertPassUsable(pass: ParkingPass & { plan: { allowedWindows: Prisma.JsonValue; maxEntriesPerDay: number | null } }, facility: ParkingFacility, at: Date, entriesToday: number) {
    if (pass.plan.maxEntriesPerDay != null && entriesToday >= pass.plan.maxEntriesPerDay)
      throw new DomainError('PASS_ENTRY_LIMIT', 'Daily entry limit reached for this pass', 422);
    const windows = pass.plan.allowedWindows as { days: number[]; from: string; to: string }[] | null;
    if (windows?.length) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: facility.timezone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
      const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
      const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
      const hm = `${p.hour}:${p.minute}`;
      const ok = windows.some((w) => w.days.includes(day) && hm >= w.from && hm < w.to);
      if (!ok) throw new DomainError('PASS_OUTSIDE_WINDOW', 'Pass is not valid at this time', 422);
    }
  }

  // ─────────────────────────────── ENTRY ───────────────────────────────

  async entry(actor: Actor, input: EntryInput) {
    const at = this.resolveTime(input.occurredAt);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const facility = await this.facility(tx, actor, input.facilityId);
        await this.assertGate(tx, facility, input.gateId, 'ENTRY');

        let plate: string;
        let vehicleClass = input.vehicleClass;
        let source: SessionSource = 'WALK_IN';
        let reservation: ParkingReservation | null = null;
        let pass: Awaited<ReturnType<GateService['findActivePass']>> = null;
        let corporateId: string | null = null;

        const c = input.credential;
        if (c.type === 'TICKET') throw new DomainError('TICKET_NOT_FOR_ENTRY', 'Tickets are issued at entry; scan at exit', 422);
        if (c.type === 'QR') {
          const claims = verifyQr(c.token);
          if (claims.k === 'S') {
            const s = await tx.parkingSession.findFirst({ where: { id: claims.id, tenantId: actor.tenantId }, select: { id: true, status: true } });
            throw Conflict('TICKET_ALREADY_USED', 'This ticket has already been used for entry', { sessionId: s?.id, status: s?.status });
          }
          if (claims.k === 'R') {
            reservation = await tx.parkingReservation.findFirst({ where: { id: claims.id, tenantId: actor.tenantId }, include: { vehicle: true } });
            if (!reservation || reservation.facilityId !== facility.id) throw new DomainError('RESERVATION_WRONG_FACILITY', 'Reservation is not for this facility', 422);
            if (reservation.status === 'CHECKED_IN' || reservation.status === 'COMPLETED')
              throw Conflict('DUPLICATE_SCAN', 'This reservation has already been used for entry');
            if (reservation.status !== 'CONFIRMED') throw new DomainError('RESERVATION_NOT_CONFIRMED', `Reservation is ${reservation.status}`, 422);
            if (at.getTime() < reservation.startsAt.getTime() - RESERVATION_EARLY_ARRIVAL_MIN * 60_000)
              throw new DomainError('RESERVATION_TOO_EARLY', 'Reservation window has not started', 422, { startsAt: reservation.startsAt });
            if (at > reservation.endsAt) throw new DomainError('RESERVATION_EXPIRED', 'Reservation has expired', 422);
            plate = (reservation as any).vehicle.plateNormalized;
            vehicleClass = reservation.vehicleClass;
            source = 'RESERVATION';
          } else {
            const p = await tx.parkingPass.findFirst({ where: { id: claims.id, tenantId: actor.tenantId }, include: { plan: true, vehicles: { include: { vehicle: true } } } });
            if (!p || p.status !== 'ACTIVE' || p.validFrom > at || p.validUntil < at)
              throw new DomainError('PASS_INVALID', p ? `Pass is ${p.status === 'ACTIVE' ? 'expired' : p.status}` : 'Pass not found', 422);
            if (p.plan.facilityIds.length && !p.plan.facilityIds.includes(facility.id)) throw new DomainError('PASS_WRONG_FACILITY', 'Pass not valid at this facility', 422);
            const bound = p.vehicles.map((v) => v.vehicle.plateNormalized);
            const presented = c.plate ? normalizePlate(c.plate) : bound.length === 1 ? bound[0] : undefined;
            if (!presented) throw new DomainError('PLATE_REQUIRED', 'Enter the vehicle number for this pass', 400, { vehicles: bound });
            if (!bound.includes(presented)) throw new DomainError('PASS_VEHICLE_MISMATCH', 'Vehicle is not registered on this pass', 422);
            plate = presented;
            pass = p;
            vehicleClass = p.plan.vehicleClass;
            source = 'PASS';
          }
        } else {
          plate = this.plateOrThrow(c.plate, facility, input.allowNonStandardPlate);
          pass = await this.findActivePass(tx, actor.tenantId, facility.id, plate, at);
          if (pass) {
            source = 'PASS';
            vehicleClass = pass.plan.vehicleClass;
          } else {
            reservation = await tx.parkingReservation.findFirst({
              where: {
                facilityId: facility.id, status: 'CONFIRMED', vehicle: { plateNormalized: plate },
                startsAt: { lte: new Date(at.getTime() + RESERVATION_EARLY_ARRIVAL_MIN * 60_000) }, endsAt: { gte: at },
              },
              orderBy: { startsAt: 'asc' },
            });
            if (reservation) {
              source = 'RESERVATION';
              vehicleClass = reservation.vehicleClass;
            } else {
              const wl = await tx.vehicleWhitelist.findFirst({
                where: {
                  tenantId: actor.tenantId, plateNormalized: plate, corporateId: { not: null }, validFrom: { lte: at },
                  OR: [{ validUntil: null }, { validUntil: { gte: at } }], AND: [{ OR: [{ facilityId: null }, { facilityId: facility.id }] }],
                },
              });
              if (wl) {
                source = 'CORPORATE';
                corporateId = wl.corporateId;
              }
            }
          }
        }

        const blacklisted = await tx.vehicleBlacklist.findUnique({ where: { tenantId_plateNormalized: { tenantId: actor.tenantId, plateNormalized: plate! } } });
        if (blacklisted) throw new DomainError('VEHICLE_BLACKLISTED', 'Vehicle is not permitted. Contact supervisor.', 403);

        const existing = await tx.parkingSession.findFirst({
          where: { facilityId: facility.id, plateNormalized: plate!, status: { in: [...ACTIVE_STATES] } },
          select: { id: true, entryAt: true },
        });
        if (existing) throw Conflict('DUPLICATE_ACTIVE_SESSION', 'Vehicle already has an active session at this facility', existing);

        if (!vehicleClass) {
          const v = await tx.vehicle.findUnique({ where: { plateNormalized: plate! } });
          vehicleClass = v?.vehicleClass;
        }
        if (!vehicleClass) throw new DomainError('VEHICLE_CLASS_REQUIRED', 'Select the vehicle type', 400);

        if (pass) {
          const inUse = await tx.parkingSession.count({ where: { passId: pass.id, status: { in: [...ACTIVE_STATES] } } });
          if (inUse > 0) throw Conflict('PASS_IN_USE', 'This pass is already in use by another vehicle inside');
          const dayStart = new Date(at.getTime() - 24 * 3600_000);
          const entriesToday = await tx.parkingPassUsage.count({ where: { passId: pass.id, enteredAt: { gte: dayStart } } });
          this.assertPassUsable(pass, facility, at, entriesToday);
        }

        if (corporateId) {
          const alloc = await tx.corporateAllocation.findUnique({ where: { corporateId_facilityId_vehicleClass: { corporateId, facilityId: facility.id, vehicleClass } } });
          if (alloc) {
            const upd = await tx.corporateAllocation.updateMany({ where: { id: alloc.id, inUse: { lt: alloc.units } }, data: { inUse: { increment: 1 } } });
            if (upd.count === 0) source = 'WALK_IN'; // corporate quota exhausted -> billed as walk-in
          }
          if (source !== 'CORPORATE') corporateId = null;
        }

        // Offline provisional entries may exceed live capacity (the vehicle is physically inside already).
        await this.occupancy.claimForEntry(tx, { facilityId: facility.id, vehicleClass, viaReservation: source === 'RESERVATION', allowOverCapacity: !!input.provisional, now: at });

        let rateVersionId: string | null = null;
        try {
          rateVersionId = (await this.pricing.resolveVersion(facility.id, vehicleClass, at, tx)).id;
        } catch (e) {
          if (source === 'WALK_IN' || source === 'RESERVATION') throw e; // pass/corporate may be rate-less
        }

        const vehicle = await tx.vehicle.upsert({
          where: { plateNormalized: plate! },
          update: {},
          create: { plateNormalized: plate!, plateDisplay: displayPlate(plate!, facility.plateCountry), country: facility.plateCountry, vehicleClass, isEv: vehicleClass.startsWith('EV_') },
        });

        let session;
        try {
          session = await tx.parkingSession.create({
            data: {
              tenantId: actor.tenantId, facilityId: facility.id, vehicleId: vehicle.id, plateNormalized: plate!, vehicleClass,
              status: 'ACTIVE', source, reservationId: reservation?.id, passId: pass?.id, corporateId, rateVersionId, entryAt: at,
              amountPaidMinor: reservation?.paidMinor ?? 0, isProvisional: !!input.provisional,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
            throw Conflict('DUPLICATE_ACTIVE_SESSION', 'Vehicle already has an active session at this facility');
          throw e;
        }

        const credentialType = c.type === 'QR' ? 'QR' : c.type;
        await tx.parkingEntry.create({
          data: { sessionId: session.id, gateId: input.gateId, credentialType, staffUserId: actor.userId, deviceId: actor.deviceId, photoKey: input.photoKey, anprEventId: input.anprEventId, at },
        });
        const yymmdd = at.toISOString().slice(2, 10).replace(/-/g, '');
        const ticket = await tx.parkingTicket.create({
          data: { sessionId: session.id, number: `${facility.code}-${yymmdd}-${String(randomInt(0, 1e8)).padStart(8, '0')}`, qrToken: signQr({ k: 'S', id: session.id }) },
        });

        let slot = null;
        if (facility.occupancyMode === 'SLOT_BASED') {
          slot = await this.occupancy.assignSlot(tx, { facilityId: facility.id, vehicleClass, sessionId: session.id, slotId: reservation?.slotId ?? pass?.slotId, preferEv: vehicleClass.startsWith('EV_') });
          if (!slot && !input.provisional) throw Conflict('NO_SLOT_AVAILABLE', 'No compatible slot is free');
        }

        if (reservation) {
          await tx.parkingReservation.update({ where: { id: reservation.id }, data: { status: 'CHECKED_IN', version: { increment: 1 } } });
          await tx.reservationStatusHistory.create({ data: { reservationId: reservation.id, from: 'CONFIRMED', to: 'CHECKED_IN', actorId: actor.userId } });
        }
        if (pass) await tx.parkingPassUsage.create({ data: { passId: pass.id, sessionId: session.id, facilityId: facility.id, enteredAt: at } });

        await tx.parkingSessionEvent.create({
          data: { sessionId: session.id, type: 'ENTERED', from: null, to: 'ACTIVE', actorId: actor.userId, deviceId: actor.deviceId, data: { gateId: input.gateId, credentialType, source, slot: slot?.code, provisional: !!input.provisional } },
        });
        await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId ?? actor.deviceId, actorKind: actor.userId ? 'USER' : 'DEVICE', action: 'session.entry', entityType: 'ParkingSession', entityId: session.id, after: { plate, source, gateId: input.gateId } }, tx);

        return { session, ticket, slot, facility, plateDisplay: vehicle.plateDisplay };
      },
      { isolationLevel: 'ReadCommitted', timeout: 15_000 },
    );

    const barrier: BarrierOutcome = input.provisional
      ? { mode: 'MANUAL', status: 'NO_DEVICE' }
      : await this.barrier.open({ tenantId: actor.tenantId, gateId: input.gateId, reason: 'ENTRY', sessionId: result.session.id, requestedById: actor.userId });
    this.live.emit(result.facility.id, 'session.started', { sessionId: result.session.id, plate: result.session.plateNormalized, vehicleClass: result.session.vehicleClass });
    this.live.emit(result.facility.id, 'occupancy.changed', {});

    return {
      sessionId: result.session.id,
      status: result.session.status,
      source: result.session.source,
      plate: result.session.plateNormalized,
      plateDisplay: result.plateDisplay,
      vehicleClass: result.session.vehicleClass,
      entryAt: result.session.entryAt,
      ticket: { number: result.ticket.number, qrToken: result.ticket.qrToken },
      slot: result.slot ? { code: result.slot.code, zone: result.slot.zone.code, zoneName: result.slot.zone.name } : null,
      barrier,
    };
  }

  // ─────────────────────────────── EXIT ───────────────────────────────

  private async findSessionForExit(tx: Tx | PrismaService, actor: Actor, facility: ParkingFacility, c: Credential) {
    let where: Prisma.ParkingSessionWhereInput;
    if (c.type === 'QR') {
      const claims = verifyQr(c.token);
      if (claims.k === 'S') where = { id: claims.id };
      else if (claims.k === 'R') where = { reservationId: claims.id };
      else where = { passId: claims.id, status: { in: [...ACTIVE_STATES] } };
    } else if (c.type === 'TICKET') where = { ticket: { number: c.number.trim().toUpperCase() } };
    else where = { plateNormalized: normalizePlate(c.plate), status: { in: [...ACTIVE_STATES] } };
    const s = await tx.parkingSession.findFirst({ where: { ...where, tenantId: actor.tenantId, facilityId: facility.id }, orderBy: { entryAt: 'desc' } });
    if (!s) throw new DomainError('SESSION_NOT_FOUND', 'No parking session found for this vehicle/ticket at this facility', 404);
    return s;
  }

  private async computeFee(tx: Tx | PrismaService, session: Prisma.ParkingSessionGetPayload<{}>, facility: ParkingFacility, exitAt: Date, lostTicket: boolean) {
    let passCovered = false;
    if (session.passId) {
      const p = await tx.parkingPass.findUnique({ where: { id: session.passId } });
      passCovered = !!p && p.status === 'ACTIVE' && p.validUntil >= exitAt;
    }
    const valet = (await tx.valetRequest.count({ where: { sessionId: session.id, status: { not: 'CANCELLED' } } })) > 0;
    let price = { grossMinor: 0, discountMinor: 0, netMinor: 0, durationMinutes: Math.ceil((exitAt.getTime() - session.entryAt.getTime()) / 60000), billableMinutes: 0, lines: [] as any[] };
    if (session.rateVersionId) {
      const v = await this.pricing.versionById(session.rateVersionId, tx);
      price = this.pricing.price(v.definition, facility.timezone, {
        entryAt: session.entryAt, exitAt, lostTicket, passCovered, valet, ev: session.vehicleClass.startsWith('EV_'),
      });
    } else if (session.source === 'WALK_IN') {
      throw new DomainError('NO_RATE_CONFIGURED', 'Session has no rate; supervisor adjustment required', 422);
    }
    if (session.source === 'CORPORATE') price = { ...price, lines: [...price.lines, { code: 'CORPORATE_BILLED', label: 'Billed to corporate account', amountMinor: -price.netMinor }], netMinor: 0 };
    const adj = await tx.parkingSessionAdjustment.aggregate({ where: { sessionId: session.id }, _sum: { amountMinor: true } });
    const adjustmentsMinor = adj._sum.amountMinor ?? 0;
    const totalMinor = Math.max(0, price.netMinor + adjustmentsMinor);
    const outstandingMinor = Math.max(0, totalMinor - session.amountPaidMinor);
    return { ...price, adjustmentsMinor, totalMinor, paidMinor: session.amountPaidMinor, outstandingMinor };
  }

  async exitQuote(actor: Actor, input: ExitInput) {
    const exitAt = this.resolveTime(input.occurredAt);
    return this.prisma.$transaction(async (tx) => {
      const facility = await this.facility(tx, actor, input.facilityId);
      const s = await this.findSessionForExit(tx, actor, facility, input.credential);
      if (s.status === 'COMPLETED') throw Conflict('SESSION_ALREADY_COMPLETED', 'Vehicle has already exited', { exitAt: s.exitAt });
      if (s.status === 'CANCELLED') throw Conflict('SESSION_CANCELLED', 'Session was cancelled');
      const lost = !!input.lostTicket || s.isLostTicket;
      if (input.lostTicket && input.credential.type !== 'PLATE_MANUAL' && input.credential.type !== 'PLATE_ANPR')
        throw new DomainError('PLATE_REQUIRED', 'Lost-ticket exit requires the vehicle number', 400);
      if (input.lostTicket && !s.isLostTicket) {
        await tx.parkingSession.update({ where: { id: s.id }, data: { isLostTicket: true } });
        await tx.parkingTicket.updateMany({ where: { sessionId: s.id }, data: { lost: true } });
        s.isLostTicket = true;
      }
      const fee = await this.computeFee(tx, s, facility, exitAt, lost);
      const calc = await tx.parkingFeeCalculation.create({
        data: { sessionId: s.id, rateVersionId: s.rateVersionId, billedUntil: exitAt, grossMinor: fee.grossMinor, discountMinor: fee.discountMinor, netMinor: fee.totalMinor, breakdown: fee as unknown as Prisma.InputJsonValue },
      });
      const next = fee.outstandingMinor > 0 ? 'PAYMENT_PENDING' : 'EXIT_READY';
      await tx.parkingSession.update({ where: { id: s.id }, data: { amountDueMinor: fee.totalMinor, status: next, version: { increment: 1 } } });
      if (s.status !== next) await tx.parkingSessionEvent.create({ data: { sessionId: s.id, type: 'FEE_QUOTED', from: s.status, to: next, actorId: actor.userId, data: { calcId: calc.id, totalMinor: fee.totalMinor } } });
      return {
        sessionId: s.id, plate: s.plateNormalized, vehicleClass: s.vehicleClass, source: s.source, entryAt: s.entryAt, quotedAt: exitAt,
        status: next, calculationId: calc.id, ...fee,
      };
    });
  }

  /** Cash collected at the gate. Must be within an open shift of the collecting staff member. */
  async collectCash(actor: Required<Pick<Actor, 'tenantId' | 'userId'>>, sessionId: string, amountMinor: number) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new DomainError('INVALID_AMOUNT', 'Amount must be a positive integer (paise)', 400);
    return this.prisma.$transaction(async (tx) => {
      const [s] = await tx.$queryRaw<{ id: string; status: string; facilityId: string; amountDueMinor: number; amountPaidMinor: number }[]>`
        SELECT id, status, "facilityId", "amountDueMinor", "amountPaidMinor" FROM "ParkingSession" WHERE id = ${sessionId}::uuid AND "tenantId" = ${actor.tenantId}::uuid FOR UPDATE`;
      if (!s) throw NotFound('Session');
      if (s.status !== 'PAYMENT_PENDING') throw new DomainError('NOTHING_TO_COLLECT', `Session is ${s.status}; quote the fee first`, 409);
      const outstanding = s.amountDueMinor - s.amountPaidMinor;
      if (amountMinor > outstanding) throw new DomainError('OVERPAYMENT', 'Amount exceeds outstanding balance', 422, { outstandingMinor: outstanding });
      const shift = await tx.staffShift.findFirst({ where: { tenantId: actor.tenantId, userId: actor.userId, facilityId: s.facilityId, status: 'OPEN' } });
      if (!shift) throw new DomainError('SHIFT_NOT_OPEN', 'Open your shift before collecting cash', 409);
      const receiptNumber = `RC-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
      const payment = await tx.payment.create({
        data: {
          tenantId: actor.tenantId, purpose: 'PARKING_SESSION', sessionId, method: 'CASH', provider: 'cash', amountMinor, status: 'SUCCEEDED',
          collectedByUserId: actor.userId, shiftId: shift.id, succeededAt: new Date(), receiptNumber,
        },
      });
      await tx.shiftCashRecord.create({ data: { shiftId: shift.id, paymentId: payment.id, kind: 'COLLECTION', amountMinor } });
      await this.ledger.post(tx, { tenantId: actor.tenantId, refType: 'PAYMENT', refId: payment.id, memo: 'Cash parking fee', lines: [{ account: 'CASH_DRAWER', debitMinor: amountMinor }, { account: 'PARKING_REVENUE', creditMinor: amountMinor }] });
      const paid = s.amountPaidMinor + amountMinor;
      const next = paid >= s.amountDueMinor ? 'EXIT_READY' : 'PAYMENT_PENDING';
      await tx.parkingSession.update({ where: { id: sessionId }, data: { amountPaidMinor: paid, status: next, version: { increment: 1 } } });
      await tx.parkingSessionEvent.create({ data: { sessionId, type: 'PAYMENT_RECEIVED', from: 'PAYMENT_PENDING', to: next, actorId: actor.userId, data: { paymentId: payment.id, method: 'CASH', amountMinor } } });
      return { paymentId: payment.id, receiptNumber, amountMinor, outstandingMinor: Math.max(0, s.amountDueMinor - paid), status: next };
    });
  }

  async exitConfirm(actor: Actor, input: ExitInput) {
    const exitAt = this.resolveTime(input.occurredAt);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const facility = await this.facility(tx, actor, input.facilityId);
        await this.assertGate(tx, facility, input.gateId, 'EXIT');
        const found = await this.findSessionForExit(tx, actor, facility, input.credential);
        // Row lock: concurrent exit attempts for the same session serialise here.
        await tx.$queryRaw`SELECT id FROM "ParkingSession" WHERE id = ${found.id}::uuid FOR UPDATE`;
        const s = await tx.parkingSession.findUniqueOrThrow({ where: { id: found.id } });
        if (s.status === 'COMPLETED') throw Conflict('SESSION_ALREADY_COMPLETED', 'Vehicle has already exited', { exitAt: s.exitAt });
        if (s.status === 'CANCELLED') throw Conflict('SESSION_CANCELLED', 'Session was cancelled');

        // Server-authoritative fee at confirm time. If the last quote was fully paid and we are within
        // the post-payment grace window, honour it; otherwise re-price to now.
        const lastCalc = await tx.parkingFeeCalculation.findFirst({ where: { sessionId: s.id }, orderBy: { calculatedAt: 'desc' } });
        let totalMinor: number;
        if (lastCalc && s.amountPaidMinor >= lastCalc.netMinor && exitAt.getTime() - lastCalc.billedUntil.getTime() <= facility.graceMinutes * 60_000) {
          totalMinor = lastCalc.netMinor;
        } else {
          const fee = await this.computeFee(tx, s, facility, exitAt, s.isLostTicket);
          totalMinor = fee.totalMinor;
          await tx.parkingFeeCalculation.create({ data: { sessionId: s.id, rateVersionId: s.rateVersionId, billedUntil: exitAt, grossMinor: fee.grossMinor, discountMinor: fee.discountMinor, netMinor: fee.totalMinor, breakdown: fee as unknown as Prisma.InputJsonValue } });
        }
        const outstanding = totalMinor - s.amountPaidMinor;
        if (outstanding > 0) {
          await tx.parkingSession.update({ where: { id: s.id }, data: { amountDueMinor: totalMinor, status: 'PAYMENT_PENDING' } });
          throw new DomainError('PAYMENT_REQUIRED', 'Payment is required before exit', HttpStatus.PAYMENT_REQUIRED, { outstandingMinor: outstanding, totalMinor, sessionId: s.id });
        }

        await tx.parkingSession.update({ where: { id: s.id }, data: { status: 'COMPLETED', exitAt, amountDueMinor: totalMinor, version: { increment: 1 } } });
        const credentialType = input.credential.type === 'QR' ? 'QR' : input.credential.type;
        await tx.parkingExit.create({ data: { sessionId: s.id, gateId: input.gateId, credentialType, staffUserId: actor.userId, deviceId: actor.deviceId, at: exitAt } });
        await this.occupancy.releaseForExit(tx, facility.id, s.vehicleClass);
        await this.occupancy.releaseSlots(tx, s.id);
        if (s.reservationId) {
          await tx.parkingReservation.update({ where: { id: s.reservationId }, data: { status: 'COMPLETED' } });
          await tx.reservationStatusHistory.create({ data: { reservationId: s.reservationId, from: 'CHECKED_IN', to: 'COMPLETED', actorId: actor.userId } });
        }
        if (s.passId) await tx.parkingPassUsage.updateMany({ where: { sessionId: s.id }, data: { exitedAt: exitAt } });
        if (s.corporateId) await tx.corporateAllocation.updateMany({ where: { corporateId: s.corporateId, facilityId: facility.id, vehicleClass: s.vehicleClass, inUse: { gt: 0 } }, data: { inUse: { decrement: 1 } } });
        await tx.parkingSessionEvent.create({ data: { sessionId: s.id, type: 'EXIT_CONFIRMED', from: s.status, to: 'COMPLETED', actorId: actor.userId, deviceId: actor.deviceId, data: { gateId: input.gateId, totalMinor } } });
        await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId ?? actor.deviceId, actorKind: actor.userId ? 'USER' : 'DEVICE', action: 'session.exit', entityType: 'ParkingSession', entityId: s.id, after: { totalMinor, gateId: input.gateId } }, tx);

        const payments = await tx.payment.findMany({ where: { sessionId: s.id, status: 'SUCCEEDED' }, select: { id: true, method: true, amountMinor: true, receiptNumber: true, succeededAt: true } });
        return { s, facility, totalMinor, payments };
      },
      { timeout: 15_000 },
    );

    const barrier = await this.barrier.open({ tenantId: actor.tenantId, gateId: input.gateId, reason: 'EXIT', sessionId: result.s.id, requestedById: actor.userId });
    this.live.emit(result.facility.id, 'session.completed', { sessionId: result.s.id });
    this.live.emit(result.facility.id, 'occupancy.changed', {});
    const durationMinutes = Math.ceil((exitAt.getTime() - result.s.entryAt.getTime()) / 60000);
    return {
      sessionId: result.s.id,
      status: 'COMPLETED' as const,
      receipt: {
        facility: result.facility.name, plate: result.s.plateNormalized, entryAt: result.s.entryAt, exitAt, durationMinutes,
        totalMinor: result.totalMinor, payments: result.payments,
      },
      barrier,
    };
  }
}
