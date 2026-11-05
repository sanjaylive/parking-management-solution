import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiveService } from '../realtime/live.service';
import { DeviceRef } from './adapters';
import { InProcessTransport } from './transport';

export type BarrierReason = 'ENTRY' | 'EXIT' | 'OVERRIDE' | 'EMERGENCY';

export interface BarrierOutcome {
  mode: 'AUTOMATIC' | 'MANUAL';
  commandId?: string;
  status: 'ACKED' | 'FAILED' | 'TIMED_OUT' | 'NO_DEVICE';
  error?: string;
}

const ACK_TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 2;

/**
 * The ONLY code path that opens a barrier. It is invoked by domain services after the business
 * decision is committed (entry accepted, exit paid, override approved) — never directly by clients.
 * A barrier failure does not roll back the parking decision; it raises an alert and the UI offers
 * the audited supervisor manual-open flow.
 */
@Injectable()
export class BarrierService {
  private log = new Logger('Barrier');

  constructor(
    private prisma: PrismaService,
    private transport: InProcessTransport,
    private live: LiveService,
    private notifications: NotificationsService,
  ) {}

  async open(p: { tenantId: string; gateId?: string | null; reason: BarrierReason; sessionId?: string; overrideId?: string; requestedById?: string }): Promise<BarrierOutcome> {
    if (!p.gateId) return { mode: 'MANUAL', status: 'NO_DEVICE' };
    const gate = await this.prisma.parkingGate.findFirst({ where: { id: p.gateId, tenantId: p.tenantId } });
    if (!gate) return { mode: 'MANUAL', status: 'NO_DEVICE' };
    const device = await this.prisma.hardwareDevice.findFirst({
      where: { gateId: gate.id, kind: 'BARRIER', status: { not: 'RETIRED' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!device) return { mode: 'MANUAL', status: 'NO_DEVICE' };

    const cmd = await this.prisma.barrierCommand.create({
      data: {
        tenantId: p.tenantId, gateId: gate.id, deviceId: device.id, action: 'OPEN', reason: p.reason,
        sessionId: p.sessionId, overrideId: p.overrideId, requestedById: p.requestedById,
      },
    });
    const ref: DeviceRef = { id: device.id, adapter: device.adapter, config: (device.config ?? {}) as Record<string, unknown> };

    let lastError = 'UNKNOWN';
    let status: BarrierOutcome['status'] = 'FAILED';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.prisma.barrierCommand.update({ where: { id: cmd.id }, data: { status: 'SENT', sentAt: new Date(), attempts: attempt } });
      try {
        let timer: NodeJS.Timeout | undefined;
        const res = await Promise.race([
          this.transport.barrier(ref).open(ref, { commandId: cmd.id }),
          new Promise<{ ok: false; error: string }>((r) => (timer = setTimeout(() => r({ ok: false, error: 'ACK_TIMEOUT' }), ACK_TIMEOUT_MS))),
        ]).finally(() => clearTimeout(timer));
        if (res.ok) {
          await this.prisma.barrierCommand.update({ where: { id: cmd.id }, data: { status: 'ACKED', ackedAt: new Date(), error: null } });
          await this.prisma.hardwareDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), status: 'ONLINE' } });
          this.live.emit(gate.facilityId, 'barrier.opened', { gateId: gate.id, commandId: cmd.id, reason: p.reason });
          return { mode: 'AUTOMATIC', commandId: cmd.id, status: 'ACKED' };
        }
        lastError = res.error ?? 'NACK';
        status = lastError === 'ACK_TIMEOUT' ? 'TIMED_OUT' : 'FAILED';
      } catch (e) {
        lastError = (e as Error).message;
        status = 'FAILED';
      }
    }

    await this.prisma.barrierCommand.update({ where: { id: cmd.id }, data: { status, error: lastError } });
    await this.prisma.hardwareAlert.create({
      data: { tenantId: p.tenantId, deviceId: device.id, severity: 'CRITICAL', code: 'BARRIER_COMMAND_FAILED', message: `Barrier at gate ${gate.code} failed: ${lastError}` },
    });
    await this.prisma.parkingGate.update({ where: { id: gate.id }, data: { status: 'DEGRADED' } });
    this.live.emit(gate.facilityId, 'hardware.alert', { gateId: gate.id, code: 'BARRIER_COMMAND_FAILED', error: lastError });
    await this.notifications.hardwareAlert({ tenantId: p.tenantId, facilityId: gate.facilityId, critical: true, title: `Barrier failed at gate ${gate.code}`, body: `The barrier did not respond (${lastError}). The gate is marked degraded; open it manually if needed.` });
    this.log.warn(`Barrier command ${cmd.id} ${status}: ${lastError}`);
    return { mode: 'AUTOMATIC', commandId: cmd.id, status, error: lastError };
  }
}
