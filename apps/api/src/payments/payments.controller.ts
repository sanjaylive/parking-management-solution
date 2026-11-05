import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod';
import { AuthUser, CurrentUser, Public, RequirePerm, Tenant, TenantContext } from '../auth/context';
import { P } from '../auth/permissions';
import { PaymentsService } from './payments.service';

const orderSchema = z.object({
  purpose: z.enum(['PARKING_SESSION', 'RESERVATION', 'PASS']),
  sessionId: z.string().uuid().optional(),
  reservationId: z.string().uuid().optional(),
  passId: z.string().uuid().optional(),
});
const refundSchema = z.object({ amountMinor: z.number().int().positive(), reason: z.string().min(3).max(500) });
const simulateSchema = z.object({ orderId: z.string(), outcome: z.enum(['success', 'failure']).default('success'), method: z.enum(['UPI', 'CARD', 'NETBANKING', 'WALLET']).default('UPI'), amountMinor: z.number().int().optional() });

@ApiTags('payments')
@Controller('v1/payments')
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private prisma: PrismaService,
  ) {}

  /** Customer-initiated order (customer app / booking web). Ownership enforced in service. */
  @Post('orders')
  createOrder(@CurrentUser() u: AuthUser, @Body(new ZodPipe(orderSchema)) b: z.infer<typeof orderSchema>) {
    return this.payments.createOrder({ ...b, requester: { userId: u.userId } });
  }

  /** Staff-initiated order (e.g. show UPI QR at exit lane). */
  @Post('staff-orders')
  @RequirePerm(P.SESSION_EXIT)
  createStaffOrder(@Tenant() t: TenantContext, @Body(new ZodPipe(orderSchema)) b: z.infer<typeof orderSchema>) {
    return this.payments.createOrder({ ...b, requester: { userId: t.userId, tenantId: t.tenantId } });
  }

  @Get(':id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('x-tenant-id') tenantId?: string) {
    return this.payments.getStatus(id, { userId: u.userId, tenantId: undefined }).catch(async (e) => {
      if (!tenantId) throw e;
      const m = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId, userId: u.userId } } });
      if (!m?.active) throw e;
      return this.payments.getStatus(id, { userId: u.userId, tenantId });
    });
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: any) {
    if (!req.rawBody) throw new DomainError('RAW_BODY_REQUIRED', 'Raw body unavailable', 400);
    return this.payments.handleWebhook(provider, req.rawBody, req.headers);
  }

  /** NON-PRODUCTION: stands in for the hosted checkout page completing a payment. */
  @Post('sandbox/simulate')
  @HttpCode(200)
  async simulate(@Body(new ZodPipe(simulateSchema)) b: z.infer<typeof simulateSchema>) {
    const p = await this.prisma.payment.findUnique({ where: { providerOrderId: b.orderId } });
    if (!p) throw new DomainError('NOT_FOUND', 'Order not found', 404);
    const evt = this.payments.sandboxEvent({
      type: b.outcome === 'success' ? 'payment.succeeded' : 'payment.failed', orderId: b.orderId, paymentId: 'sbx_pay_' + p.id.slice(0, 8),
      amountMinor: b.amountMinor ?? p.amountMinor, method: b.method, errorCode: b.outcome === 'failure' ? 'PAYMENT_DECLINED' : undefined,
    });
    return this.payments.handleWebhook('sandbox', evt.raw, evt.headers);
  }

  @Post(':id/refunds')
  @RequirePerm(P.REFUND_REQUEST)
  refund(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(refundSchema)) b: z.infer<typeof refundSchema>) {
    return this.payments.requestRefund({ paymentId: id, ...b, actorId: t.userId, tenantId: t.tenantId });
  }
}
