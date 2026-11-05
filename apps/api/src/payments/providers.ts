import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { hmacSha256, safeEqualHex } from '../common/crypto';

export interface CreateOrderInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
  description: string;
}

export interface ProviderOrder {
  providerOrderId: string;
  /** Data the client SDK needs to open the checkout (key id, order id...). Never contains secrets. */
  checkout: Record<string, unknown>;
}

export interface NormalizedWebhook {
  providerEventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'refund.failed' | 'other';
  providerOrderId?: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  amountMinor?: number;
  method?: 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET';
  errorCode?: string;
}

export interface PaymentProvider {
  readonly key: string;
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  /** MUST verify signature over the raw body. Returns null when invalid. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedWebhook | null;
  refund(input: { providerPaymentId: string; amountMinor: number; refundId: string }): Promise<{ providerRefundId: string }>;
}

/**
 * Sandbox provider: behaves like a hosted gateway. Orders are created locally; "completion" happens
 * through a signed webhook (POST /v1/payments/sandbox/simulate in non-production), exercising exactly
 * the same verification + reconciliation code path as a real provider.
 */
export class SandboxProvider implements PaymentProvider {
  readonly key = 'sandbox';

  async createOrder(i: CreateOrderInput): Promise<ProviderOrder> {
    const providerOrderId = 'sbx_order_' + randomUUID().replace(/-/g, '').slice(0, 20);
    return { providerOrderId, checkout: { provider: 'sandbox', orderId: providerOrderId, amountMinor: i.amountMinor, currency: i.currency } };
  }

  static sign(rawBody: string) {
    return hmacSha256(env().PAYMENT_WEBHOOK_SECRET, rawBody);
  }

  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedWebhook | null {
    const sig = headers['x-sandbox-signature'];
    if (typeof sig !== 'string' || !safeEqualHex(sig, SandboxProvider.sign(raw.toString('utf8')))) return null;
    const body = JSON.parse(raw.toString('utf8'));
    return {
      providerEventId: body.id,
      type: body.type,
      providerOrderId: body.orderId,
      providerPaymentId: body.paymentId,
      providerRefundId: body.refundId,
      amountMinor: body.amountMinor,
      method: body.method,
      errorCode: body.errorCode,
    };
  }

  async refund(i: { providerPaymentId: string; amountMinor: number; refundId: string }) {
    return { providerRefundId: 'sbx_rfnd_' + i.refundId.replace(/-/g, '').slice(0, 20) };
  }
}

/**
 * Razorpay adapter — PENDING: requires merchant credentials (key id/secret, webhook secret) and
 * settlement/route setup for marketplace payouts. Interface is fixed; implementation intentionally
 * throws so nothing ever reports a fake success.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly key = 'razorpay';
  createOrder(): Promise<ProviderOrder> {
    throw new Error('Razorpay adapter not configured (credentials pending)');
  }
  verifyWebhook(): NormalizedWebhook | null {
    return null;
  }
  refund(): Promise<{ providerRefundId: string }> {
    throw new Error('Razorpay adapter not configured (credentials pending)');
  }
}

export function providerFor(key: string): PaymentProvider {
  if (key === 'sandbox') return new SandboxProvider();
  if (key === 'razorpay') return new RazorpayProvider();
  throw new Error('Unknown payment provider ' + key);
}
