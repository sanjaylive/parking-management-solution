'use client';
import { Button } from '@park2all/web-ui';
import { CalendarClock, Car } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/client';
import { rupees, vehicleLabel } from '@/lib/format';
import { useAuth } from './auth';
import { Checkout } from './checkout';

const DURATIONS = [1, 2, 3, 4, 6, 8, 12, 24];

function defaultStart() {
  const d = new Date(Date.now() + 20 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}
/** value for <input type="datetime-local"> in the browser's local time */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ReservePanel({ facilityId, classes }: { facilityId: string; classes: string[] }) {
  const router = useRouter();
  const { me, requireLogin } = useAuth();
  const [start, setStart] = useState(defaultStart);
  const [hours, setHours] = useState(2);
  const [vehicleClass, setVehicleClass] = useState(classes.includes('CAR') ? 'CAR' : classes[0]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [plate, setPlate] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<{ order: any; reservationId: string } | null>(null);
  const end = useMemo(() => new Date(start.getTime() + hours * 3600_000), [start, hours]);

  useEffect(() => {
    if (!me) return setVehicles([]);
    api('/v1/me/vehicles').then((vs: any[]) => {
      setVehicles(vs);
      const usable = vs.filter((v) => classes.includes(v.vehicle.vehicleClass));
      if (usable[0]) {
        setVehicleId(usable[0].vehicleId);
        setVehicleClass(usable[0].vehicle.vehicleClass);
      }
    }).catch(() => undefined);
  }, [me, classes]);

  // Price always comes from the server.
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    setQuoteError(null);
    const t = setTimeout(() => {
      api(`/v1/public/facilities/${facilityId}/quote`, { json: { vehicleClass, startsAt: start.toISOString(), endsAt: end.toISOString() } })
        .then((q) => !cancelled && setQuote(q))
        .catch((e) => !cancelled && setQuoteError((e as Error).message));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [facilityId, vehicleClass, start, end]);

  async function book() {
    setBusy(true);
    try {
      await requireLogin();
      let vid = vehicleId;
      if (!vid) {
        const p = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (p.length < 4) throw new ApiError(400, 'PLATE', 'Enter your vehicle number');
        vid = (await api('/v1/me/vehicles', { json: { plate: p, vehicleClass } })).vehicleId;
      }
      const r = await api('/v1/me/reservations', { json: { facilityId, vehicleId: vid, startsAt: start.toISOString(), endsAt: end.toISOString() } });
      if (r.status === 'HELD') {
        const order = await api('/v1/payments/orders', { json: { purpose: 'RESERVATION', reservationId: r.id } });
        setCheckout({ order, reservationId: r.id });
      } else {
        router.push(`/bookings/${r.id}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const usableVehicles = vehicles.filter((v) => classes.includes(v.vehicle.vehicleClass));
  return (
    <div className="card space-y-5 p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarClock className="size-5 text-brand" />Reserve a spot</h2>

      <div className="space-y-2">
        <span className="text-sm font-semibold text-muted">Vehicle</span>
        {usableVehicles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {usableVehicles.map((v) => (
              <button key={v.vehicleId} onClick={() => { setVehicleId(v.vehicleId); setVehicleClass(v.vehicle.vehicleClass); }} className={`rounded-xl border-2 px-3 py-2 font-mono text-sm font-bold ${vehicleId === v.vehicleId ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted'}`}>{v.vehicle.plateDisplay}</button>
            ))}
            <button onClick={() => setVehicleId(null)} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${vehicleId === null ? 'border-brand text-brand' : 'border-dashed border-border text-muted'}`}>+ Another</button>
          </div>
        ) : null}
        {vehicleId === null && (
          <>
            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="KA 01 AB 1234" aria-label="Vehicle number" className="h-12 w-full rounded-xl border border-border bg-surface px-3.5 font-mono text-lg font-bold tracking-wider outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)]" />
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => (
                <button key={c} onClick={() => setVehicleClass(c)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${vehicleClass === c ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted'}`}><Car className="mr-1 inline size-3.5" />{vehicleLabel[c] ?? c}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-semibold text-muted">Arrival</span>
        <input
          type="datetime-local"
          value={toLocalInput(start)}
          min={toLocalInput(new Date())}
          onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime()) && d.getTime() > Date.now()) setStart(d); }}
          className="h-12 w-full rounded-xl border border-border bg-surface px-3.5 outline-none focus:border-brand"
        />
      </label>

      <div className="space-y-2">
        <span className="text-sm font-semibold text-muted">Duration</span>
        <div className="grid grid-cols-4 gap-2">
          {DURATIONS.map((h) => (
            <button key={h} onClick={() => setHours(h)} className={`h-10 rounded-xl border-2 text-sm font-bold ${hours === h ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted'}`}>{h === 24 ? '1 day' : `${h}h`}</button>
          ))}
        </div>
        <p className="text-sm text-muted">Until {end.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
      </div>

      <div className="rounded-2xl bg-surface-2 p-4" aria-live="polite">
        {quoteError ? (
          <p className="text-sm text-danger">{quoteError}</p>
        ) : !quote ? (
          <div className="space-y-2"><div className="skeleton h-4 w-2/3" /><div className="skeleton h-8 w-1/3" /></div>
        ) : (
          <>
            {quote.lines.map((l: any) => <div key={l.code} className="flex justify-between text-sm text-muted"><span>{l.label}</span><span className="tabular">{rupees(l.amountMinor)}</span></div>)}
            <div className="mt-2 flex items-end justify-between border-t border-border pt-2"><span className="font-semibold">Total</span><span className="text-3xl font-extrabold tabular">{rupees(quote.netMinor)}</span></div>
            <p className={`mt-1 text-sm font-semibold ${quote.available > 0 ? 'text-success' : 'text-danger'}`}>{quote.available > 0 ? `${quote.available} bookable spaces left` : 'Fully booked for this time'}</p>
          </>
        )}
      </div>

      <Button size="lg" className="w-full" loading={busy} disabled={!quote || quote.available === 0} onClick={book}>
        {me?.profileComplete ? `Book for ${quote ? rupees(quote.netMinor) : '…'}` : 'Sign in & book'}
      </Button>
      <p className="text-xs text-muted">Overstay beyond your booking is charged at the standard rate on exit.</p>

      {checkout && (
        <Checkout
          open
          order={checkout.order}
          title="Pay for your booking"
          onClose={(paid) => {
            const id = checkout.reservationId;
            setCheckout(null);
            if (!paid) toast.message('Spot held for a few minutes — pay from My bookings to confirm.');
            router.push(`/bookings/${id}`);
          }}
        />
      )}
    </div>
  );
}
