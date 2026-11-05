import { INestApplication } from '@nestjs/common';
import { authed, backdateSession, createApp, customerLogin, key, login, prisma, resetDb, setupOperator } from './helpers';

jest.setTimeout(60_000);
let app: INestApplication;
let op: Awaited<ReturnType<typeof setupOperator>>;

beforeAll(async () => {
  await resetDb();
  app = await createApp();
  op = await setupOperator('checkout-lot');
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

it('customer sees live charge, pays in-app, exits without paying again; others cannot see the session', async () => {
  const cust = await customerLogin(app);
  const c = authed(app, cust.token);
  await c.post('/v1/me/vehicles').send({ plate: 'KA02CU1234', vehicleClass: 'CAR' }).expect(201);

  const g = authed(app, await login(app, 'gate+owner@checkout-lot.test'), op.tenant.id);
  const entry = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, gateId: op.entryGate.id, credential: { type: 'PLATE_MANUAL', plate: 'KA02CU1234' }, vehicleClass: 'CAR' }).expect(201);
  await backdateSession(entry.body.sessionId, 95);

  const est = await c.get(`/v1/me/sessions/${entry.body.sessionId}/estimate`).expect(200);
  expect(est.body.outstandingMinor).toBeGreaterThan(0);
  // Read-only: no status change, nothing persisted
  expect((await prisma.parkingSession.findUniqueOrThrow({ where: { id: entry.body.sessionId } })).status).toBe('ACTIVE');
  expect(await prisma.parkingFeeCalculation.count({ where: { sessionId: entry.body.sessionId } })).toBe(0);

  const other = await customerLogin(app);
  await authed(app, other.token).get(`/v1/me/sessions/${entry.body.sessionId}/estimate`).expect(404);
  await authed(app, other.token).post(`/v1/me/sessions/${entry.body.sessionId}/checkout`).expect(404);

  const co = await c.post(`/v1/me/sessions/${entry.body.sessionId}/checkout`).expect(200);
  expect(co.body.status).toBe('PAYMENT_REQUIRED');
  expect(co.body.order.amountMinor).toBe(co.body.quote.outstandingMinor);
  expect(co.body.exitWithinMinutes).toBe(10);

  // Double tap reuses the same open order (no duplicate charge)
  const co2 = await c.post(`/v1/me/sessions/${entry.body.sessionId}/checkout`).expect(200);
  expect(co2.body.order.paymentId).toBe(co.body.order.paymentId);

  await c.post('/v1/payments/sandbox/simulate').send({ orderId: co.body.order.checkout.orderId }).expect(200);
  const paid = await c.get(`/v1/me/sessions/${entry.body.sessionId}/estimate`).expect(200);
  expect(paid.body.outstandingMinor).toBe(0);

  const exit = await g.post('/v1/gate/exit/confirm', key()).send({ facilityId: op.facility.id, gateId: op.exitGate.id, credential: { type: 'PLATE_MANUAL', plate: 'KA02CU1234' } }).expect(200);
  expect(exit.body.status).toBe('COMPLETED');
  expect(exit.body.receipt.totalMinor).toBe(co.body.quote.totalMinor);
  await c.get(`/v1/me/sessions/${entry.body.sessionId}/estimate`).expect(409);
});

it("a previous owner's finished stays are hidden from the new owner", async () => {
  const g = authed(app, await login(app, 'gate+owner@checkout-lot.test'), op.tenant.id);
  const e = await g.post('/v1/gate/entry', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA02OLD999' }, vehicleClass: 'CAR' }).expect(201);
  await g.post('/v1/gate/exit/confirm', key()).send({ facilityId: op.facility.id, credential: { type: 'PLATE_MANUAL', plate: 'KA02OLD999' } }).expect(200);
  await new Promise((r) => setTimeout(r, 20));
  const buyer = await customerLogin(app);
  const b = authed(app, buyer.token);
  await b.post('/v1/me/vehicles').send({ plate: 'KA02OLD999', vehicleClass: 'CAR' }).expect(201);
  expect((await b.get('/v1/me/sessions').expect(200)).body).toHaveLength(0);
  await b.get(`/v1/me/sessions/${e.body.sessionId}/estimate`).expect(404);
});
