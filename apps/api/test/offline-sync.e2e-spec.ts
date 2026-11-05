import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { calculatePrice, parseRateDefinition } from '../src/pricing/engine';
import { SimulatorLog } from '../src/hardware/simulator';
import { DEFAULT_RATE } from '../prisma/seed-lib';
import { authed, createApp, key, login, prisma, resetDb, setupOperator } from './helpers';

jest.setTimeout(60_000);

let app: INestApplication;
let op: Awaited<ReturnType<typeof setupOperator>>;
let g: ReturnType<typeof authed>;
let sup: ReturnType<typeof authed>;

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const fee = (entry: string, exit: string) => calculatePrice({ definition: parseRateDefinition(DEFAULT_RATE), timezone: 'Asia/Kolkata', entryAt: new Date(entry), exitAt: new Date(exit) }).netMinor;
const pool = () => prisma.parkingCapacityPool.findUniqueOrThrow({ where: { facilityId_vehicleClass: { facilityId: op.facility.id, vehicleClass: 'CAR' } } });

beforeAll(async () => {
  await resetDb();
  app = await createApp();
  op = await setupOperator('offline-lot', { carCapacity: 2, slotBased: true });
  g = authed(app, await login(app, 'gate+owner@offline-lot.test'), op.tenant.id);
  sup = authed(app, await login(app, 'supervisor+owner@offline-lot.test'), op.tenant.id);
  await g.post('/v1/shifts/open').send({ facilityId: op.facility.id }).expect(201);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Offline sync', () => {
  it('gate config exposes offline limits', async () => {
    const c = await g.get(`/v1/gate/config?facilityId=${op.facility.id}`).expect(200);
    expect(c.body.offlineMaxProvisionalEntries).toBe(50);
    expect(c.body.gates.length).toBe(2);
    expect(c.body.permissions).toContain('session.entry');
  });

  it('applies entry + paid exit at original times, no barrier, and is idempotent on replay', async () => {
    const entryAt = minsAgo(180);
    const exitAt = minsAgo(60);
    const due = fee(entryAt, exitAt);
    expect(due).toBeGreaterThan(0);
    const batch = {
      facilityId: op.facility.id,
      events: [
        // deliberately out of order: server sorts by occurredAt
        { type: 'EXIT', localId: 'loc-' + randomUUID(), occurredAt: exitAt, plate: 'KA01OF0001', cashCollectedMinor: due, gateId: op.exitGate.id },
        { type: 'ENTRY', localId: 'loc-' + randomUUID(), occurredAt: entryAt, plate: 'KA01OF0001', vehicleClass: 'CAR', gateId: op.entryGate.id },
      ],
    };
    SimulatorLog.clear();
    const r = await g.post('/v1/gate/offline-sync').send(batch).expect(200);
    expect(r.body.results.map((x: any) => [x.type, x.status])).toEqual([['ENTRY', 'ACCEPTED'], ['EXIT', 'ACCEPTED']]);
    expect(SimulatorLog.entries).toHaveLength(0); // never actuates hardware for past events

    const s = await prisma.parkingSession.findUniqueOrThrow({ where: { id: r.body.results[0].sessionId } });
    expect(s.status).toBe('COMPLETED');
    expect(s.isProvisional).toBe(true);
    expect(s.entryAt.toISOString()).toBe(entryAt);
    expect(s.exitAt!.toISOString()).toBe(exitAt);
    expect(s.amountPaidMinor).toBe(due);
    expect(await prisma.parkingAssignment.count({ where: { sessionId: s.id } })).toBe(0); // no guessed slot
    expect((await pool()).occupied).toBe(0);

    const replay = await g.post('/v1/gate/offline-sync').send(batch).expect(200);
    expect(replay.body.results.every((x: any) => x.status === 'DUPLICATE')).toBe(true);
    expect(await prisma.payment.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it('underpaid offline exit → EXCEPTION for review, capacity released, plate may re-enter', async () => {
    const entryAt = minsAgo(240);
    const exitAt = minsAgo(30);
    const due = fee(entryAt, exitAt);
    const r = await g.post('/v1/gate/offline-sync').send({
      facilityId: op.facility.id,
      events: [
        { type: 'ENTRY', localId: 'loc-' + randomUUID(), occurredAt: entryAt, plate: 'KA01OF0002', vehicleClass: 'CAR' },
        { type: 'EXIT', localId: 'loc-' + randomUUID(), occurredAt: exitAt, plate: 'KA01OF0002', cashCollectedMinor: 5000 },
      ],
    }).expect(200);
    const exit = r.body.results[1];
    expect(exit).toMatchObject({ status: 'NEEDS_REVIEW', code: 'OFFLINE_EXIT_UNPAID', outstandingMinor: due - 5000 });
    const s = await prisma.parkingSession.findUniqueOrThrow({ where: { id: exit.sessionId } });
    expect(s.status).toBe('EXCEPTION');
    expect(s.amountPaidMinor).toBe(5000);
    expect((await pool()).occupied).toBe(0);

    // The same car can come back in — an exited EXCEPTION session must not block it
    await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA01OF0002' }, vehicleClass: 'CAR' }).expect(201);

    const review = await sup.get(`/v1/gate/offline-sync/review?facilityId=${op.facility.id}`).expect(200);
    expect(review.body.items.some((i: any) => i.code === 'OFFLINE_EXIT_UNPAID')).toBe(true);
    expect(review.body.exceptionSessions.map((x: any) => x.id)).toContain(s.id);
  });

  it('reports conflicts instead of dropping them, and lets provisional entries exceed live capacity', async () => {
    // capacity 2; KA01OF0002 is inside. Fill the last space live, then sync an offline entry.
    await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA01OF0003' }, vehicleClass: 'CAR' }).expect(201);
    expect((await pool()).occupied).toBe(2);
    const r = await g.post('/v1/gate/offline-sync').send({
      facilityId: op.facility.id,
      events: [
        { type: 'ENTRY', localId: 'loc-' + randomUUID(), occurredAt: minsAgo(20), plate: 'KA01OF0004', vehicleClass: 'CAR' },
        { type: 'ENTRY', localId: 'loc-' + randomUUID(), occurredAt: minsAgo(15), plate: 'KA01OF0003', vehicleClass: 'CAR' }, // already inside
        { type: 'EXIT', localId: 'loc-' + randomUUID(), occurredAt: minsAgo(10), plate: 'KA01NO9999' }, // never entered
      ],
    }).expect(200);
    expect(r.body.results.map((x: any) => x.status)).toEqual(['ACCEPTED', 'CONFLICT', 'CONFLICT']);
    expect(r.body.results[1].code).toBe('DUPLICATE_ACTIVE_SESSION');
    expect(r.body.results[2].code).toBe('SESSION_NOT_FOUND');
    expect(r.body.summary).toEqual({ accepted: 1, duplicates: 0, needsAttention: 2 });
    // Over capacity is allowed for provisional entries (the car is physically inside) — dashboards must show it
    const p = await pool();
    expect(p.occupied).toBe(3);
    // A live walk-in is still refused while over capacity
    const full = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA01OF0005' }, vehicleClass: 'CAR' }).expect(409);
    expect(full.body.code).toBe('FACILITY_FULL');
  });

  it('rejects events older than 72h and validates payloads', async () => {
    const r = await g.post('/v1/gate/offline-sync').send({ facilityId: op.facility.id, events: [{ type: 'ENTRY', localId: 'loc-' + randomUUID(), occurredAt: minsAgo(73 * 60), plate: 'KA01OF0006', vehicleClass: 'CAR' }] }).expect(200);
    expect(r.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'EVENT_TOO_OLD' });
    await g.post('/v1/gate/offline-sync').send({ facilityId: op.facility.id, events: [{ type: 'PAY_UPI', localId: 'x' }] }).expect(400);
  });
});
