# Park2All — System Architecture

Smart Mobility & Parking SaaS. Modular monolith first; hardware gateway and workers split out as separate processes from day one because they have different security and scaling profiles.

## 1. System architecture

```
                         ┌──────────────────────── Clients ────────────────────────┐
                         │ admin-web  operator-web  corporate-web  booking-web     │
                         │ gate-kiosk (PWA)   customer-app  operator-app  staff-app│
                         └───────────────┬─────────────────────────────┬───────────┘
                                         │ HTTPS REST + WS (JWT)       │
                                ┌────────▼─────────┐                   │
                                │   Caddy (edge)   │  TLS, routing     
                                └────────┬─────────┘
                       ┌─────────────────▼──────────────────┐
                       │       apps/api  (NestJS 11)        │
                       │  ┌──────────┐ ┌──────────────────┐ │
                       │  │ identity │ │ tenancy / RBAC   │ │
                       │  ├──────────┤ ├──────────────────┤ │
                       │  │ facility │ │ occupancy engine │ │
                       │  ├──────────┤ ├──────────────────┤ │
                       │  │ sessions │ │ pricing engine   │ │
                       │  ├──────────┤ ├──────────────────┤ │
                       │  │ reserve  │ │ payments+ledger  │ │
                       │  ├──────────┤ ├──────────────────┤ │
                       │  │ passes   │ │ hardware control │ │
                       │  ├──────────┤ ├──────────────────┤ │
                       │  │ staff    │ │ realtime (WS)    │ │
                       │  └──────────┘ └──────────────────┘ │
                       └──┬──────────────┬──────────────┬───┘
                          │              │              │ BullMQ
                   ┌──────▼─────┐  ┌─────▼────┐  ┌──────▼────────────┐
                   │ PostgreSQL │  │  Redis   │  │ background-worker │ reports, expiry,
                   └────────────┘  └─────┬────┘  └───────────────────┘ reconciliation
                                         │ pub/sub commands
                              ┌──────────▼───────────┐
                              │  hardware-gateway    │  device HMAC auth, adapters,
                              │  (per site or cloud) │  dedupe, fail-safe policy
                              └──────────┬───────────┘
                                ANPR · barriers · sensors · printers · EV chargers
```

Principles

- **Server is authoritative** for time, price, occupancy, payment status and barrier decisions.
- **Tenant isolation**: every tenant-owned row carries `tenantId`; all repository access goes through `TenantContext`, which is derived from the JWT, never from the request body. Super Admin cross-tenant access is explicit and audited.
- **Money**: integer minor units (paise) in `BigInt` columns / `Decimal` for rates; never floats. Ledger rows are append-only (DB trigger blocks UPDATE/DELETE).
- **State machines** for session, reservation, payment, barrier command — transitions in transactions with optimistic version checks and idempotency keys.
- **Hardware** never receives commands directly from clients. Clients ask the API; the API decides; the gateway executes and acknowledges.

## 2. Database ERD (core)

```
Tenant 1─* ParkingFacility 1─* ParkingFloor 1─* ParkingZone 1─* ParkingSlot
   │              │ 1─* ParkingGate 1─* HardwareDevice 1─* DeviceEvent
   │              │ 1─* ParkingCapacityPool (per vehicle type, capacity-based lots)
   │              │ 1─* ParkingRatePlan 1─* ParkingRateVersion 1─* ParkingRateRule
   │ 1─* TenantMember *─1 User *─* Role *─* Permission
   │ 1─1 Subscription *─1 SubscriptionPlan
User(customer) 1─* Vehicle
ParkingReservation *─1 Facility, *─1 Vehicle, 1─1 ReservationPriceSnapshot, 1─* StatusHistory
ParkingSession *─1 Facility, *─1 Vehicle?, 0..1 Reservation, 0..1 ParkingPass
   │ 1─* ParkingSessionEvent  1─1 ParkingEntry  0..1 ParkingExit  1─1 ParkingTicket
   │ 0..1 ParkingAssignment(slot)  1─* ParkingFeeCalculation
Payment *─1 Session|Reservation|Pass  1─* PaymentAttempt  1─* Refund
FinancialLedgerEntry (immutable, double-entry, *─1 FinancialLedgerAccount)
StaffShift 1─* ShiftCashRecord ; SupervisorOverride ; AuditLog (immutable)
```

Full model: `apps/api/prisma/schema.prisma`.

## 3. Prisma schema plan

Domains in one schema file, grouped by comment banners: Identity, SaaS, Parking, Vehicles, Reservations, Sessions, Pricing, Payments/Ledger, Staff, Hardware, Passes, Valet, Corporate, Support. Key constraints:

| Constraint | Mechanism |
|---|---|
| One active session per vehicle per facility | partial unique index `(facilityId, plateNormalized) WHERE status IN (active states)` |
| No overbooking | `SELECT … FOR UPDATE` on `ParkingCapacityPool` row + counters in same tx |
| Idempotent writes | `IdempotencyKey` table unique `(tenantId, key)` |
| Webhook dedupe | unique `(provider, providerEventId)` |
| Device event dedupe | unique `(deviceId, eventId)` |
| Ledger immutability | Postgres trigger rejecting UPDATE/DELETE |

## 4. Application screen maps

- **Admin web**: Dashboard · Tenants · Facilities · Subscriptions/Plans · Customers · Vehicles · Reservations · Sessions · Payments · Settlements · Hardware · Corporate · Promotions · Support · Reports · Settings · Audit.
- **Operator web**: Live dashboard · Facilities → (Floors/Zones/Slots map, Gates, Devices, Rates) · Sessions · Reservations · Passes · Staff & Shifts · Overrides · Revenue/Settlements · Reports · Subscription.
- **Corporate web**: Overview · Employees · Vehicles whitelist · Allocations · Usage · Invoices.
- **Booking web**: Search → Facility → Reserve → Pay → QR pass · My bookings.
- **Gate kiosk**: Gate select (device-bound) → Live lane (QR/ANPR/manual) → Confirm → Barrier status; supervisor override modal; health strip.
- **Customer app**: OTP → Profile → Add vehicle → Home | Explore | Bookings | Profile; Facility details; Reserve; QR pass; Live session; Pay; History; Passes.
- **Staff app**: Login → Shift open → Entry / Exit / Valet / Cash drawer / Incidents; offline queue.
- **Operator app**: Dashboard (facility switcher) · Sessions · Reservations · Alerts · Overrides · Reports.

## 5. Entry / exit workflow

Entry (`POST /v1/gate/entry`, idempotency key required):
1. Identify: QR token (signed, short-lived) | plate (manual/ANPR) | pass.
2. Resolve credential → reservation / pass / walk-in.
3. Reject if an active session exists for the plate at this facility (`DUPLICATE_ACTIVE_SESSION`).
4. Lock capacity pool row; reservation consumes its HELD unit, walk-in takes AVAILABLE; reject if full.
5. Assign slot if facility is slot-based (lowest compatible available slot, or the reserved one).
6. Create `ParkingSession(ACTIVE)` + `ParkingEntry` + `ParkingTicket` + events; commit.
7. Issue `BarrierCommand(OPEN)` via gateway → `PENDING → SENT → ACKED | FAILED | TIMED_OUT`.
8. Emit realtime `occupancy.changed`, `session.started`.

Exit:
1. `POST /v1/gate/exit/quote` — find session by ticket/QR/plate; compute fee with the rate version snapshotted at entry; apply pass/discount; return `FeeCalculation`.
2. Collect: cash (recorded against staff shift) or digital (payment order → provider webhook verified → `Payment.SUCCEEDED`).
3. `POST /v1/gate/exit/confirm` — requires zero outstanding balance (or authorized override); session `EXIT_READY → COMPLETED`; release capacity/slot; receipt; barrier OPEN.
4. Double exit returns `SESSION_ALREADY_COMPLETED` (idempotent replay returns the original result).

## 6. Reservation workflow

`quote` → `hold` (ReservationHold, TTL 10 min, decrements pool `available` for the window) → `confirm` (payment if prepaid) → `CONFIRMED` with signed QR → entry consumes → `CHECKED_IN`. Expiry job: unpaid holds released; no-show after `entryWindowEnd + grace` → `NO_SHOW`, capacity returned, cancellation policy applied.

## 7. SaaS subscription architecture

`SubscriptionPlan` (Starter/Growth/Business/Enterprise) carries entitlements JSON (`maxFacilities`, `maxGates`, `maxStaff`, `monthlySessions`, feature flags). `EntitlementGuard` checks on create endpoints and on session creation (soft limit → alert, hard limit configurable). Invoices generated monthly by worker; payment through the same payment adapter layer with `purpose = SAAS_SUBSCRIPTION`.

## 8. Hardware integration architecture

- `HardwareAdapter` interface per device class (`BarrierAdapter`, `AnprAdapter`, `PrinterAdapter`, `SensorAdapter`, `PaymentTerminalAdapter`, `EvChargerAdapter`).
- Devices authenticate with `deviceId` + HMAC-SHA256 over `timestamp.body` using a per-device secret (stored hashed-for-lookup + encrypted); ±60s clock window; nonce/eventId dedupe.
- Barrier commands are only created by API domain services (entry/exit confirm, audited supervisor override). There is no "open barrier" endpoint that accepts arbitrary input.
- ANPR: normalize plate (country rules, configurable), confidence < facility threshold → `ManualReviewQueue`; never auto-open on low confidence.
- `SimulatorAdapter` implements all interfaces for dev/tests, including failure injection (offline, timeout, NACK).

## 9. API specification

REST under `/v1`, OpenAPI at `/docs`. Main groups: `auth`, `me`, `tenants`, `facilities`, `floors`, `zones`, `slots`, `gates`, `rates`, `gate` (entry/exit), `sessions`, `reservations`, `passes`, `payments`, `webhooks/{provider}`, `devices` (device-auth), `staff/shifts`, `overrides`, `reports`, `admin/*`. Errors: `{ code, message, details? }` with stable machine codes. Live: Socket.IO namespace `/live`, rooms `facility:{id}`.

## 10. Roadmap

See `docs/IMPLEMENTATION_CHECKLIST.md` — the source of truth for what is built, tested, and pending.
