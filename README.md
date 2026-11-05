# Park2All — Smart Mobility & Parking SaaS

Multi-tenant parking management: operators, gates, slots, sessions, pricing, reservations, payments and hardware.

- Architecture & workflows: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What's built, tested, and pending: [`docs/IMPLEMENTATION_CHECKLIST.md`](docs/IMPLEMENTATION_CHECKLIST.md)
- Deploying to https://park.2all.co.in: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — `npm run deploy` pushes `main`; GitHub Actions tests, builds and deploys to the VPS

## Quick start

```bash
pnpm install
pnpm dev:infra                                  # Postgres :57432, Redis :57379
cd apps/api && cp .env.example .env
pnpm prisma migrate deploy && pnpm db:seed      # prints demo logins
pnpm build && pnpm start                        # API :4100, Swagger at /docs
cd ../operator-web && cp .env.example .env.local && pnpm build && pnpm start   # :3101
cd ../booking-web && cp .env.example .env.local && pnpm build && pnpm start    # :3104 public booking site
```

Demo password for all seeded staff: `Park2All@Demo123` (dev only; seed refuses to run in production).

## Tests

```bash
docker exec park2all-dev-postgres-1 psql -U park2all -c 'CREATE DATABASE park2all_test'   # once
cd apps/api
DATABASE_URL=postgresql://park2all:park2all@127.0.0.1:57432/park2all_test npx prisma migrate deploy
pnpm test     # unit + e2e (uses .env.test → park2all_test)
```

## Staff app (Flutter)

```bash
cd apps/staff-app
flutter test
flutter run -d chrome --dart-define=API_URL=http://localhost:4100 --web-port 3102     # web
flutter run --dart-define=API_URL=http://10.0.2.2:4100                                # Android emulator
```

Shared packages: `flutter-packages/design-system` (p2a_design), `flutter-packages/core` (p2a_core).

## Customer app (Flutter)

```bash
cd apps/customer-app
flutter test
flutter run -d chrome --dart-define=API_URL=http://localhost:4100 --web-port 3103
```

In development the API returns the OTP in the response (`devCode`) and the apps show it; production refuses `OTP_PROVIDER=console`.
Payments use the in-repo sandbox provider: success is only ever recorded from a signed webhook.
