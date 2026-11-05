import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HardwareDevice, Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt, hmacSha256, randomToken, safeEqualHex } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { Public, RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { GateService } from '../sessions/gate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiveService } from '../realtime/live.service';
import { checkPlate } from '../vehicles/plate';

const CLOCK_SKEW_MS = 60_000;

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('HEARTBEAT'), eventId: z.string().min(4).max(80), occurredAt: z.coerce.date(), firmware: z.string().optional() }),
  z.object({
    type: z.literal('ANPR'), eventId: z.string().min(4).max(80), occurredAt: z.coerce.date(), direction: z.enum(['ENTRY', 'EXIT']),
    plate: z.string().min(1).max(20), confidence: z.number().min(0).max(1), imageKey: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal('SENSOR'), eventId: z.string().min(4).max(80), occurredAt: z.coerce.date(), slotCode: z.string().optional(), occupied: z.boolean().optional(), count: z.number().int().min(0).optional(), vehicleClass: z.string().optional() }),
  z.object({ type: z.literal('FAULT'), eventId: z.string().min(4).max(80), occurredAt: z.coerce.date(), code: z.string(), message: z.string().max(500) }),
]);
const reviewSchema = z.object({ decision: z.enum(['CONFIRM', 'CORRECT', 'REJECT']), plate: z.string().max(20).optional(), vehicleClass: z.string().optional() });

@ApiTags('devices')
@Controller('v1/devices')
export class DevicesController {
  constructor(
    private prisma: PrismaService,
    private gate: GateService,
    private live: LiveService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  /** Issue (or rotate) a device credential. Secret is shown once. */
  @Post(':id/credentials')
  @RequirePerm(P.HARDWARE_MANAGE)
  async issue(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.hardwareDevice.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!d) throw NotFound('Device');
    const secret = randomToken(32);
    const keyId = 'dk_' + randomToken(9);
    await this.prisma.$transaction([
      this.prisma.deviceCredential.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.deviceCredential.create({ data: { deviceId: id, keyId, secretEncrypted: encrypt(secret, env().DEVICE_SECRET_ENCRYPTION_KEY) } }),
    ]);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'device.credential_issued', entityType: 'HardwareDevice', entityId: id });
    return { keyId, secret, signing: 'hex(HMAC-SHA256(secret, `${x-timestamp}.${rawBody}`)) in x-signature' };
  }

  private async authenticate(req: any): Promise<HardwareDevice> {
    const keyId = req.headers['x-device-key'];
    const ts = Number(req.headers['x-timestamp']);
    const sig = req.headers['x-signature'];
    if (typeof keyId !== 'string' || typeof sig !== 'string' || !Number.isFinite(ts)) throw new DomainError('DEVICE_AUTH_REQUIRED', 'Device signature headers missing', 401);
    if (Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) throw new DomainError('DEVICE_CLOCK_SKEW', 'Timestamp outside allowed window', 401);
    const cred = await this.prisma.deviceCredential.findUnique({ where: { keyId }, include: { device: true } });
    if (!cred || cred.revokedAt || cred.device.status === 'RETIRED') throw new DomainError('DEVICE_AUTH_FAILED', 'Unknown or revoked device', 401);
    const expected = hmacSha256(decrypt(cred.secretEncrypted, env().DEVICE_SECRET_ENCRYPTION_KEY), `${ts}.${(req.rawBody as Buffer).toString('utf8')}`);
    if (!safeEqualHex(sig, expected)) throw new DomainError('DEVICE_AUTH_FAILED', 'Bad signature', 401);
    return cred.device;
  }

  @Public()
  @SkipThrottle()
  @Post('events')
  @HttpCode(200)
  async ingest(@Req() req: any) {
    const device = await this.authenticate(req);
    const evt = eventSchema.parse(req.body);
    try {
      await this.prisma.deviceEvent.create({ data: { tenantId: device.tenantId, deviceId: device.id, eventId: evt.eventId, type: evt.type, payload: req.body, occurredAt: evt.occurredAt } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true, duplicate: true };
      throw e;
    }
    await this.prisma.hardwareDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), status: evt.type === 'FAULT' ? 'FAULT' : 'ONLINE', firmware: evt.type === 'HEARTBEAT' ? evt.firmware : undefined } });
    if (device.gateId && evt.type === 'HEARTBEAT') await this.prisma.parkingGate.update({ where: { id: device.gateId }, data: { lastHeartbeatAt: new Date() } });

    let result: unknown = null;
    if (evt.type === 'ANPR') result = await this.handleAnpr(device, evt);
    else if (evt.type === 'FAULT') {
      await this.prisma.hardwareAlert.create({ data: { tenantId: device.tenantId, deviceId: device.id, severity: 'WARNING', code: evt.code, message: evt.message } });
      this.live.emit(device.facilityId, 'hardware.alert', { deviceId: device.id, code: evt.code });
      await this.notifications.hardwareAlert({ tenantId: device.tenantId, facilityId: device.facilityId, critical: false, title: `Device fault: ${evt.code}`, body: evt.message ?? 'A device reported a fault.' });
    } else if (evt.type === 'SENSOR') result = await this.handleSensor(device, evt);
    await this.prisma.deviceEvent.update({ where: { deviceId_eventId: { deviceId: device.id, eventId: evt.eventId } }, data: { processed: true } });
    return { ok: true, result };
  }

  private async handleSensor(device: HardwareDevice, evt: Extract<z.infer<typeof eventSchema>, { type: 'SENSOR' }>) {
    if (evt.count != null && evt.vehicleClass) {
      await this.prisma.parkingCapacityPool.updateMany({ where: { facilityId: device.facilityId, vehicleClass: evt.vehicleClass as any }, data: { sensorCount: evt.count, sensorReportedAt: evt.occurredAt } });
    }
    let slotId: string | undefined;
    if (evt.slotCode) slotId = (await this.prisma.parkingSlot.findFirst({ where: { facilityId: device.facilityId, code: evt.slotCode }, select: { id: true } }))?.id;
    await this.prisma.sensorReading.create({ data: { tenantId: device.tenantId, deviceId: device.id, slotId, occupied: evt.occupied, count: evt.count, at: evt.occurredAt } });
    return { recorded: true };
  }

  /**
   * ANPR policy: only a high-confidence, format-valid read may drive an automatic gate action.
   * Anything else goes to the manual review queue and the barrier stays closed.
   */
  private async handleAnpr(device: HardwareDevice, evt: Extract<z.infer<typeof eventSchema>, { type: 'ANPR' }>) {
    const facility = await this.prisma.parkingFacility.findUniqueOrThrow({ where: { id: device.facilityId } });
    const plate = checkPlate(evt.plate, facility.plateCountry);
    const threshold = Number(facility.anprConfidenceThreshold);
    const deviceEvent = await this.prisma.deviceEvent.findUniqueOrThrow({ where: { deviceId_eventId: { deviceId: device.id, eventId: evt.eventId } } });

    // Duplicate read suppression: same plate, same gate, same direction within 30s.
    const recent = await this.prisma.cameraRecognitionEvent.findFirst({
      where: { facilityId: facility.id, gateId: device.gateId, plateNormalized: plate.normalized, direction: evt.direction, occurredAt: { gte: new Date(evt.occurredAt.getTime() - 30_000) } },
    });
    const autoEligible = plate.valid && evt.confidence >= threshold && !recent;
    const rec = await this.prisma.cameraRecognitionEvent.create({
      data: {
        tenantId: device.tenantId, facilityId: facility.id, gateId: device.gateId, deviceId: device.id, deviceEventId: deviceEvent.id, direction: evt.direction,
        plateRaw: evt.plate, plateNormalized: plate.normalized, confidence: new Prisma.Decimal(evt.confidence), imageKey: evt.imageKey,
        reviewStatus: autoEligible ? 'AUTO_MATCHED' : 'PENDING_REVIEW', occurredAt: evt.occurredAt,
      },
    });
    if (recent) return { action: 'DUPLICATE_READ_SUPPRESSED', recognitionId: rec.id };
    if (!autoEligible) {
      this.live.emit(facility.id, 'anpr.review_required', { recognitionId: rec.id, plate: plate.normalized, confidence: evt.confidence, gateId: device.gateId });
      return { action: 'MANUAL_REVIEW', recognitionId: rec.id, reason: !plate.valid ? 'INVALID_FORMAT' : 'LOW_CONFIDENCE' };
    }
    return this.applyAnpr(device.tenantId, facility.id, device.gateId, device.id, rec.id, evt.direction, plate.normalized);
  }

  private async applyAnpr(tenantId: string, facilityId: string, gateId: string | null, deviceId: string | undefined, recognitionId: string, direction: 'ENTRY' | 'EXIT' | 'BOTH', plate: string, vehicleClass?: any, userId?: string) {
    const actor = { tenantId, deviceId, userId };
    try {
      if (direction === 'ENTRY') {
        const r = await this.gate.entry(actor, { facilityId, gateId: gateId ?? undefined, credential: { type: 'PLATE_ANPR', plate }, vehicleClass, anprEventId: recognitionId });
        await this.prisma.cameraRecognitionEvent.update({ where: { id: recognitionId }, data: { sessionId: r.sessionId } });
        return { action: 'ENTRY_CREATED', sessionId: r.sessionId, barrier: r.barrier };
      }
      const q = await this.gate.exitQuote(actor, { facilityId, gateId: gateId ?? undefined, credential: { type: 'PLATE_ANPR', plate } });
      await this.prisma.cameraRecognitionEvent.update({ where: { id: recognitionId }, data: { sessionId: q.sessionId } });
      if (q.outstandingMinor > 0) {
        this.live.emit(facilityId, 'exit.payment_required', { sessionId: q.sessionId, plate, outstandingMinor: q.outstandingMinor, gateId });
        return { action: 'PAYMENT_REQUIRED', sessionId: q.sessionId, outstandingMinor: q.outstandingMinor };
      }
      const c = await this.gate.exitConfirm(actor, { facilityId, gateId: gateId ?? undefined, credential: { type: 'PLATE_ANPR', plate } });
      return { action: 'EXIT_COMPLETED', sessionId: c.sessionId, barrier: c.barrier };
    } catch (e) {
      // Business rejection (e.g. vehicle class unknown, full, no session) -> staff attention, barrier stays closed.
      const err = e as DomainError;
      this.live.emit(facilityId, 'anpr.attention', { recognitionId, plate, code: err.code ?? 'ERROR', message: err.message, gateId });
      return { action: 'STAFF_ATTENTION', code: err.code ?? 'ERROR', message: err.message };
    }
  }

  @Get('anpr/review-queue')
  @RequirePerm(P.ANPR_REVIEW)
  queue(@Tenant() t: TenantContext, @Query('facilityId') facilityId?: string) {
    if (facilityId) t.assertFacility(facilityId);
    return this.prisma.cameraRecognitionEvent.findMany({ where: { tenantId: t.tenantId, facilityId: facilityId || undefined, reviewStatus: 'PENDING_REVIEW' }, orderBy: { occurredAt: 'desc' }, take: 100 });
  }

  @Post('anpr/:id/review')
  @RequirePerm(P.ANPR_REVIEW)
  async review(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reviewSchema)) b: z.infer<typeof reviewSchema>) {
    const rec = await this.prisma.cameraRecognitionEvent.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!rec) throw NotFound('Recognition');
    t.assertFacility(rec.facilityId);
    if (rec.reviewStatus !== 'PENDING_REVIEW') throw new DomainError('ALREADY_REVIEWED', 'Already reviewed', 409);
    const status = b.decision === 'REJECT' ? 'REJECTED' : b.decision === 'CORRECT' ? 'CORRECTED' : 'CONFIRMED';
    const plate = b.decision === 'CORRECT' ? checkPlate(b.plate ?? '').normalized : rec.plateNormalized;
    const upd = await this.prisma.cameraRecognitionEvent.updateMany({ where: { id, reviewStatus: 'PENDING_REVIEW' }, data: { reviewStatus: status, reviewedById: t.userId, correctedPlate: b.decision === 'CORRECT' ? plate : null } });
    if (!upd.count) throw new DomainError('ALREADY_REVIEWED', 'Already reviewed', 409);
    await this.audit.log({ tenantId: t.tenantId, actorId: t.userId, actorKind: 'USER', action: 'anpr.review', entityType: 'CameraRecognitionEvent', entityId: id, before: { plate: rec.plateNormalized }, after: { decision: b.decision, plate } });
    if (status === 'REJECTED') return { status };
    const result = await this.applyAnpr(t.tenantId, rec.facilityId, rec.gateId, undefined, rec.id, rec.direction, plate, b.vehicleClass, t.userId);
    return { status, result };
  }
}
