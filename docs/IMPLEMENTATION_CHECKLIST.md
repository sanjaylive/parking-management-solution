# Park2All — Implementation Checklist

Legend: ✅ built & tested · 🟡 built, partial or untested · ⬜ not started · 🔒 pending external credentials/hardware

_Last updated: 2026-11-06 (customer app + booking web)_

## Verification status

| Check | Result |
|---|---|
| API typecheck (`tsc --noEmit`) | ✅ clean |
| API unit tests (pricing engine, plates) | ✅ 27/27 |
| API tests | ✅ 49/49 total (18 pricing engine, 9 plates, 14 critical flows, 5 offline sync, 2 customer checkout) — Jest pinned to 1 worker (shared test DB) |
| Flutter `analyze` (design-system, core, staff-app) | ✅ no issues |
| Flutter tests | ✅ 20/20 (design 4, core 7, staff app 5, customer app 4) |
| Customer app web build + manual run in Chrome | ✅ OTP signup → onboarding → nearby → facility → reserve → sandbox pay → QR → gate admits by plate (matched to booking) → live session |
| Booking web build + manual run in Chrome | ✅ SSR search (results in HTML) → facility → guest OTP sign-in mid-booking → declined payment → retry → confirmed QR; payment attempts + ledger verified in DB |
| Booking web at phone width | ⚠️ not verified — the automation browser window could not be resized; layout uses responsive breakpoints |
| Staff app web build + manual run in Chrome | ✅ login → online entry → API stopped → provisional entry queued → API restarted → auto-sync → verified in DB |
| Staff app Android debug APK | ✅ builds (`flutter build apk --debug`); not run on a device/emulator |
| Staff app iOS | ⬜ not built — Xcode installation incomplete on this machine |
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
- ✅ Web design system extracted to `packages/web-ui` (tokens `styles.css`, light/dark, MetricCard, OccupancyRing, VehicleNumberPlate, SearchableCombobox, states) — used by operator-web and booking-web
- ✅ Flutter design system (`flutter-packages/design-system`): M3 theme from brand tokens, light/dark, VehicleNumberPlate, StatusChip, OccupancyRing, GradientHeader, EmptyState, ₹ formatting (Indian grouping)
- ✅ Flutter core (`flutter-packages/core`): Dio API client (refresh, tenant header, idempotency keys), secure session store, AES-256-GCM offline queue
- 🟡 Freezed not used — models are plain Dart maps/classes for now (no codegen step); revisit when the customer app needs typed models
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
- ✅ Staff Flutter app (`apps/staff-app`): login, role-aware gate (entry/exit, QR scan, plate entry, vehicle class), fee breakdown, cash / UPI order, exit confirm with barrier result, vehicles-inside list with occupancy ring, shift open/close with variance, offline mode with encrypted queue + auto-sync + attention list
- ⬜ Staff app: vehicle photo capture (needs object storage), receipt printing (needs printer adapter), incident reporting + valet + supervisor override approval screens (APIs for incidents/valet not built yet)
- ⬜ Staff app offline fee estimate — offline exits record the cash collected; the server recalculates and flags shortfalls
- ⬜ Dedicated fullscreen kiosk PWA (device-bound auth, offline indicator)

## Phase 6 — Operator portal & app
- ✅ Operator web: login, live dashboard (WebSocket + 15s polling fallback), facility switcher, gate console, sessions (search/filter/paginate), facilities + interactive slot map, team list
- ⬜ Operator web: rates editor, reservations, overrides queue, ANPR review UI, reports, subscription, add-staff form
- ⬜ Operator Flutter app

## Phase 7 — Customer app & booking website
- ✅ Customer API: profile, vehicles, discovery (geo/filters/sort), facility details, quote, reserve, pay, sessions, passes, account deletion request
- ✅ Customer API: live charge estimate (read-only) and pay-before-exit checkout (honoured at the exit gate within grace)
- ✅ Customer Flutter app (`apps/customer-app`): OTP login (no separate signup), onboarding, Home (live session, upcoming, nearby), Explore (filters, sort, list + map), facility details, reserve with server quote, sandbox checkout, QR pass, bookings + parking history, live session with pay-now, profile (vehicles, passes, delete account)
- ✅ Public booking website (`apps/booking-web`, :3104): server-rendered search + facility pages (SEO metadata), URL-driven filters, optional geolocation, OTP sign-in that resumes the booking, sandbox checkout, bookings list, QR pass, in-page cancel confirmation
- 🔒 Maps: OpenStreetMap tiles used for development (no key). Production needs a commercial tile/maps provider (Google Maps / Mapbox key) and attribution review
- 🔒 Real payment checkout (gateway SDK / hosted page) — sandbox provider until merchant credentials exist
- ⬜ Customer push notifications (FCM needs a Firebase project), extend-booking, pass purchase UI (pass purchase API also missing), reviews submission
- ⬜ Customer app on a real device; iOS build (Xcode incomplete on this machine)

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
- ✅ Offline sync: `POST /v1/gate/offline-sync` (idempotent per localId, time-ordered, provisional entries at original time, no barrier actuation, offline cash applied, underpaid exits → EXCEPTION, conflicts reported), supervisor review queue, device config endpoint
- ✅ Provisional entries count toward capacity but never claim a guessed slot
- ⚠️ Design change: dropped the DB `occupied <= capacity` CHECK so synced provisional entries keep the counter truthful; live entries are still capped by the row-locked service (concurrency test)
- ⬜ Supervisor UI for the offline review queue (API exists)
- ✅ Security covered by tests: cross-tenant access, RBAC, two-person override rule, refresh reuse, OTP lockout, webhook signatures, ledger immutability
- ⬜ Number-plate retention job, PII masking in exports, file upload scanning
- ⬜ Load testing

## Phase 12 — Deployment
- ✅ `npm run deploy` → push main → GitHub Actions (`.github/workflows/deploy.yml`): API tests on Postgres+Redis, typecheck, Flutter analyze/test, builds, deploy over SSH
- ✅ Release bundle (`infrastructure/scripts/package-release.sh`): API with prod-only deps + Prisma engines for Ubuntu, Next.js standalone servers, Flutter web
- ✅ VPS activation (`remote-release.sh`): migrate → atomic `current` symlink → PM2 reload → health check on release sha → auto-rollback. Verified locally (fresh DB, reload, broken release rolled back with exit 1)
- ✅ PM2 ecosystem, Nginx site for park.2all.co.in (path-routed; validated with `nginx -t` + routing checks in Docker), Certbot via `vps-setup.sh`
- ✅ Staging mode `ALLOW_SANDBOX_PROVIDERS=true` (production build with console OTP + sandbox payments, flagged in `/health`)
- ⚠️ Not yet run against the real VPS: needs DNS A record, `vps-setup.sh`, and GitHub secrets (docs/DEPLOYMENT.md)
- ⬜ Automated DB backups (pg_dump off-box) + restore drill

## Local ports (chosen to avoid other projects on this machine)
API 4100 · Operator web 3101 · Staff app (web) 3102 · Customer app (web) 3103 · Booking web 3104 · Postgres 57432 · Redis 57379
