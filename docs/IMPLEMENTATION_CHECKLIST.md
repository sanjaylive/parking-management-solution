# Park2All — Implementation Checklist

Legend: ✅ built & tested · 🟡 built, partial or untested · ⬜ not started · 🔒 pending external credentials/hardware

_Last updated: 2026-11-05_

## Verification status

| Check | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | ✅ clean |
| API unit tests (pricing engine, plates) | ✅ 27/27 |
| API e2e tests (real Postgres) | ✅ 14/14 |
| API production build + boot | ✅ `/health` ok, Swagger at `/docs` |
| Operator web typecheck + `next build` | ✅ clean |
| Operator web manual browser run | ✅ login → dashboard → entry → exit quote → cash → exit → slot released; dark mode |
| Operator web automated tests | ⬜ none yet |

## Phase 1 — Architecture, monorepo, database, auth, design system
- ✅ `docs/ARCHITECTURE.md`: architecture, ERD, schema plan, screen maps, entry/exit + reservation workflows, SaaS, hardware, API outline
- ✅ pnpm monorepo, Docker dev infra (Postgres 17 :57432, Redis 7 :57379)
- ✅ Prisma schema across all 15 domains + SQL safeguards (one-active-session partial index, capacity CHECKs, append-only ledger/audit triggers)
- ✅ OTP login (rate limits, cooldown, attempt lockout, hashed codes), password login, JWT + refresh rotation with reuse detection
- ✅ RBAC (permission catalog, 8 roles), tenant isolation guard, facility-scoped membership
- 🟡 Web design system (tokens, light/dark, MetricCard, OccupancyRing, VehicleNumberPlate, SearchableCombobox, states): lives in `apps/operator-web/src/components/ui` — **not yet extracted** to `packages/web-ui`
- ⬜ Flutter design system package
- ⬜ `packages/shared-types` / `api-contracts` (generate from OpenAPI)

## Phase 2 — Tenant, facility, gate, zone, slot
- ✅ Facilities CRUD, floors, zones, bulk slots, gates, devices, capacity pools, slot block/unblock (adjusts capacity), occupancy snapshot, reconciliation
- ✅ Plan entitlements enforced (facilities, gates, staff)
- ⬜ Buildings / restrictions management endpoints (models exist)

## Phase 3 — Entry, exit, tickets, sessions
- ✅ Entry: QR (reservation/pass/ticket), manual plate, ANPR; blacklist, duplicate-session, pass anti-sharing, corporate quota
- ✅ Row-locked capacity (concurrency test: 6 cars, capacity 3 → exactly 3 admitted)
- ✅ Slot assignment (SKIP LOCKED), signed QR tickets, session events, audit
- ✅ Exit quote / confirm, lost ticket, server-authoritative re-pricing, idempotent replay, double-exit rejection
- 🟡 Session state machine: ACTIVE → PAYMENT_PENDING/EXIT_READY → COMPLETED implemented; ENTRY_PENDING / EXIT_IN_PROGRESS / EXCEPTION states are not yet used
- ⬜ Vehicle photo upload (S3-compatible storage not wired)

## Phase 4 — Pricing, reservations, passes, payments
- ✅ Pricing engine: hourly/per-minute, first-unit, fixed entry, peak/weekend/event windows, overnight, daily cap, grace, free minutes, lost ticket, EV, valet, discounts, DST-safe
- ✅ Versioned rates (draft → publish, immutable), session snapshots its rate version
- ✅ Reservations: quote, hold with TTL, overbooking guard, pay → confirm → QR, cancel with policy, expiry/no-show sweep
- ✅ Payments: provider interface, sandbox provider, signed-webhook-only success, event dedupe, amount-mismatch reconciliation, refunds, double-entry ledger
- ✅ Cash in shifts, shift close with variance → reconciliation + ledger
- 🟡 Passes: validation at gate + payment activation done; **pass plan CRUD and purchase endpoints missing**
- 🟡 Coupons: engine supports discounts; coupon redemption endpoint missing
- 🔒 Razorpay / real gateway adapter (stub throws — never fakes success)
- 🔒 FASTag parking collection (requires bank/acquirer approval)
- ⬜ Automatic refund on reservation cancellation (refund amount computed; execution manual)
- ⬜ Settlements / commission jobs

## Phase 5 — Staff app & gate kiosk
- 🟡 Gate console in operator web (entry/exit, cash, UPI order, shift) — serves as the kiosk prototype
- ⬜ Staff Flutter app
- ⬜ Dedicated fullscreen kiosk PWA (device-bound auth, offline indicator)

## Phase 6 — Operator portal & app
- ✅ Operator web: login, live dashboard (WebSocket + 15s polling fallback), facility switcher, gate console, sessions (search/filter/paginate), facilities + interactive slot map, team list
- ⬜ Operator web: rates editor, reservations, overrides queue, ANPR review UI, reports, subscription, add-staff form
- ⬜ Operator Flutter app

## Phase 7 — Customer app & booking website
- ✅ Customer API: profile, vehicles, discovery (geo/filters/sort), facility details, quote, reserve, pay, sessions, passes, account deletion request
- ⬜ Customer Flutter app
- ⬜ Public booking website

## Phase 8 — Super admin & SaaS
- ✅ Admin API: dashboard (MRR, tenants, sessions, revenue), tenant list/detail, onboarding (tenant + owner + trial), suspend, plans, audit log
- ⬜ Admin web portal
- ⬜ SaaS invoicing / billing jobs

## Phase 9 — Corporate, valet, reporting, support
- 🟡 Corporate: whitelist + allocation enforced at gate; no management API/portal
- ⬜ Valet workflow API (models exist)
- ⬜ Reports + CSV/PDF export, BullMQ jobs
- ⬜ Support tickets / incidents API (models exist)

## Phase 10 — Hardware, ANPR
- ✅ Adapter interfaces, simulator with failure injection (offline/nack/timeout/flaky), barrier service with retry + alerts + gate degradation
- ✅ Signed device ingestion (HMAC, clock skew, event dedupe), heartbeat/fault/sensor events
- ✅ ANPR: normalization, confidence threshold, duplicate-read suppression, manual review queue, never auto-open on uncertain reads
- ⬜ `services/hardware-gateway` process + Redis transport (in-process transport only today)
- 🔒 Vendor adapters (Hikvision/ZKTeco etc.) — need SDKs and devices

## Phase 11 — Offline, security, performance
- 🟡 Gate service supports provisional/back-dated entries (`occurredAt`, `provisional`) — **offline sync endpoint not yet exposed**, no client queue
- ✅ Security covered by tests: cross-tenant access, RBAC, two-person override rule, refresh reuse, OTP lockout, webhook signatures, ledger immutability
- ⬜ Number-plate retention job, PII masking in exports, file upload scanning
- ⬜ Load testing

## Phase 12 — Deployment
- ⬜ PM2 / Nginx / Certbot configs, GitHub Actions CI, backup/restore, rollback scripts

## Local ports (chosen to avoid other projects on this machine)
API 4100 · Operator web 3101 · Postgres 57432 · Redis 57379
