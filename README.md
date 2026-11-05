# Park2All — Smart Mobility & Parking SaaS

Multi-tenant parking management: operators, gates, slots, sessions, pricing, reservations, payments and hardware.

- Architecture & workflows: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What's built, tested, and pending: [`docs/IMPLEMENTATION_CHECKLIST.md`](docs/IMPLEMENTATION_CHECKLIST.md)

## Quick start

```bash
pnpm install
pnpm dev:infra                                  # Postgres :57432, Redis :57379
cd apps/api && cp .env.example .env
pnpm prisma migrate deploy && pnpm db:seed      # prints demo logins
pnpm build && pnpm start                        # API :4100, Swagger at /docs
cd ../operator-web && cp .env.example .env.local && pnpm build && pnpm start   # :3101
```

Demo password for all seeded staff: `Park2All@Demo123` (dev only; seed refuses to run in production).

## Tests

```bash
docker exec park2all-dev-postgres-1 psql -U park2all -c 'CREATE DATABASE park2all_test'   # once
cd apps/api
DATABASE_URL=postgresql://park2all:park2all@127.0.0.1:57432/park2all_test npx prisma migrate deploy
pnpm test     # unit + e2e (uses .env.test → park2all_test)
```
