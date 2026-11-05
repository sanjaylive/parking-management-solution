import { Injectable, Logger } from '@nestjs/common';
import { Payment, PaymentPurpose, Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import { env, sandboxAllowed } from '../config/env';
import { AuditService } from '../common/audit.service';
import { DomainError, Forbidden, NotFound } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { LiveService } from '../realtime/live.service';
import { LedgerService } from './ledger.service';
import { NormalizedWebhook, PaymentProvider, providerFor, SandboxProvider } from './providers';

@Injectable()
export class PaymentsService {
  private log = new Logger('Payments');
  private provider: PaymentProvider = providerFor(env().PAYMENT_PROVIDER);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private audit: AuditService,
    private live: LiveService,
  ) {}

  /**
   * Create a digital payment order. Amount is ALWAYS computed server-side from the referenced object.
   * `requester` is either a customer (must own the reservation/session vehicle) or tenant staff.
   */
  async createOrder(p: { purpose: PaymentPurpose; sessionId?: string; reservationId?: string; passId?: string; requester: { userId: string; tenantId?: string } }) {
    let tenantId: string;
    let amountMinor: number;
    let description: string;

    if (p.purpose === 'PARKING_SESSION') {
      const s = await this.prisma.parkingSession.findUnique({ where: { id: p.sessionId ?? '' }, include: { vehicle: { include: { owners: true } }, facility: true } });
      if (!s) throw NotFound('Session');
      this.assertAccess(p.requester, s.tenantId, s.vehicle?.owners.map((o) => o.userId) ?? []);
      if (s.status !== 'PAYMENT_PENDING') throw new DomainError('NOTHING_TO_PAY', `Session is ${s.status}; request an exit quote first`, 409);
      tenantId = s.tenantId;
      amountMinor = s.amountDueMinor - s.amountPaidMinor;
      description = `Parking at ${s.facility.name}`;
    } else if (p.purpose === 'RESERVATION') {
      const r = await this.prisma.parkingReservation.findUnique({ where: { id: p.reservationId ?? '' }, include: { facility: true } });
      if (!r) throw NotFound('Reservation');
      this.assertAccess(p.requester, r.tenantId, [r.userId]);
      if (r.status !== 'HELD' && r.status !== 'PENDING_PAYMENT') throw new DomainError('NOTHING_TO_PAY', `Reservation is ${r.status}`, 409);
      if (r.holdExpiresAt && r.holdExpiresAt < new Date()) throw new DomainError('HOLD_EXPIRED', 'Reservation hold expired. Please book again.', 409);
      tenantId = r.tenantId;
      amountMinor = r.amountMinor - r.paidMinor;
      description = `Reservation ${r.code} at ${r.facility.name}`;
      await this.prisma.parkingReservation.update({ where: { id: r.id }, data: { status: 'PENDING_PAYMENT' } });
    } else if (p.purpose === 'PASS') {
      const pass = await this.prisma.parkingPass.findUnique({ where: { id: p.passId ?? '' }, include: { plan: true } });
      if (!pass) throw NotFound('Pass');
      this.assertAccess(p.requester, pass.tenantId, pass.userId ? [pass.userId] : []);
      if (pass.status !== 'PENDING_PAYMENT') throw new DomainError('NOTHING_TO_PAY', `Pass is ${pass.status}`, 409);
      tenantId = pass.tenantId;
      amountMinor = pass.plan.priceMinor;
      description = `${pass.plan.name} pass`;
    } else {
      throw new DomainError('UNSUPPORTED_PURPOSE', 'Unsupported payment purpose', 400);
    }
    if (amountMinor <= 0) throw new DomainError('NOTHING_TO_PAY', 'Nothing to pay', 409);

    // Reuse an open order for the same object+amount to avoid duplicate charges from double taps.
    const open = await this.prisma.payment.findFirst({
      where: { purpose: p.purpose, sessionId: p.sessionId, reservationId: p.reservationId, passId: p.passId, status: { in: ['CREATED', 'PENDING'] }, amountMinor, provider: this.provider.key },
    });
    if (open?.providerOrderId) return { paymentId: open.id, amountMinor, checkout: { provider: this.provider.key, orderId: open.providerOrderId, amountMinor, currency: 'INR' } };

    const payment = await this.prisma.payment.create({
      data: { tenantId, purpose: p.purpose, sessionId: p.sessionId, reservationId: p.reservationId, passId: p.passId, userId: p.requester.userId, provider: this.provider.key, amountMinor, status: 'CREATED' },
    });
    const order = await this.provider.createOrder({ paymentId: payment.id, amountMinor, currency: 'INR', description });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId: order.providerOrderId, status: 'PENDING' } });
    return { paymentId: payment.id, amountMinor, checkout: order.checkout };
  }

  private assertAccess(req: { userId: string; tenantId?: string }, ownerTenant: string, ownerUserIds: string[]) {
    if (req.tenantId === ownerTenant) return;
    if (ownerUserIds.includes(req.userId)) return;
    throw Forbidden('Not allowed to pay for this item');
  }

  async getStatus(paymentId: string, requester: { userId: string; tenantId?: string }) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw NotFound('Payment');
    if (p.userId !== requester.userId && p.tenantId !== requester.tenantId) throw Forbidden();
    return { paymentId: p.id, status: p.status, amountMinor: p.amountMinor, receiptNumber: p.receiptNumber };
  }

  // ───────────── Webhooks: the ONLY path that marks digital payments successful ─────────────

  async handleWebhook(providerKey: string, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const provider = providerKey === this.provider.key ? this.provider : providerFor(providerKey);
    const evt = provider.verifyWebhook(raw, headers);
    if (!evt) {
      this.log.warn(`Rejected ${providerKey} webhook with invalid signature`);
      throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Invalid signature', 401);
    }
    let record;
    try {
      record = await this.prisma.paymentWebhookEvent.create({
        data: { provider: providerKey, providerEventId: evt.providerEventId, type: evt.type, signatureValid: true, payload: JSON.parse(raw.toString('utf8')) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true, duplicate: true };
      throw e;
    }
    try {
      if (evt.type === 'payment.succeeded') await this.onSucceeded(evt);
      else if (evt.type === 'payment.failed') await this.onFailed(evt);
      else if (evt.type === 'refund.succeeded' || evt.type === 'refund.failed') await this.onRefund(evt);
      await this.prisma.paymentWebhookEvent.update({ where: { id: record.id }, data: { processedAt: new Date() } });
      return { ok: true };
    } catch (e) {
      await this.prisma.paymentWebhookEvent.update({ where: { id: record.id }, data: { error: (e as Error).message } });
      throw e;
    }
  }

  private async onSucceeded(evt: NormalizedWebhook) {
    await this.prisma.$transaction(async (tx) => {
      const [payment] = await tx.$queryRaw<Payment[]>`SELECT * FROM "Payment" WHERE "providerOrderId" = ${evt.providerOrderId ?? ''} FOR UPDATE`;
      if (!payment) throw new Error('Unknown order ' + evt.providerOrderId);
      if (payment.status === 'SUCCEEDED') return; // idempotent across distinct event ids for same payment
      if (evt.amountMinor !== payment.amountMinor) {
        await tx.reconciliationRecord.create({ data: { tenantId: payment.tenantId, kind: 'GATEWAY', refId: payment.id, expected: payment.amountMinor, actual: evt.amountMinor ?? 0, difference: (evt.amountMinor ?? 0) - payment.amountMinor, notes: 'Amount mismatch on webhook' } });
        throw new Error('Amount mismatch');
      }
      const receiptNumber = `RC-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', method: evt.method, succeededAt: new Date(), receiptNumber } });
      await tx.paymentAttempt.create({ data: { paymentId: payment.id, providerPaymentId: evt.providerPaymentId, status: 'SUCCEEDED', method: evt.method } });
      await this.applySuccess(tx, payment);
    });
  }

  private async applySuccess(tx: Tx, payment: Payment) {
    const tenantId = payment.tenantId;
    if (payment.purpose === 'PARKING_SESSION' && payment.sessionId) {
      const s = await tx.parkingSession.findUniqueOrThrow({ where: { id: payment.sessionId } });
      const paid = s.amountPaidMinor + payment.amountMinor;
      const next = s.status === 'PAYMENT_PENDING' && paid >= s.amountDueMinor ? 'EXIT_READY' : s.status;
      await tx.parkingSession.update({ where: { id: s.id }, data: { amountPaidMinor: paid, status: next, version: { increment: 1 } } });
      await tx.parkingSessionEvent.create({ data: { sessionId: s.id, type: 'PAYMENT_RECEIVED', from: s.status, to: next, data: { paymentId: payment.id, amountMinor: payment.amountMinor } } });
      await this.ledger.post(tx, { tenantId, refType: 'PAYMENT', refId: payment.id, memo: 'Digital parking fee', lines: [{ account: 'GATEWAY_CLEARING', debitMinor: payment.amountMinor }, { account: 'PARKING_REVENUE', creditMinor: payment.amountMinor }] });
      this.live.emit(s.facilityId, 'payment.succeeded', { sessionId: s.id, paymentId: payment.id });
    } else if (payment.purpose === 'RESERVATION' && payment.reservationId) {
      const r = await tx.parkingReservation.findUniqueOrThrow({ where: { id: payment.reservationId } });
      const paid = r.paidMinor + payment.amountMinor;
      const confirm = ['HELD', 'PENDING_PAYMENT'].includes(r.status);
      // Payment arrived after hold expiry/cancel: keep money, flag for refund instead of silently confirming.
      if (!confirm) {
        await tx.reconciliationRecord.create({ data: { tenantId, kind: 'GATEWAY', refId: payment.id, expected: 0, actual: payment.amountMinor, difference: payment.amountMinor, notes: `Payment for ${r.status} reservation — refund required` } });
      }
      await tx.parkingReservation.update({ where: { id: r.id }, data: { paidMinor: paid, status: confirm ? 'CONFIRMED' : r.status, holdExpiresAt: confirm ? null : r.holdExpiresAt, version: { increment: 1 } } });
      if (confirm) await tx.reservationStatusHistory.create({ data: { reservationId: r.id, from: r.status, to: 'CONFIRMED', reason: 'payment' } });
      await this.ledger.post(tx, { tenantId, refType: 'PAYMENT', refId: payment.id, memo: 'Reservation prepayment', lines: [{ account: 'GATEWAY_CLEARING', debitMinor: payment.amountMinor }, { account: 'RESERVATION_LIABILITY', creditMinor: payment.amountMinor }] });
    } else if (payment.purpose === 'PASS' && payment.passId) {
      const pass = await tx.parkingPass.findUniqueOrThrow({ where: { id: payment.passId }, include: { plan: true } });
      const from = new Date();
      await tx.parkingPass.update({ where: { id: pass.id }, data: { status: 'ACTIVE', validFrom: from, validUntil: new Date(from.getTime() + pass.plan.durationDays * 86400_000) } });
      await this.ledger.post(tx, { tenantId, refType: 'PAYMENT', refId: payment.id, memo: 'Pass purchase', lines: [{ account: 'GATEWAY_CLEARING', debitMinor: payment.amountMinor }, { account: 'PASS_REVENUE', creditMinor: payment.amountMinor }] });
    }
  }

  private async onFailed(evt: NormalizedWebhook) {
    const p = await this.prisma.payment.findUnique({ where: { providerOrderId: evt.providerOrderId ?? '' } });
    if (!p || p.status === 'SUCCEEDED') return;
    await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'FAILED' } });
    await this.prisma.paymentAttempt.create({ data: { paymentId: p.id, providerPaymentId: evt.providerPaymentId, status: 'FAILED', errorCode: evt.errorCode } });
  }

  private async onRefund(evt: NormalizedWebhook) {
    const r = await this.prisma.refund.findUnique({ where: { providerRefundId: evt.providerRefundId ?? '' } });
    if (!r || r.status === 'SUCCEEDED' || r.status === 'FAILED') return;
    await this.prisma.$transaction(async (tx) => {
      if (evt.type === 'refund.failed') {
        await tx.refund.update({ where: { id: r.id }, data: { status: 'FAILED' } });
        return;
      }
      await tx.refund.update({ where: { id: r.id }, data: { status: 'SUCCEEDED' } });
      const p = await tx.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
      const refunded = p.refundedMinor + r.amountMinor;
      await tx.payment.update({ where: { id: p.id }, data: { refundedMinor: refunded, status: refunded >= p.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await this.ledger.post(tx, { tenantId: p.tenantId, refType: 'REFUND', refId: r.id, lines: [{ account: 'REFUNDS', debitMinor: r.amountMinor }, { account: 'GATEWAY_CLEARING', creditMinor: r.amountMinor }] });
    });
  }

  async requestRefund(p: { paymentId: string; amountMinor: number; reason: string; actorId: string; tenantId: string }) {
    const payment = await this.prisma.payment.findFirst({ where: { id: p.paymentId, tenantId: p.tenantId } });
    if (!payment) throw NotFound('Payment');
    if (payment.provider === 'cash') throw new DomainError('CASH_REFUND_MANUAL', 'Cash refunds are handled from the cash drawer with a supervisor override', 422);
    if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw new DomainError('NOT_REFUNDABLE', `Payment is ${payment.status}`, 409);
    const pending = await this.prisma.refund.aggregate({ where: { paymentId: payment.id, status: { in: ['REQUESTED', 'PROCESSING'] } }, _sum: { amountMinor: true } });
    const refundable = payment.amountMinor - payment.refundedMinor - (pending._sum.amountMinor ?? 0);
    if (p.amountMinor <= 0 || p.amountMinor > refundable) throw new DomainError('REFUND_EXCEEDS', 'Refund exceeds refundable amount', 422, { refundableMinor: refundable });
    const refund = await this.prisma.refund.create({ data: { paymentId: payment.id, tenantId: p.tenantId, amountMinor: p.amountMinor, reason: p.reason, requestedById: p.actorId, status: 'PROCESSING' } });
    const lastAttempt = await this.prisma.paymentAttempt.findFirst({ where: { paymentId: payment.id, status: 'SUCCEEDED' } });
    const res = await this.provider.refund({ providerPaymentId: lastAttempt?.providerPaymentId ?? '', amountMinor: p.amountMinor, refundId: refund.id });
    await this.prisma.refund.update({ where: { id: refund.id }, data: { providerRefundId: res.providerRefundId } });
    await this.audit.log({ tenantId: p.tenantId, actorId: p.actorId, actorKind: 'USER', action: 'refund.requested', entityType: 'Refund', entityId: refund.id, after: { amountMinor: p.amountMinor, reason: p.reason } });
    return { refundId: refund.id, status: 'PROCESSING', providerRefundId: res.providerRefundId };
  }

  /** Non-production helper standing in for the hosted checkout: emits a correctly signed webhook. */
  sandboxEvent(body: Record<string, unknown>) {
    if (!sandboxAllowed()) throw Forbidden('Sandbox disabled in production');
    const payload = JSON.stringify({ id: 'evt_' + randomUUID(), ...body });
    return { raw: Buffer.from(payload), headers: { 'x-sandbox-signature': SandboxProvider.sign(payload) } };
  }
}
