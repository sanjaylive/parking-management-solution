import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { seedBase, seedOperator } from '../prisma/seed-lib';

export const PASSWORD = 'TestPassword#123';
export const prisma = new PrismaClient();

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses row-level append-only triggers (statement-level op) — test DB only.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export async function login(app: INestApplication, identifier: string) {
  const r = await request(app.getHttpServer()).post('/v1/auth/login').send({ identifier, password: PASSWORD }).expect(200);
  return r.body.accessToken as string;
}

let phoneCounter = 0;
export async function customerLogin(app: INestApplication) {
  const phone = `+9198${String(Date.now()).slice(-6)}${String(++phoneCounter).padStart(2, '0')}`;
  const r1 = await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const r2 = await request(app.getHttpServer()).post('/v1/auth/otp/verify').send({ phone, code: r1.body.devCode }).expect(200);
  return { token: r2.body.accessToken as string, refreshToken: r2.body.refreshToken as string, userId: r2.body.user.id as string, phone, isNewUser: r2.body.isNewUser };
}

export async function setupOperator(slug: string, opts: { carCapacity?: number; slotBased?: boolean } = {}) {
  await seedBase(prisma);
  return seedOperator(prisma, {
    slug, name: slug, facilityCode: slug.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase(), facilityName: `${slug} facility`, lat: 12.97, lng: 77.59,
    ownerEmail: `owner@${slug}.test`, password: PASSWORD, ...opts,
  });
}

export const authed = (app: INestApplication, token: string, tenantId?: string) => {
  const agent = request(app.getHttpServer());
  const h = (r: request.Test) => {
    r.set('authorization', `Bearer ${token}`);
    if (tenantId) r.set('x-tenant-id', tenantId);
    return r;
  };
  return {
    get: (u: string) => h(agent.get(u)),
    post: (u: string, idemKey?: string) => {
      const r = h(agent.post(u));
      if (idemKey) r.set('idempotency-key', idemKey);
      return r;
    },
    patch: (u: string) => h(agent.patch(u)),
    put: (u: string) => h(agent.put(u)),
    delete: (u: string) => h(agent.delete(u)),
  };
};

export const key = () => 'k-' + Math.random().toString(36).slice(2);

/** Simulate time passing for a session (tests only). */
export async function backdateSession(sessionId: string, minutes: number) {
  const s = await prisma.parkingSession.findUniqueOrThrow({ where: { id: sessionId } });
  await prisma.parkingSession.update({ where: { id: sessionId }, data: { entryAt: new Date(s.entryAt.getTime() - minutes * 60_000) } });
}
