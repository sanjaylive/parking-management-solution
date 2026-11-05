'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@park2all/web-ui';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client';
import { rupees } from '@/lib/format';

/**
 * Checkout. This build uses the Park2All SANDBOX provider: "Pay" asks the API to emit a signed provider
 * webhook, exercising the real verification path. Production swaps in the gateway's hosted checkout
 * (adapter pending merchant credentials). Either way the page only trusts the server's payment status.
 */
export function Checkout({ order, title, open, onClose }: { order: any; title: string; open: boolean; onClose: (paid: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'paying' | 'verifying'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState('UPI');

  async function pay(outcome: 'success' | 'failure') {
    setError(null);
    setState('paying');
    try {
      await api('/v1/payments/sandbox/simulate', { json: { orderId: order.checkout.orderId, method, outcome } });
      setState('verifying');
      for (let i = 0; i < 10; i++) {
        const s = await api(`/v1/payments/${order.paymentId}/status`);
        if (s.status === 'SUCCEEDED') return onClose(true);
        if (s.status === 'FAILED') throw new Error('Payment was declined. No money was taken.');
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error('Still waiting for the bank. Your booking updates automatically once it confirms.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState('idle');
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && state === 'idle' && onClose(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/60 backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined} className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-t-3xl bg-surface p-6 shadow-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
          <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
          <div className="mt-1 text-4xl font-extrabold tabular">{rupees(order?.amountMinor)}</div>
          <div className="mt-4 flex gap-2 rounded-xl bg-warning/12 p-3 text-sm"><FlaskConical className="size-5 shrink-0 text-warning" />Sandbox payment — no real money moves. Confirmation still comes from a verified provider webhook.</div>
          <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
            {[['UPI', 'UPI'], ['CARD', 'Card'], ['NETBANKING', 'Net banking']].map(([k, l]) => (
              <button key={k} role="radio" aria-checked={method === k} onClick={() => setMethod(k)} className={`h-11 rounded-xl border-2 text-sm font-bold ${method === k ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted'}`}>{l}</button>
            ))}
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          <Button size="lg" className="mt-5 w-full" loading={state !== 'idle'} onClick={() => pay('success')}>
            {state === 'verifying' ? 'Confirming with bank…' : `Pay ${rupees(order?.amountMinor)}`}
          </Button>
          <button disabled={state !== 'idle'} onClick={() => pay('failure')} className="mt-3 w-full text-sm font-semibold text-muted hover:text-text">Simulate a declined payment</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
