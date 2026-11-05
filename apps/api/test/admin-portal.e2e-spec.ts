import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ensureUser } from '../prisma/seed-lib';
import { authed, createApp, login, PASSWORD, prisma, resetDb, setupOperator } from './helpers';

jest.setTimeout(60_000);

let app: INestApplication;
let op: Awaited<ReturnType<typeof setupOperator>>;
let adminToken: string;
let ownerToken: string;

beforeAll(async () => {
  await resetDb();
  app = await createApp();
  op = await setupOperator('acme');
  const admin = await ensureUser(prisma, { email: 'admin@platform.test', name: 'Root', password: PASSWORD, kind: 'PLATFORM' });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'PLATFORM_ADMIN' } });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
  adminToken = await login(app, 'admin@platform.test');
  ownerToken = await login(app, 'owner@acme.test');
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Settings', () => {
  it('returns defaults, validates and saves a group, and exposes the brand publicly', async () => {
    const a = authed(app, adminToken);
    const all = await a.get('/v1/admin/settings').expect(200);
    expect(all.body.brand.platformName).toBe('Park2All');
    expect(all.body.security.passwordMinLength).toBe(10);

    await a.put('/v1/admin/settings/brand').send({ ...all.body.brand, primaryColor: 'blue' }).expect(400);
    await a.put('/v1/admin/settings/nope').send({}).expect(404);
    await a.put('/v1/admin/settings/operators').send({ defaultPlanCode: 'MISSING', defaultTrialDays: 7 }).expect(400);
    const saved = await a.put('/v1/admin/settings/brand').send({ ...all.body.brand, platformName: 'ParkCo', primaryColor: '#112233' }).expect(200);
    expect(saved.body.platformName).toBe('ParkCo');

    const pub = await request(app.getHttpServer()).get('/v1/public/brand').expect(200);
    expect(pub.body).toMatchObject({ platformName: 'ParkCo', primaryColor: '#112233' });

    await authed(app, ownerToken).get('/v1/admin/settings').expect(403);
    await authed(app, ownerToken).put('/v1/admin/settings/brand').send(saved.body).expect(403);
  });
});

describe('Notifications', () => {
  it('notifies on onboarding and status change, and supports read/unread/delete per user', async () => {
    const a = authed(app, adminToken);
    const t = await a.post('/v1/admin/tenants').send({
      name: 'Beta Parks', slug: 'beta-parks', contactEmail: 'ops@beta.test', planCode: 'STARTER', trialDays: 7,
      owner: { name: 'Beta Owner', email: 'owner@beta.test', password: 'short-pw' },
    }).expect(400); // below the 10-character minimum from Settings → Security
    expect(t.body.code).toBe('WEAK_PASSWORD');
    const created = await a.post('/v1/admin/tenants').send({
      name: 'Beta Parks', slug: 'beta-parks', contactEmail: 'ops@beta.test', planCode: 'STARTER', trialDays: 7,
      owner: { name: 'Beta Owner', email: 'owner@beta.test', password: PASSWORD },
    }).expect(201);
    await a.post('/v1/admin/tenants').send({
      name: 'Beta Again', slug: 'beta-parks', contactEmail: 'ops@beta.test', planCode: 'STARTER', trialDays: 7,
      owner: { name: 'Other Owner', email: 'x@beta.test', password: PASSWORD },
    }).expect(409);

    const mine = await a.get('/v1/notifications').expect(200);
    expect(mine.body.items[0]).toMatchObject({ title: 'New operator onboarded', type: 'operator', severity: 'success', link: `/admin/operators/${created.body.id}`, readAt: null });

    const betaOwner = authed(app, await login(app, 'owner@beta.test'));
    const welcome = await betaOwner.get('/v1/notifications').expect(200);
    expect(welcome.body.items[0].title).toBe('Welcome to ParkCo');

    await a.patch(`/v1/admin/tenants/${created.body.id}/status`).send({ status: 'SUSPENDED', reason: 'Unpaid invoice' }).expect(200);
    const after = await betaOwner.get('/v1/notifications?filter=unread').expect(200);
    expect(after.body.items[0]).toMatchObject({ title: 'Your account is now suspended', type: 'billing', severity: 'critical' });
    expect((await betaOwner.get('/v1/notifications/unread-count').expect(200)).body.count).toBe(2);

    // read / unread / read-all / delete, and no access to someone else's notification
    const n = after.body.items[0];
    await betaOwner.post(`/v1/notifications/${n.id}/read`).expect(200);
    expect((await betaOwner.get('/v1/notifications/unread-count')).body.count).toBe(1);
    await betaOwner.post(`/v1/notifications/${n.id}/read?unread=true`).expect(200);
    await a.post(`/v1/notifications/${n.id}/read`).expect(404);
    await a.delete(`/v1/notifications/${n.id}`).expect(404);
    await betaOwner.post('/v1/notifications/read-all').expect(200);
    expect((await betaOwner.get('/v1/notifications/unread-count')).body.count).toBe(0);
    await betaOwner.delete(`/v1/notifications/${n.id}`).expect(204);
    expect((await betaOwner.get('/v1/notifications')).body.items.find((x: any) => x.id === n.id)).toBeUndefined();

    // settings toggle switches the platform event off
    const s = (await a.get('/v1/admin/settings')).body.notifications;
    await a.put('/v1/admin/settings/notifications').send({ ...s, operatorStatusChanged: false }).expect(200);
    const before = (await a.get('/v1/notifications/unread-count')).body.count;
    await a.patch(`/v1/admin/tenants/${created.body.id}/status`).send({ status: 'ACTIVE', reason: 'Paid' }).expect(200);
    expect((await a.get('/v1/notifications/unread-count')).body.count).toBe(before);
  });

  it('broadcasts announcements to operator owners and managers only', async () => {
    const a = authed(app, adminToken);
    await a.post('/v1/admin/notifications/broadcast').send({ audience: 'tenant', title: 'Hi', body: 'Missing tenant id' }).expect(400);
    const r = await a.post('/v1/admin/notifications/broadcast').send({ audience: 'tenant', tenantId: op.tenant.id, title: 'Maintenance tonight', body: 'The console will be briefly unavailable at 02:00.', severity: 'warning' }).expect(201);
    expect(r.body.sent).toBe(2); // owner + manager of acme
    const owner = await authed(app, ownerToken).get('/v1/notifications?type=announcement').expect(200);
    expect(owner.body.items[0]).toMatchObject({ title: 'Maintenance tonight', type: 'announcement', severity: 'warning' });
    const gate = await authed(app, await login(app, 'gate+owner@acme.test')).get('/v1/notifications').expect(200);
    expect(gate.body.items).toHaveLength(0);
    await authed(app, ownerToken).post('/v1/admin/notifications/broadcast').send({ audience: 'all_operators', title: 'Nope', body: 'Not allowed' }).expect(403);
  });
});

describe('Profile', () => {
  it('updates the name and changes the password, signing out other sessions', async () => {
    const t1 = await login(app, 'owner@acme.test');
    const other = await request(app.getHttpServer()).post('/v1/auth/login').send({ identifier: 'owner@acme.test', password: PASSWORD }).expect(200);
    const me = authed(app, t1);
    await me.patch('/v1/auth/me').send({ name: 'A' }).expect(400);
    expect((await me.patch('/v1/auth/me').send({ name: 'Acme Boss' }).expect(200)).body.name).toBe('Acme Boss');

    expect((await me.get('/v1/auth/sessions').expect(200)).body.filter((s: any) => s.current)).toHaveLength(1);
    await me.post('/v1/auth/password').send({ currentPassword: 'wrong-password', newPassword: 'NewPassword#456' }).expect(400);
    await me.post('/v1/auth/password').send({ currentPassword: PASSWORD, newPassword: 'short1234' }).expect(400);
    await me.post('/v1/auth/password').send({ currentPassword: PASSWORD, newPassword: 'NewPassword#456' }).expect(200);

    await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/v1/auth/login').send({ identifier: 'owner@acme.test', password: 'NewPassword#456' }).expect(200);
    const sec = await me.get('/v1/notifications?type=security').expect(200);
    expect(sec.body.items[0].title).toBe('Password changed');
  });
});
