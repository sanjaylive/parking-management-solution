import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { calculatePrice, parseRateDefinition } from '../src/pricing/engine';
import { SimulatorLog } from '../src/hardware/simulator';
import { DEFAULT_RATE } from '../prisma/seed-lib';
import { authed, backdateSession, createApp, customerLogin, key, login, prisma, resetDb, setupOperator } from './helpers';

jest.setTimeout(60_000);

let app: INestApplication;
let op: Awaited<ReturnType<typeof setupOperator>>;
let gateToken: string;
let supervisorToken: string;
let ownerToken: string;

beforeAll(async () => {
  await resetDb();
  app = await createApp();
  op = await setupOperator('skyline', { slotBased: true, carCapacity: 20 });
  gateToken = await login(app, 'gate+owner@skyline.test');
  supervisorToken = await login(app, 'supervisor+owner@skyline.test');
  ownerToken = await login(app, 'owner@skyline.test');
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const occ = async () => (await prisma.parkingCapacityPool.findUniqueOrThrow({ where: { facilityId_vehicleClass: { facilityId: op.facility.id, vehicleClass: 'CAR' } } })).occupied;

describe('Critical flow: reservation → QR → entry → session → exit → capacity released', () => {
  it('runs end-to-end', async () => {
    const cust = await customerLogin(app);
    expect(cust.isNewUser).toBe(true);
    const c = authed(app, cust.token);
    await c.patch('/v1/me/profile').send({ name: 'Asha Rao' }).expect(200);
    const v = await c.post('/v1/me/vehicles').send({ plate: 'KA 01 AB 1234', vehicleClass: 'CAR' }).expect(201);

    // 1. Book + pay → QR
    const startsAt = new Date(Date.now() + 5 * 60_000);
    const endsAt = new Date(startsAt.getTime() + 3 * 3600_000);
    const quote = await request(app.getHttpServer()).post(`/v1/public/facilities/${op.facility.id}/quote`).send({ vehicleClass: 'CAR', startsAt, endsAt }).expect(200);
    expect(quote.body.netMinor).toBeGreaterThan(0);
    const res = await c.post('/v1/me/reservations').send({ facilityId: op.facility.id, vehicleId: v.body.vehicleId, startsAt, endsAt }).expect(201);
    expect(res.body.status).toBe('HELD');
    expect(res.body.qrToken).toBeNull();
    expect(res.body.amountMinor).toBe(quote.body.netMinor);

    const order = await c.post('/v1/payments/orders').send({ purpose: 'RESERVATION', reservationId: res.body.id }).expect(201);
    // Payment is NOT confirmed by any client callback — only by the signed webhook below.
    expect((await c.get(`/v1/me/reservations/${res.body.id}`).expect(200)).body.status).toBe('PENDING_PAYMENT');
    await c.post('/v1/payments/sandbox/simulate').send({ orderId: order.body.checkout.orderId }).expect(200);
    const confirmed = await c.get(`/v1/me/reservations/${res.body.id}`).expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.qrToken).toMatch(/^P2A1\./);

    // 2. Staff scans QR → entry
    const g = authed(app, gateToken, op.tenant.id);
    const before = await occ();
    const entry = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, gateId: op.entryGate.id, credential: { type: 'QR', token: confirmed.body.qrToken } }).expect(201);
    expect(entry.body.source).toBe('RESERVATION');
    expect(entry.body.status).toBe('ACTIVE');
    expect(entry.body.slot.code).toMatch(/^A\d{3}$/);
    expect(entry.body.barrier.status).toBe('ACKED');
    expect(await occ()).toBe(before + 1);
    expect((await c.get(`/v1/me/reservations/${res.body.id}`)).body.status).toBe('CHECKED_IN');

    // Duplicate QR scan is rejected
    const dup = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, gateId: op.entryGate.id, credential: { type: 'QR', token: confirmed.body.qrToken } }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_SCAN');

    // Customer sees live session
    const live = await c.get('/v1/me/sessions?active=true').expect(200);
    expect(live.body).toHaveLength(1);

    // 3. Overstay beyond the prepaid window → outstanding charged
    await backdateSession(entry.body.sessionId, 5 * 60);
    const q = await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, gateId: op.exitGate.id, credential: { type: 'TICKET', number: entry.body.ticket.number } }).expect(200);
    const expected = calculatePrice({ definition: parseRateDefinition(DEFAULT_RATE), timezone: 'Asia/Kolkata', entryAt: new Date(q.body.entryAt), exitAt: new Date(q.body.quotedAt) });
    expect(q.body.totalMinor).toBe(expected.netMinor);
    expect(q.body.paidMinor).toBe(res.body.amountMinor);
    expect(q.body.outstandingMinor).toBe(Math.max(0, expected.netMinor - res.body.amountMinor));

    // 4. Exit without paying the balance is refused
    if (q.body.outstandingMinor > 0) {
      const refused = await g.post('/v1/gate/exit/confirm', key()).send({ facilityId: op.facility.id, gateId: op.exitGate.id, credential: { type: 'TICKET', number: entry.body.ticket.number } }).expect(402);
      expect(refused.body.code).toBe('PAYMENT_REQUIRED');
      // Customer pays balance digitally
      const o2 = await c.post('/v1/payments/orders').send({ purpose: 'PARKING_SESSION', sessionId: entry.body.sessionId }).expect(201);
      expect(o2.body.amountMinor).toBe(q.body.outstandingMinor);
      await c.post('/v1/payments/sandbox/simulate').send({ orderId: o2.body.checkout.orderId }).expect(200);
    }

    // 5. Exit confirm → barrier, capacity release, receipt
    SimulatorLog.clear();
    const exitKey = key();
    const exitBody = { facilityId: op.facility.id, gateId: op.exitGate.id, credential: { type: 'TICKET', number: entry.body.ticket.number } };
    const done = await g.post('/v1/gate/exit/confirm', exitKey).send(exitBody).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.barrier.status).toBe('ACKED');
    expect(SimulatorLog.entries.map((e) => e.action)).toEqual(['OPEN']);
    expect(done.body.receipt.totalMinor).toBe(expected.netMinor);
    expect(await occ()).toBe(before);
    const slot = await prisma.parkingSlot.findFirstOrThrow({ where: { facilityId: op.facility.id, code: entry.body.slot.code } });
    expect(slot.state).toBe('AVAILABLE');
    expect((await c.get(`/v1/me/reservations/${res.body.id}`)).body.status).toBe('COMPLETED');

    // Idempotent replay returns the original result without a second barrier command
    const replay = await g.post('/v1/gate/exit/confirm', exitKey).send(exitBody).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(SimulatorLog.entries).toHaveLength(1);

    // Double exit with a fresh key is rejected
    const dbl = await g.post('/v1/gate/exit/confirm', key()).send(exitBody).expect(409);
    expect(dbl.body.code).toBe('SESSION_ALREADY_COMPLETED');

    // Ledger is balanced
    const sums = await prisma.financialLedgerEntry.aggregate({ where: { tenantId: op.tenant.id }, _sum: { debitMinor: true, creditMinor: true } });
    expect(sums._sum.debitMinor).toBe(sums._sum.creditMinor);
  });
});

describe('Walk-in, cash and shift reconciliation', () => {
  it('walk-in by plate, cash collection inside shift, shortage recorded on close', async () => {
    const g = authed(app, gateToken, op.tenant.id);
    const noShift = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, gateId: op.entryGate.id, credential: { type: 'PLATE_MANUAL', plate: 'MH12XY9001' }, vehicleClass: 'CAR' }).expect(201);
    expect(noShift.body.source).toBe('WALK_IN');
    await backdateSession(noShift.body.sessionId, 125);
    const q = await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, gateId: op.exitGate.id, credential: { type: 'PLATE_MANUAL', plate: 'MH12XY9001' } }).expect(200);
    expect(q.body.outstandingMinor).toBeGreaterThan(0);

    const blocked = await g.post(`/v1/gate/sessions/${q.body.sessionId}/cash`, key()).send({ amountMinor: q.body.outstandingMinor }).expect(409);
    expect(blocked.body.code).toBe('SHIFT_NOT_OPEN');

    const shift = await g.post('/v1/shifts/open').send({ facilityId: op.facility.id, gateId: op.exitGate.id, openingFloatMinor: 50000 }).expect(201);
    const over = await g.post(`/v1/gate/sessions/${q.body.sessionId}/cash`, key()).send({ amountMinor: q.body.outstandingMinor + 1 }).expect(422);
    expect(over.body.code).toBe('OVERPAYMENT');
    const cash = await g.post(`/v1/gate/sessions/${q.body.sessionId}/cash`, key()).send({ amountMinor: q.body.outstandingMinor }).expect(201);
    expect(cash.body.status).toBe('EXIT_READY');
    await g.post('/v1/gate/exit/confirm', key()).send({ facilityId: op.facility.id, gateId: op.exitGate.id, credential: { type: 'PLATE_MANUAL', plate: 'MH12XY9001' } }).expect(200);

    const expectedCash = 50000 + q.body.outstandingMinor;
    const closed = await g.post(`/v1/shifts/${shift.body.id}/close`).send({ declaredCashMinor: expectedCash - 1000 }).expect(201);
    expect(closed.body.expectedCashMinor).toBe(expectedCash);
    expect(closed.body.varianceMinor).toBe(-1000);
    const rec = await prisma.reconciliationRecord.findFirstOrThrow({ where: { refId: shift.body.id } });
    expect(rec.difference).toBe(-1000);
  });

  it('rejects invalid plates and duplicate active sessions', async () => {
    const g = authed(app, gateToken, op.tenant.id);
    const bad = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'HELLO' }, vehicleClass: 'CAR' }).expect(400);
    expect(bad.body.code).toBe('INVALID_PLATE');
    await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'DL3CAF0001' }, vehicleClass: 'CAR' }).expect(201);
    const dup = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'dl 3c af 0001' }, vehicleClass: 'CAR' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_ACTIVE_SESSION');
  });

  it('lost ticket adds the lost-ticket fee and requires the plate', async () => {
    const g = authed(app, gateToken, op.tenant.id);
    const e = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA05MN4321' }, vehicleClass: 'CAR' }).expect(201);
    await backdateSession(e.body.sessionId, 30);
    const needPlate = await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, credential: { type: 'TICKET', number: e.body.ticket.number }, lostTicket: true }).expect(400);
    expect(needPlate.body.code).toBe('PLATE_REQUIRED');
    const q = await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA05MN4321' }, lostTicket: true }).expect(200);
    expect(q.body.lines.find((l: any) => l.code === 'LOST_TICKET').amountMinor).toBe(30000);
  });
});

describe('Payments safety', () => {
  it('rejects bad webhook signatures and deduplicates repeated events', async () => {
    const bad = await request(app.getHttpServer()).post('/v1/payments/webhooks/sandbox').set('x-sandbox-signature', 'ab'.repeat(32)).send({ id: 'evt_x', type: 'payment.succeeded', orderId: 'nope' }).expect(401);
    expect(bad.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');

    const g = authed(app, gateToken, op.tenant.id);
    const e = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'TN09BC7777' }, vehicleClass: 'CAR' }).expect(201);
    await backdateSession(e.body.sessionId, 90);
    await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'TN09BC7777' } }).expect(200);
    const order = await g.post('/v1/payments/staff-orders').send({ purpose: 'PARKING_SESSION', sessionId: e.body.sessionId }).expect(201);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.body.paymentId } });

    const raw = JSON.stringify({ id: 'evt_fixed_1', type: 'payment.succeeded', orderId: payment.providerOrderId, paymentId: 'pay_1', amountMinor: payment.amountMinor, method: 'UPI' });
    const { SandboxProvider } = await import('../src/payments/providers');
    const sig = SandboxProvider.sign(raw);
    const send = () => request(app.getHttpServer()).post('/v1/payments/webhooks/sandbox').set('content-type', 'application/json').set('x-sandbox-signature', sig).send(raw);
    expect((await send().expect(200)).body).toEqual({ ok: true });
    expect((await send().expect(200)).body).toEqual({ ok: true, duplicate: true });
    const s = await prisma.parkingSession.findUniqueOrThrow({ where: { id: e.body.sessionId } });
    expect(s.amountPaidMinor).toBe(payment.amountMinor); // credited once
    expect(await prisma.financialLedgerEntry.count({ where: { refId: payment.id } })).toBe(2);
  });

  it('ledger rows are immutable', async () => {
    await expect(prisma.financialLedgerEntry.updateMany({ data: { memo: 'tamper' } })).rejects.toThrow(/append-only/);
  });
});

describe('Hardware', () => {
  it('barrier offline: session still created, command FAILED and alert raised', async () => {
    const barrier = await prisma.hardwareDevice.findFirstOrThrow({ where: { gateId: op.entryGate.id, kind: 'BARRIER' } });
    await prisma.hardwareDevice.update({ where: { id: barrier.id }, data: { config: { simulate: 'offline' } } });
    const g = authed(app, gateToken, op.tenant.id);
    const e = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, gateId: op.entryGate.id, credential: { type: 'PLATE_MANUAL', plate: 'AP09CD1111' }, vehicleClass: 'CAR' }).expect(201);
    expect(e.body.status).toBe('ACTIVE');
    expect(e.body.barrier).toMatchObject({ status: 'FAILED', error: 'DEVICE_UNREACHABLE' });
    expect(await prisma.hardwareAlert.count({ where: { deviceId: barrier.id, code: 'BARRIER_COMMAND_FAILED' } })).toBe(1);
    expect((await prisma.parkingGate.findUniqueOrThrow({ where: { id: op.entryGate.id } })).status).toBe('DEGRADED');
    await prisma.hardwareDevice.update({ where: { id: barrier.id }, data: { config: { simulate: 'ok' } } });
    await prisma.parkingGate.update({ where: { id: op.entryGate.id }, data: { status: 'ONLINE' } });
  });

  it('ANPR: signed device auth, low confidence → manual review (no barrier), high confidence → entry, duplicates suppressed', async () => {
    const cam = await prisma.hardwareDevice.findFirstOrThrow({ where: { gateId: op.entryGate.id, kind: 'ANPR_CAMERA' } });
    const owner = authed(app, ownerToken, op.tenant.id);
    const cred = await owner.post(`/v1/devices/${cam.id}/credentials`).expect(201);
    const { hmacSha256 } = await import('../src/common/crypto');
    const send = (body: object, opts: { badSig?: boolean } = {}) => {
      const raw = JSON.stringify(body);
      const ts = Date.now();
      return request(app.getHttpServer()).post('/v1/devices/events').set('content-type', 'application/json')
        .set('x-device-key', cred.body.keyId).set('x-timestamp', String(ts)).set('x-signature', opts.badSig ? '00'.repeat(32) : hmacSha256(cred.body.secret, `${ts}.${raw}`)).send(raw);
    };
    await send({ type: 'HEARTBEAT', eventId: 'hb-1', occurredAt: new Date() }, { badSig: true }).expect(401);

    SimulatorLog.clear();
    await prisma.vehicle.create({ data: { plateNormalized: 'KA03ZZ5555', plateDisplay: 'KA 03 ZZ 5555', vehicleClass: 'CAR' } });
    const low = await send({ type: 'ANPR', eventId: 'anpr-1', occurredAt: new Date(), direction: 'ENTRY', plate: 'KA03ZZ5555', confidence: 0.62 }).expect(200);
    expect(low.body.result.action).toBe('MANUAL_REVIEW');
    expect(SimulatorLog.entries).toHaveLength(0);
    expect(await prisma.parkingSession.count({ where: { plateNormalized: 'KA03ZZ5555' } })).toBe(0);

    const again = await send({ type: 'ANPR', eventId: 'anpr-1', occurredAt: new Date(), direction: 'ENTRY', plate: 'KA03ZZ5555', confidence: 0.62 }).expect(200);
    expect(again.body.duplicate).toBe(true);

    // Supervisor reviews and confirms → entry happens
    const sup = authed(app, supervisorToken, op.tenant.id);
    const queue = await sup.get(`/v1/devices/anpr/review-queue?facilityId=${op.facility.id}`).expect(200);
    expect(queue.body[0].plateNormalized).toBe('KA03ZZ5555');
    const reviewed = await sup.post(`/v1/devices/anpr/${queue.body[0].id}/review`).send({ decision: 'CONFIRM' }).expect(201);
    expect(reviewed.body.result.action).toBe('ENTRY_CREATED');

    const high = await send({ type: 'ANPR', eventId: 'anpr-2', occurredAt: new Date(), direction: 'ENTRY', plate: 'KA04YY6666', confidence: 0.97 }).expect(200);
    // Unknown vehicle class → staff attention, never auto-open
    expect(high.body.result.action).toBe('STAFF_ATTENTION');
    expect(high.body.result.code).toBe('VEHICLE_CLASS_REQUIRED');
  });
});

describe('Capacity & overbooking', () => {
  it('concurrent walk-ins never exceed capacity', async () => {
    const small = await setupOperator('tiny-lot', { carCapacity: 3 });
    const t = await login(app, 'gate+owner@tiny-lot.test');
    const g = authed(app, t, small.tenant.id);
    const plates = ['KA01AA0001', 'KA01AA0002', 'KA01AA0003', 'KA01AA0004', 'KA01AA0005', 'KA01AA0006'];
    const results = await Promise.all(plates.map((p) => g.post('/v1/gate/entry', key()).send({ facilityId: small.facility.id, credential: { type: 'PLATE_MANUAL', plate: p }, vehicleClass: 'CAR' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'FACILITY_FULL')).toBe(true);
    const pool = await prisma.parkingCapacityPool.findUniqueOrThrow({ where: { facilityId_vehicleClass: { facilityId: small.facility.id, vehicleClass: 'CAR' } } });
    expect(pool.occupied).toBe(3);
  });

  it('expired reservation is refused at the gate', async () => {
    const cust = await customerLogin(app);
    const c = authed(app, cust.token);
    const v = await c.post('/v1/me/vehicles').send({ plate: 'GJ01KK2222', vehicleClass: 'CAR' }).expect(201);
    const startsAt = new Date(Date.now() + 60_000);
    const r = await c.post('/v1/me/reservations').send({ facilityId: op.facility.id, vehicleId: v.body.vehicleId, startsAt, endsAt: new Date(startsAt.getTime() + 3600_000) }).expect(201);
    const o = await c.post('/v1/payments/orders').send({ purpose: 'RESERVATION', reservationId: r.body.id }).expect(201);
    await c.post('/v1/payments/sandbox/simulate').send({ orderId: o.body.checkout.orderId }).expect(200);
    const qr = (await c.get(`/v1/me/reservations/${r.body.id}`)).body.qrToken;
    await prisma.parkingReservation.update({ where: { id: r.body.id }, data: { startsAt: new Date(Date.now() - 3 * 3600_000), endsAt: new Date(Date.now() - 3600_000) } });
    const g = authed(app, gateToken, op.tenant.id);
    const res = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'QR', token: qr } });
    expect(['RESERVATION_EXPIRED', 'QR_EXPIRED']).toContain(res.body.code);
  });
});

describe('Security', () => {
  it('blocks cross-tenant access', async () => {
    const other = await setupOperator('rival-park');
    const rivalOwner = await login(app, 'owner@rival-park.test');
    // Rival owner using skyline tenant header → not a member
    const r1 = await authed(app, rivalOwner, op.tenant.id).get('/v1/facilities').expect(403);
    expect(r1.body.code).toBe('FORBIDDEN');
    // Rival owner, own tenant header, but skyline facility id → not found
    await authed(app, rivalOwner, other.tenant.id).get(`/v1/facilities/${op.facility.id}`).expect(404);
    const e = await authed(app, rivalOwner, other.tenant.id).post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA01ZZ0001' }, vehicleClass: 'CAR' });
    expect(e.status).toBe(404);
    // Customers cannot call staff endpoints
    const cust = await customerLogin(app);
    await authed(app, cust.token, op.tenant.id).get('/v1/sessions').expect(403);
  });

  it('gate attendant cannot approve overrides; requester cannot self-approve', async () => {
    const g = authed(app, gateToken, op.tenant.id);
    const e = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'UP16AB1010' }, vehicleClass: 'CAR' }).expect(201);
    await backdateSession(e.body.sessionId, 120);
    await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'UP16AB1010' } }).expect(200);
    const o = await g.post('/v1/overrides').send({ facilityId: op.facility.id, type: 'FEE_WAIVER', sessionId: e.body.sessionId, reason: 'Hospital emergency' }).expect(201);
    await g.post(`/v1/overrides/${o.body.id}/approve`).expect(403);
    const sup = authed(app, supervisorToken, op.tenant.id);
    const o2 = await sup.post('/v1/overrides').send({ facilityId: op.facility.id, type: 'FEE_WAIVER', sessionId: e.body.sessionId, reason: 'Self approval attempt' }).expect(201);
    await sup.post(`/v1/overrides/${o2.body.id}/approve`).expect(403);
    const ok = await sup.post(`/v1/overrides/${o.body.id}/approve`).expect(201);
    expect(ok.body.status).toBe('EXECUTED');
    const after = await g.post('/v1/gate/exit/quote').send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'UP16AB1010' } }).expect(200);
    expect(after.body.outstandingMinor).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: o.body.id } })).toBeGreaterThanOrEqual(2);
  });

  it('refresh token rotation detects reuse and revokes the family', async () => {
    const cust = await customerLogin(app);
    const r1 = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: cust.refreshToken }).expect(200);
    const reuse = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: cust.refreshToken }).expect(401);
    expect(reuse.body.code).toBe('REFRESH_REUSED');
    // The rotated token is also dead now
    await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await authed(app, r1.body.accessToken).get('/v1/auth/me').expect(401);
  });

  it('OTP brute force is locked after 5 attempts', async () => {
    const phone = '+919811112222';
    await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ phone }).expect(200);
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/v1/auth/otp/verify').send({ phone, code: '000000' }).expect((r) => expect([400]).toContain(r.status));
    const locked = await request(app.getHttpServer()).post('/v1/auth/otp/verify').send({ phone, code: '000000' }).expect(429);
    expect(locked.body.code).toBe('OTP_LOCKED');
  });
});
