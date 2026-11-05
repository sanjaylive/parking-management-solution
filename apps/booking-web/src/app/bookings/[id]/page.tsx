'use client';
import { Button } from '@park2all/web-ui';
import { ArrowLeft, Clock, MapPin, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth';
import { Checkout } from '@/components/checkout';
import { QR } from '@/components/qr';
import { api } from '@/lib/client';
import { dateTime, rupees, time } from '@/lib/format';

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { me, ready, requireLogin } = useAuth();
  const [b, setB] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(() => api(`/v1/me/reservations/${id}`).then(setB).catch((e) => setError(e.message)), [id]);
  useEffect(() => { if (me) load(); }, [me, load]);

  if (ready && !me) return <div className="pt-24 text-center"><Button size="lg" onClick={() => requireLogin()}>Sign in to view this booking</Button></div>;
  if (error) return <p className="mt-10 rounded-2xl bg-danger/10 p-4 text-danger">{error}</p>;
  if (!b) return <div className="mx-auto mt-10 max-w-md space-y-4"><div className="skeleton h-96" /></div>;

  const unpaid = b.status === 'HELD' || b.status === 'PENDING_PAYMENT';
  const cancellable = unpaid || b.status === 'CONFIRMED';

  async function pay() {
    setBusy(true);
    try { setOrder(await api('/v1/payments/orders', { json: { purpose: 'RESERVATION', reservationId: id } })); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try {
      const r = await api(`/v1/me/reservations/${id}/cancel`, { method: 'POST' });
      toast.success(r.refundDueMinor > 0 ? `Cancelled. Refund of ${rupees(r.refundDueMinor)} will be processed.` : 'Booking cancelled');
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setConfirmCancel(false); }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 pt-6">
      <Link href="/bookings" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-text"><ArrowLeft className="size-4" />My bookings</Link>
      <div className="overflow-hidden rounded-3xl bg-grad p-6 text-center text-white shadow-xl">
        <div className="flex items-center justify-between text-left"><span className="font-bold">{b.facility.name}</span><span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">{unpaid ? 'awaiting payment' : b.status.toLowerCase().replace('_', ' ')}</span></div>
        <div className="mx-auto mt-6 grid w-fit place-items-center rounded-2xl bg-white p-3">
          {b.qrToken ? <QR value={b.qrToken} /> : <div className="grid size-[220px] place-items-center px-6 text-sm font-semibold text-[#5b6785]">{unpaid ? 'Your QR pass appears once payment is confirmed' : 'This pass is no longer valid'}</div>}
        </div>
        <div className="mt-4 font-mono text-xl font-extrabold tracking-widest">{b.code}</div>
        <p className="mt-1 text-sm text-white/80">{b.qrToken ? 'Show at the entry gate — your number plate also works.' : ''}</p>
        <div className="mt-3 inline-block rounded-md border-2 border-white bg-white px-2 py-0.5 font-mono font-bold text-[#0b1530]">{b.vehicle.plateDisplay}</div>
      </div>

      {unpaid && (
        <div className="space-y-2">
          <Button size="lg" className="w-full" loading={busy} onClick={pay}>Pay {rupees(b.amountMinor - b.paidMinor)} to confirm</Button>
          {b.holdExpiresAt && <p className="text-center text-sm font-semibold text-warning">Spot held until {time(b.holdExpiresAt)}</p>}
        </div>
      )}

      <div className="card divide-y divide-border">
        <div className="flex gap-3 p-4"><MapPin className="size-5 text-muted" /><div><div className="font-semibold">{b.facility.name}</div><div className="text-sm text-muted">{b.facility.addressLine}</div></div></div>
        <div className="flex gap-3 p-4"><Clock className="size-5 text-muted" /><div><div className="font-semibold">{dateTime(b.startsAt)}</div><div className="text-sm text-muted">until {dateTime(b.endsAt)}</div></div></div>
        <div className="flex gap-3 p-4"><Receipt className="size-5 text-muted" /><div><div className="font-semibold">{rupees(b.amountMinor)}</div><div className="text-sm text-muted">{b.paidMinor > 0 ? `Paid ${rupees(b.paidMinor)}` : 'Not paid'}</div></div></div>
      </div>
      {cancellable && !confirmCancel && <Button variant="secondary" className="w-full" onClick={() => setConfirmCancel(true)}>Cancel booking</Button>}
      {cancellable && confirmCancel && (
        <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-4" role="alertdialog" aria-label="Confirm cancellation">
          <p className="text-sm">Cancel this booking? Free until {b.facility.cancellationPolicy?.freeUntilMinutesBefore ?? 60} min before start; after that a {b.facility.cancellationPolicy?.feePercent ?? 0}% fee applies.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>Keep booking</Button>
            <Button variant="danger" loading={busy} onClick={cancel}>Yes, cancel</Button>
          </div>
        </div>
      )}

      {order && <Checkout open order={order} title="Pay for your booking" onClose={(paid) => { setOrder(null); if (paid) toast.success('Booking confirmed'); load(); }} />}
    </div>
  );
}
