'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, CheckCircle2, DoorOpen, QrCode, Smartphone, TriangleAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, ErrorState, SearchableCombobox, VehicleNumberPlate } from '@/components/ui';
import { api, ApiError, duration, rupees, vehicleLabel } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { cn } from '@/lib/cn';

type Mode = 'ENTRY' | 'EXIT';
const CLASSES = ['CAR', 'SUV', 'TWO_WHEELER', 'EV_CAR'];

function credentialFrom(input: string) {
  const v = input.trim();
  if (v.startsWith('P2A1.')) return { type: 'QR', token: v };
  if (/^[A-Z0-9]{2,8}-\d{6}-\d{8}$/i.test(v)) return { type: 'TICKET', number: v.toUpperCase() };
  return { type: 'PLATE_MANUAL', plate: v };
}

function BarrierResult({ b }: { b: any }) {
  if (!b) return null;
  if (b.status === 'ACKED') return <Badge tone="success"><DoorOpen className="size-3.5" />Barrier opened</Badge>;
  if (b.status === 'NO_DEVICE') return <Badge tone="neutral">Manual gate — wave vehicle through</Badge>;
  return <Badge tone="danger"><TriangleAlert className="size-3.5" />Barrier {b.status.toLowerCase()} — request supervisor manual open</Badge>;
}

export default function GateConsole() {
  const { facilityId, facilities } = useApp();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('ENTRY');
  const [input, setInput] = useState('');
  const [vehicleClass, setVehicleClass] = useState<string>('CAR');
  const [lostTicket, setLostTicket] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [gateId, setGateId] = useState<string | null>(null);

  const facility = useQuery({ queryKey: ['facility', facilityId], queryFn: () => api(`/v1/facilities/${facilityId}`), enabled: !!facilityId });
  const shift = useQuery({ queryKey: ['shift'], queryFn: () => api('/v1/shifts/current') });
  const gates = (facility.data?.gates ?? []).filter((g: any) => g.direction === 'BOTH' || g.direction === mode);
  const effectiveGate = gates.find((g: any) => g.id === gateId)?.id ?? gates[0]?.id;

  const onError = (e: unknown) => {
    const err = e as ApiError;
    toast.error(err.message, { description: err.code });
  };

  const entry = useMutation({
    mutationFn: () => api('/v1/gate/entry', { method: 'POST', idempotent: true, json: { facilityId, gateId: effectiveGate, credential: credentialFrom(input), vehicleClass } }),
    onSuccess: (r) => { setResult({ kind: 'entry', ...r }); setInput(''); qc.invalidateQueries(); toast.success(`Entry recorded · ${r.plateDisplay}`); },
    onError,
  });
  const doQuote = useMutation({
    mutationFn: () => api('/v1/gate/exit/quote', { method: 'POST', json: { facilityId, gateId: effectiveGate, credential: credentialFrom(input), lostTicket: lostTicket || undefined } }),
    onSuccess: (q) => { setQuote(q); setResult(null); },
    onError,
  });
  const cash = useMutation({
    mutationFn: () => api(`/v1/gate/sessions/${quote.sessionId}/cash`, { method: 'POST', idempotent: true, json: { amountMinor: quote.outstandingMinor } }),
    onSuccess: () => { toast.success('Cash recorded'); setQuote((q: any) => ({ ...q, outstandingMinor: 0, status: 'EXIT_READY' })); qc.invalidateQueries({ queryKey: ['shift'] }); },
    onError,
  });
  const upi = useMutation({
    mutationFn: () => api('/v1/payments/staff-orders', { method: 'POST', json: { purpose: 'PARKING_SESSION', sessionId: quote.sessionId } }),
    onSuccess: (o) => setQuote((q: any) => ({ ...q, order: o })),
    onError,
  });
  const exitConfirm = useMutation({
    mutationFn: () => api('/v1/gate/exit/confirm', { method: 'POST', idempotent: true, json: { facilityId, gateId: effectiveGate, credential: { type: 'PLATE_MANUAL', plate: quote.plate } } }),
    onSuccess: (r) => { setResult({ kind: 'exit', ...r }); setQuote(null); setInput(''); qc.invalidateQueries(); toast.success('Exit complete'); },
    onError: (e) => {
      const err = e as ApiError;
      if (err.code === 'PAYMENT_REQUIRED') setQuote((q: any) => ({ ...q, outstandingMinor: err.details.outstandingMinor, totalMinor: err.details.totalMinor }));
      onError(e);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    mode === 'ENTRY' ? entry.mutate() : doQuote.mutate();
  }

  if (facility.error) return <ErrorState error={facility.error} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-2xl border border-border bg-surface p-1">
            {(['ENTRY', 'EXIT'] as Mode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setQuote(null); setResult(null); setGateId(null); }} className={cn('flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition', mode === m ? 'bg-grad text-white shadow' : 'text-muted hover:text-text')}>
                {m === 'ENTRY' ? <ArrowDownToLine className="size-4" /> : <ArrowUpFromLine className="size-4" />}{m === 'ENTRY' ? 'Entry lane' : 'Exit lane'}
              </button>
            ))}
          </div>
          <div className="w-56">
            <SearchableCombobox ariaLabel="Gate" clearable={false} value={effectiveGate} onChange={(v) => setGateId(v)} options={gates.map((g: any) => ({ value: g.id, label: g.name, hint: g.code }))} placeholder="No gate" />
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-5 p-6">
          <label className="block">
            <span className="text-sm font-semibold text-muted">{mode === 'ENTRY' ? 'Scan QR or type vehicle number' : 'Scan ticket / QR or type vehicle number'}</span>
            <div className="relative mt-2">
              <QrCode className="absolute left-4 top-1/2 size-6 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="KA 01 AB 1234"
                className="h-16 w-full rounded-2xl border-2 border-border bg-surface pl-14 pr-4 font-mono text-2xl font-bold tracking-widest outline-none transition focus:border-brand focus:ring-4 focus:ring-[var(--ring)]"
                aria-label="Credential"
              />
            </div>
          </label>
          {mode === 'ENTRY' ? (
            <div>
              <span className="text-sm font-semibold text-muted">Vehicle type (walk-ins)</span>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CLASSES.map((c) => (
                  <button type="button" key={c} onClick={() => setVehicleClass(c)} className={cn('h-14 rounded-xl border-2 text-sm font-bold transition', vehicleClass === c ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:border-brand/40')}>{vehicleLabel[c]}</button>
                ))}
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-3 text-sm font-medium">
              <input type="checkbox" checked={lostTicket} onChange={(e) => setLostTicket(e.target.checked)} className="size-5 accent-[var(--brand)]" />
              Lost ticket (requires vehicle number, adds lost-ticket fee)
            </label>
          )}
          <Button type="submit" size="xl" className="w-full" loading={entry.isPending || doQuote.isPending} disabled={!facilityId}>
            {mode === 'ENTRY' ? 'Admit vehicle' : 'Find session & calculate fee'}
          </Button>
        </form>

        {quote && (
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 p-5">
              <div className="flex items-center gap-3"><VehicleNumberPlate plate={quote.plate} size="lg" /><Badge tone="brand">{quote.source.toLowerCase()}</Badge></div>
              <div className="text-right"><div className="text-xs text-muted">Parked</div><div className="text-lg font-bold tabular">{duration(quote.durationMinutes)}</div></div>
            </div>
            <div className="space-y-2 p-5">
              {quote.lines.map((l: any, i: number) => (
                <div key={i} className="flex justify-between text-sm"><span className="text-muted">{l.label}</span><span className="font-semibold tabular">{rupees(l.amountMinor)}</span></div>
              ))}
              {quote.adjustmentsMinor !== 0 && <div className="flex justify-between text-sm"><span className="text-muted">Adjustments</span><span className="font-semibold tabular">{rupees(quote.adjustmentsMinor)}</span></div>}
              {quote.paidMinor > 0 && <div className="flex justify-between text-sm"><span className="text-muted">Already paid</span><span className="font-semibold text-success tabular">−{rupees(quote.paidMinor)}</span></div>}
              <div className="flex items-end justify-between border-t border-dashed border-border pt-3">
                <span className="font-semibold">{quote.outstandingMinor > 0 ? 'To collect' : 'Nothing due'}</span>
                <span className={cn('text-4xl font-extrabold tabular', quote.outstandingMinor > 0 ? 'text-text' : 'text-success')}>{rupees(quote.outstandingMinor)}</span>
              </div>
            </div>
            <div className="grid gap-3 border-t border-border p-5 sm:grid-cols-3">
              {quote.outstandingMinor > 0 ? (
                <>
                  <Button size="lg" variant="secondary" onClick={() => cash.mutate()} loading={cash.isPending} disabled={!shift.data} title={!shift.data ? 'Open a shift first' : undefined}><Banknote className="size-5" />Cash</Button>
                  <Button size="lg" variant="secondary" onClick={() => upi.mutate()} loading={upi.isPending}><Smartphone className="size-5" />UPI / Card</Button>
                  <Button size="lg" variant="ghost" onClick={() => doQuote.mutate()} loading={doQuote.isPending}>Refresh status</Button>
                </>
              ) : (
                <Button size="xl" variant="success" className="sm:col-span-3" onClick={() => exitConfirm.mutate()} loading={exitConfirm.isPending}><CheckCircle2 className="size-6" />Confirm exit & open barrier</Button>
              )}
            </div>
            {quote.order && quote.outstandingMinor > 0 && (
              <div className="border-t border-border bg-brand/5 p-5 text-sm">
                Payment order <span className="font-mono">{quote.order.checkout.orderId}</span> created for {rupees(quote.order.amountMinor)}. The exit unlocks automatically once the payment provider confirms — never on the customer's screen alone. Tap <b>Refresh status</b> after the customer pays.
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="card flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-success/12 text-success"><CheckCircle2 className="size-8" /></div>
            <div className="flex-1 space-y-2">
              {result.kind === 'entry' ? (
                <>
                  <div className="flex flex-wrap items-center gap-2"><VehicleNumberPlate plate={result.plate} /><Badge tone="brand">{result.source.toLowerCase()}</Badge>{result.slot && <Badge tone="cyan">Slot {result.slot.code} · {result.slot.zoneName}</Badge>}</div>
                  <div className="text-sm text-muted">Ticket <span className="font-mono font-semibold text-text">{result.ticket.number}</span></div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2"><VehicleNumberPlate plate={result.receipt.plate} /><span className="text-sm text-muted">{duration(result.receipt.durationMinutes)} · {rupees(result.receipt.totalMinor)}</span></div>
                  <div className="text-sm text-muted">Receipt {result.receipt.payments.map((p: any) => p.receiptNumber).filter(Boolean).join(', ') || '—'}</div>
                </>
              )}
              <BarrierResult b={result.barrier} />
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-muted">Shift</div>
          <ShiftPanel facilityId={facilityId} shift={shift.data} gateId={effectiveGate} />
        </div>
        <div className="card p-5 text-sm text-muted">
          <p className="mb-2 font-semibold text-text">Lane tips</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Scanner input goes straight into the field — QR, ticket number or plate.</li>
            <li>Reservations and passes are detected automatically from the plate.</li>
            <li>Barrier failures never undo the entry — use a supervisor override for manual open.</li>
          </ul>
          <p className="mt-3 text-xs">Facility: {facilities.find((f) => f.id === facilityId)?.name ?? '—'}</p>
        </div>
      </aside>
    </div>
  );
}

function ShiftPanel({ facilityId, shift, gateId }: { facilityId?: string; shift: any; gateId?: string }) {
  const qc = useQueryClient();
  const [declared, setDeclared] = useState('');
  const open = useMutation({ mutationFn: () => api('/v1/shifts/open', { method: 'POST', json: { facilityId, gateId, openingFloatMinor: 0 } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['shift'] }), onError: (e) => toast.error((e as Error).message) });
  const close = useMutation({
    mutationFn: () => api(`/v1/shifts/${shift.id}/close`, { method: 'POST', json: { declaredCashMinor: Math.round(Number(declared) * 100) } }),
    onSuccess: (r) => { toast.success(r.varianceMinor === 0 ? 'Shift closed — cash matches' : `Shift closed with ${r.varianceMinor < 0 ? 'shortage' : 'overage'} of ${rupees(Math.abs(r.varianceMinor))}`); qc.invalidateQueries({ queryKey: ['shift'] }); setDeclared(''); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!shift) return <Button className="w-full" onClick={() => open.mutate()} loading={open.isPending} disabled={!facilityId}>Open shift</Button>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><Badge tone="success">Open since {new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Badge></div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-surface-2 p-3"><div className="text-muted">Collected</div><div className="text-lg font-bold tabular">{rupees(shift.collectedMinor)}</div></div>
        <div className="rounded-xl bg-surface-2 p-3"><div className="text-muted">In drawer</div><div className="text-lg font-bold tabular">{rupees(shift.expectedCashMinor)}</div></div>
      </div>
      <input value={declared} onChange={(e) => setDeclared(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Counted cash (₹)" className="h-11 w-full rounded-xl border border-border bg-surface px-3 outline-none focus:border-brand" aria-label="Counted cash" />
      <Button variant="secondary" className="w-full" onClick={() => close.mutate()} loading={close.isPending} disabled={!declared}>Close shift</Button>
    </div>
  );
}
