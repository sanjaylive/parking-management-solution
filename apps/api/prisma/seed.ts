import { PrismaClient } from '@prisma/client';
import { ensureUser, seedBase, seedOperator } from './seed-lib';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_PROVIDERS !== 'true') throw new Error('Demo seed only runs in development or on a staging box with ALLOW_SANDBOX_PROVIDERS=true.');
  // The default demo password is public (it's in this repo), so a deployed staging box must supply its own.
  if (process.env.NODE_ENV === 'production' && (!process.env.SEED_PASSWORD || process.env.SEED_PASSWORD.length < 12)) {
    throw new Error('Set SEED_PASSWORD (12+ chars) to seed a deployed environment; the default demo password is public.');
  }
  const password = process.env.SEED_PASSWORD ?? 'Park2All@Demo123';
  await seedBase(prisma);

  const admin = await ensureUser(prisma, { email: 'admin@park2all.local', name: 'Platform Admin', password, kind: 'PLATFORM' });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'PLATFORM_ADMIN' } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } }, update: {}, create: { userId: admin.id, roleId: adminRole.id } });

  const a = await seedOperator(prisma, { slug: 'skyline-parking', name: 'Skyline Parking Co.', facilityCode: 'SKYMALL', facilityName: 'Skyline Mall Parking', lat: 12.9716, lng: 77.5946, ownerEmail: 'owner@skyline.local', password, slotBased: true, carCapacity: 60 });
  await seedOperator(prisma, { slug: 'metro-park', name: 'MetroPark Services', facilityCode: 'MGROAD', facilityName: 'MG Road Multilevel', lat: 12.9756, lng: 77.6066, ownerEmail: 'owner@metropark.local', password });

  await ensureUser(prisma, { phone: '+919900000001', name: 'Demo Customer', kind: 'CUSTOMER' });

  console.log(`Seeded.
  Super admin:    admin@park2all.local / ${password}
  Operator owner: owner@skyline.local / ${password}   (tenant ${a.tenant.id})
  Gate attendant: gate+owner@skyline.local / ${password}
  Supervisor:     supervisor+owner@skyline.local / ${password}
  Customer OTP:   +919900000001 (dev OTP is returned in API response and logged)`);
}

main().finally(() => prisma.$disconnect());
