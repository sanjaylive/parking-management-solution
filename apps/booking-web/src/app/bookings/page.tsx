'use client';
import { Button } from '@park2all/web-ui';
import { CalendarClock, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { api } from '@/lib/client';
import { dateTime, rupees, time } from '@/lib/format';

const label = (s: string) => (s === 'HELD' || s === 'PENDING_PAYMENT' ? 'awaiting payment' : s.toLowerCase().replace('_', ' '));
const tone: Record<string, string> = { CONFIRMED: 'bg-success/12 text-success', CHECKED_IN: 'bg-brand/12 text-brand', HELD: 'bg-warning/15 text-warning', PENDING_PAYMENT: 'bg-warning/15 text-warning' };

export default function Bookings() {
  const { me, ready, requireLogin } = useAuth();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setItems(null);
    api(`/v1/me/reservations?scope=${scope}`).then(setItems).catch((e) => setError(e.message));
  }, [me, scope]);

  if (ready && !me)
    return (
      <div className="mx-auto max-w-md pt-24 text-center">
        <h1 className="text-2xl font-extrabold">Your bookings</h1>
        <p className="mt-2 text-muted">Sign in with your mobile number to see bookings and QR passes.</p>
        <Button size="lg" className="mt-6" onClick={() => requireLogin()}>Sign in</Button>
      </div>
    );

  return (
    <div className="space-y-5 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">My bookings</h1>
        <div className="inline-flex rounded-xl border border-border bg-surface p-1">
          {(['upcoming', 'past'] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={`rounded-lg px-4 py-1.5 text-sm font-bold capitalize ${scope === s ? 'bg-grad text-white' : 'text-muted'}`}>{s}</button>
          ))}
        </div>
      </div>
      {error && <p className="rounded-2xl bg-danger/10 p-4 text-sm text-danger">{error}</p>}
      {!items && !error && <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-24" />)}</div>}
      {items?.length === 0 && (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <CalendarClock className="mx-auto size-8 text-muted" />
          <p className="mt-3 font-bold">{scope === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}</p>
          <Link href="/" className="mt-2 inline-block text-sm font-semibold text-brand">Find parking</Link>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {items?.map((r) => (
          <Link key={r.id} href={`/bookings/${r.id}`} className="card flex items-center gap-4 p-5 transition hover:border-brand/40">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="truncate font-bold">{r.facility.name}</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone[r.status] ?? 'bg-surface-2 text-muted'}`}>{label(r.status)}</span></div>
              <div className="mt-1 text-sm text-muted">{dateTime(r.startsAt)} – {time(r.endsAt)}</div>
              <div className="mt-1 font-mono text-sm font-bold">{r.vehicle.plateDisplay} · {rupees(r.amountMinor)}</div>
            </div>
            {r.qrToken && <QrCode className="size-8 text-brand" />}
          </Link>
        ))}
      </div>
    </div>
  );
}
