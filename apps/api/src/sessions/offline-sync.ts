import { Body, Controller, Get, HttpCode, Injectable, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, VehicleClass } from '@prisma/client';
import { z } from 'zod';
import { DomainError, NotFound } from '../common/errors';
import { IdempotencyService } from '../common/idempotency.service';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { Actor, GateService } from './gate.service';

/**
 * Offline gate events, captured on a staff device while the API was unreachable.
 *
 * Rules:
 *  - Every event carries a device-generated `localId`; replays return the stored result (dedupe).
 *  - ENTRY creates a provisional session at the original time (may exceed live capacity — the car is inside).
 *  - EXIT never triggers a barrier (the vehicle already left). Cash recorded offline is applied first;
 *    if the fee is not fully covered the session closes as EXCEPTION for supervisor review.
 *  - Digital payments are NEVER accepted offline — they can't be verified without the provider.
 *  - Business conflicts (e.g. vehicle already inside) are returned as CONFLICT, not dropped.
 */
const offlineEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ENTRY'), localId: z.string().min(8).max(80), occurredAt: z.coerce.date(),
    plate: z.string().min(2).max(20), vehicleClass: z.nativeEnum(VehicleClass), gateId: z.string().uuid().optional(), allowNonStandardPlate: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('EXIT'), localId: z.string().min(8).max(80), occurredAt: z.coerce.date(),
    plate: z.string().min(2).max(20), gateId: z.string().uuid().optional(), cashCollectedMinor: z.number().int().min(0).default(0), lostTicket: z.boolean().optional(),
  }),
]);
const syncSchema = z.object({ facilityId: z.string().uuid(), deviceLabel: z.string().max(80).optional(), events: z.array(offlineEvent).min(1).max(500) });

export type SyncStatus = 'ACCEPTED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED' | 'NEEDS_REVIEW';
export interface SyncResult {
  localId: string;
  type: 'ENTRY' | 'EXIT';
  status: SyncStatus;
  sessionId?: string;
  code?: string;
  message?: string;
  outstandingMinor?: number;
}

@Injectable()
export class OfflineSyncService {
  constructor(
    private prisma: PrismaService,
    private gate: GateService,
    private idem: IdempotencyService,
  ) {}

  async sync(actor: Required<Pick<Actor, 'tenantId' | 'userId'>>, input: z.infer<typeof syncSchema>) {
    const facility = await this.prisma.parkingFacility.findFirst({ where: { id: input.facilityId, tenantId: actor.tenantId } });
    if (!facility) throw NotFound('Facility');
    // Process in the order things happened at the gate, entries before exits at the same instant.
    const events = [...input.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.type === 'ENTRY' ? -1 : 1));
    const results: SyncResult[] = [];

    for (const e of events) {
      const r = await this.idem.run(`${actor.tenantId}:offline`, e.localId, e, () => this.apply(actor, facility.id, e));
      results.push(r.replayed ? { ...r, status: 'DUPLICATE', replayed: undefined } as SyncResult : (r as SyncResult));
    }

    const count = (s: SyncStatus) => results.filter((r) => r.status === s).length;
    const batch = await this.prisma.offlineSyncBatch.create({
      data: {
        tenantId: actor.tenantId, facilityId: facility.id, userId: actor.userId, eventCount: events.length,
        accepted: count('ACCEPTED'), duplicates: count('DUPLICATE'), conflicts: count('CONFLICT') + count('NEEDS_REVIEW') + count('REJECTED'),
        results: results as unknown as Prisma.InputJsonValue,
      },
    });
    return { batchId: batch.id, summary: { accepted: batch.accepted, duplicates: batch.duplicates, needsAttention: batch.conflicts }, results };
  }

  private async apply(actor: Required<Pick<Actor, 'tenantId' | 'userId'>>, facilityId: string, e: z.infer<typeof offlineEvent>): Promise<SyncResult> {
    try {
      if (e.type === 'ENTRY') {
        const r = await this.gate.entry(actor, {
          facilityId, gateId: e.gateId, credential: { type: 'PLATE_MANUAL', plate: e.plate }, vehicleClass: e.vehicleClass,
          allowNonStandardPlate: e.allowNonStandardPlate, occurredAt: e.occurredAt, provisional: true,
        });
        return { localId: e.localId, type: 'ENTRY', status: 'ACCEPTED', sessionId: r.sessionId };
      }

      const quote = await this.gate.exitQuote(actor, { facilityId, gateId: e.gateId, credential: { type: 'PLATE_MANUAL', plate: e.plate }, occurredAt: e.occurredAt, lostTicket: e.lostTicket });
      let outstanding = quote.outstandingMinor;
      if (e.cashCollectedMinor > 0 && outstanding > 0) {
        const applied = Math.min(e.cashCollectedMinor, outstanding);
        const c = await this.gate.collectCash(actor, quote.sessionId, applied);
        outstanding = c.outstandingMinor;
      }
      const overCollected = Math.max(0, e.cashCollectedMinor - quote.outstandingMinor);

      if (outstanding > 0) {
        const r = await this.gate.recordUnpaidOfflineExit(actor, { facilityId, sessionId: quote.sessionId, gateId: e.gateId, exitAt: e.occurredAt, outstandingMinor: outstanding });
        return { localId: e.localId, type: 'EXIT', status: 'NEEDS_REVIEW', sessionId: r.sessionId, code: 'OFFLINE_EXIT_UNPAID', message: 'Vehicle left with an unpaid balance', outstandingMinor: outstanding };
      }
      const done = await this.gate.exitConfirm(actor, { facilityId, gateId: e.gateId, credential: { type: 'PLATE_MANUAL', plate: e.plate }, occurredAt: e.occurredAt, offline: true });
      if (overCollected > 0)
        return { localId: e.localId, type: 'EXIT', status: 'NEEDS_REVIEW', sessionId: done.sessionId, code: 'CASH_OVER_COLLECTED', message: `Collected ${overCollected} paise more than the server-calculated fee` };
      return { localId: e.localId, type: 'EXIT', status: 'ACCEPTED', sessionId: done.sessionId };
    } catch (err) {
      if (err instanceof DomainError) {
        const conflict = ['DUPLICATE_ACTIVE_SESSION', 'SESSION_NOT_FOUND', 'SESSION_ALREADY_COMPLETED', 'PASS_IN_USE'].includes(err.code);
        return { localId: e.localId, type: e.type, status: conflict ? 'CONFLICT' : 'REJECTED', code: err.code, message: err.message };
      }
      throw err; // infrastructure error: let the client retry the whole batch (idempotency keeps it safe)
    }
  }
}

@ApiTags('gate')
@Controller('v1/gate')
export class OfflineSyncController {
  constructor(
    private sync: OfflineSyncService,
    private prisma: PrismaService,
  ) {}

  @Post('offline-sync')
  @HttpCode(200)
  @RequirePerm(P.SESSION_ENTRY, P.SESSION_EXIT)
  run(@Tenant() t: TenantContext, @Body(new ZodPipe(syncSchema)) b: z.infer<typeof syncSchema>) {
    t.assertFacility(b.facilityId);
    return this.sync.sync({ tenantId: t.tenantId, userId: t.userId }, b);
  }

  /** Supervisor queue: offline events needing attention + provisional/exception sessions. */
  @Get('offline-sync/review')
  @RequirePerm(P.OVERRIDE_APPROVE)
  async review(@Tenant() t: TenantContext, @Query('facilityId') facilityId: string) {
    t.assertFacility(facilityId);
    const since = new Date(Date.now() - 14 * 86400_000);
    const [batches, exceptions, provisional] = await Promise.all([
      this.prisma.offlineSyncBatch.findMany({ where: { tenantId: t.tenantId, facilityId, conflicts: { gt: 0 }, receivedAt: { gte: since } }, orderBy: { receivedAt: 'desc' }, take: 50 }),
      this.prisma.parkingSession.findMany({ where: { tenantId: t.tenantId, facilityId, status: 'EXCEPTION' }, orderBy: { exitAt: 'desc' }, take: 100 }),
      this.prisma.parkingSession.findMany({ where: { tenantId: t.tenantId, facilityId, isProvisional: true, exitAt: null }, orderBy: { entryAt: 'desc' }, take: 100 }),
    ]);
    return {
      items: batches.flatMap((b) => (b.results as unknown as SyncResult[]).filter((r) => r.status !== 'ACCEPTED' && r.status !== 'DUPLICATE').map((r) => ({ ...r, batchId: b.id, receivedAt: b.receivedAt }))),
      exceptionSessions: exceptions,
      provisionalSessions: provisional,
    };
  }

  /** Everything a gate device needs at startup, including offline limits. Cached on device. */
  @Get('config')
  @RequirePerm(P.FACILITY_READ)
  async config(@Tenant() t: TenantContext, @Query('facilityId') facilityId: string) {
    t.assertFacility(facilityId);
    const f = await this.prisma.parkingFacility.findFirst({
      where: { id: facilityId, tenantId: t.tenantId },
      select: {
        id: true, code: true, name: true, timezone: true, occupancyMode: true, plateCountry: true, graceMinutes: true,
        offlineMaxProvisionalEntries: true, failSafeBarrierPolicy: true,
        gates: { select: { id: true, code: true, name: true, direction: true, status: true }, orderBy: { code: 'asc' } },
        pools: { select: { vehicleClass: true, totalCapacity: true, occupied: true, blocked: true } },
      },
    });
    if (!f) throw NotFound('Facility');
    return { ...f, permissions: [...t.permissions].filter((p) => !p.startsWith('platform.')), serverTime: new Date().toISOString() };
  }
}
