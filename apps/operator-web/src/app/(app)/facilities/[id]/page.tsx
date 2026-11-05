'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Accessibility, ArrowLeft, Ban, BatteryCharging, RefreshCcw, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, ErrorState, OccupancyRing, SectionTitle, Skeleton, VehicleNumberPlate } from '@/components/ui';
import { api, rupees, vehicleLabel } from '@/lib/api';
import { cn } from '@/lib/cn';

const SLOT_STYLE: Record<string, string> = {
  AVAILABLE: 'border-success/40 bg-success/10 text-success hover:bg-success/20',
  OCCUPIED: 'border-brand/50 bg-brand/15 text-brand',
  RESERVED: 'border-violet/50 bg-violet/15 text-violet',
  HELD: 'border-violet/40 bg-violet/10 text-violet',
  BLOCKED: 'border-warning/50 bg-warning/15 text-warning',
  OUT_OF_SERVICE: 'border-danger/40 bg-danger/10 text-danger',
};

/** ParkingZoneMap: grid of ParkingSlotTiles grouped by zone, with block/unblock actions. */
function ParkingZoneMap({ facilityId, zones }: { facilityId: string; zones: any[] }) {
  const qc = useQueryClient();
  const slots = useQuery({ queryKey: ['slots', facilityId], queryFn: () => api<any[]>(`/v1/facilities/${facilityId}/slots`) });
  const [sel, setSel] = useState<any>(null);
  const setState = useMutation({
    mutationFn: (state: string) => api(`/v1/facilities/${facilityId}/slots/${sel.id}/state`, { method: 'PATCH', json: { state, reason: 'Set from operator console' } }),
    onSuccess: () => { toast.success('Slot updated'); setSel(null); qc.invalidateQueries(); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (slots.isLoading) return <Skeleton className="h-64" />;
  if (!slots.data?.length) return <p className="text-sm text-muted">This facility uses capacity-based parking — no numbered slots.</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.keys(SLOT_STYLE).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn('size-3 rounded border', SLOT_STYLE[k])} />{k.replace(/_/g, ' ').toLowerCase()}</span>)}
      </div>
      {zones.map((z) => {
        const zs = slots.data!.filter((s) => s.zoneId === z.id);
        if (!zs.length) return null;
        return (
          <div key={z.id}>
            <div className="mb-2 flex items-center gap-2 text-sm font-bold">{z.name}<span className="font-normal text-muted">· {zs.filter((s) => s.state === 'AVAILABLE').length} free of {zs.length}</span></div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min((z.layout as any)?.cols ?? 10, 12)}, minmax(0, 1fr))` }}>
              {zs.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSel(s)}
                  title={`${s.code} · ${s.state.toLowerCase()}${s.assignments[0] ? ` · ${s.assignments[0].session.plateNormalized}` : ''}`}
                  className={cn('relative flex aspect-[3/4] flex-col items-center justify-center rounded-lg border text-[10px] font-bold transition sm:text-xs', SLOT_STYLE[s.state], sel?.id === s.id && 'ring-2 ring-brand ring-offset-2 ring-offset-[var(--surface)]')}
                >
                  {s.code}
                  {s.isEv && <BatteryCharging className="absolute right-0.5 top-0.5 size-3" />}
                  {s.isAccessible && <Accessibility className="absolute left-0.5 top-0.5 size-3" />}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {sel && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface-2 p-4">
          <div className="flex-1">
            <div className="font-bold">Slot {sel.code}</div>
            <div className="text-sm text-muted">{vehicleLabel[sel.vehicleClass]} · {sel.state.replace(/_/g, ' ').toLowerCase()}</div>
            {sel.assignments[0] && <div className="mt-2"><VehicleNumberPlate plate={sel.assignments[0].session.plateNormalized} size="sm" /></div>}
          </div>
          {sel.state === 'AVAILABLE' && <><Button size="sm" variant="secondary" onClick={() => setState.mutate('BLOCKED')} loading={setState.isPending}><Ban className="size-4" />Block</Button><Button size="sm" variant="secondary" onClick={() => setState.mutate('OUT_OF_SERVICE')}><Wrench className="size-4" />Out of service</Button></>}
          {(sel.state === 'BLOCKED' || sel.state === 'OUT_OF_SERVICE') && <Button size="sm" onClick={() => setState.mutate('AVAILABLE')} loading={setState.isPending}>Make available</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSel(null)}>Close</Button>
        </div>
      )}
    </div>
  );
}

export default function FacilityDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const f = useQuery({ queryKey: ['facility', id], queryFn: () => api(`/v1/facilities/${id}`) });
  const occ = useQuery({ queryKey: ['occupancy', id], queryFn: () => api(`/v1/facilities/${id}/occupancy`) });
  const rates = useQuery({ queryKey: ['rates', id], queryFn: () => api<any[]>(`/v1/rates/plans?facilityId=${id}`) });
  const reconcile = useMutation({
    mutationFn: () => api(`/v1/facilities/${id}/occupancy/reconcile`, { method: 'POST' }),
    onSuccess: (r: any[]) => { toast.success(r.some((x) => x.corrected) ? 'Counters corrected from active sessions' : 'Counters already match active sessions'); qc.invalidateQueries(); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (f.error) return <ErrorState error={f.error} />;
  if (!f.data) return <Skeleton className="h-96" />;
  const d = f.data;
  const totals = (occ.data?.pools ?? []).reduce((a: any, p: any) => ({ total: a.total + p.total, occupied: a.occupied + p.occupied, reserved: a.reserved + p.reservedDue }), { total: 0, occupied: 0, reserved: 0 });

  return (
    <div className="space-y-6">
      <Link href="/facilities" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-text"><ArrowLeft className="size-4" />Facilities</Link>
      <div className="card flex flex-col gap-6 p-6 md:flex-row md:items-center">
        <OccupancyRing occupied={totals.occupied} total={totals.total} reserved={totals.reserved} size={140} />
        <div className="flex-1 space-y-2">
          <div className="font-mono text-xs font-bold text-muted">{d.code} · {d.type.toLowerCase()} · {d.timezone}</div>
          <h1 className="text-2xl font-extrabold">{d.name}</h1>
          <p className="text-sm text-muted">{d.addressLine}</p>
          <div className="flex flex-wrap gap-1.5">{d.amenities.map((a: any) => <Badge key={a.key}>{a.label}</Badge>)}</div>
        </div>
        <Button variant="secondary" onClick={() => reconcile.mutate()} loading={reconcile.isPending}><RefreshCcw className="size-4" />Reconcile counters</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <SectionTitle title="Slot map" sub={d.occupancyMode === 'SLOT_BASED' ? 'Tap a slot to block or release it' : 'Capacity-based facility'} />
          <ParkingZoneMap facilityId={id} zones={d.zones} />
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <SectionTitle title="Capacity" />
            <div className="space-y-2 text-sm">
              {occ.data?.pools.map((p: any) => (
                <div key={p.vehicleClass} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
                  <span className="font-semibold">{vehicleLabel[p.vehicleClass]}</span>
                  <span className="tabular text-muted">{p.available} free · {p.occupied}/{p.total}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <SectionTitle title="Gates & devices" />
            <div className="space-y-3">
              {d.gates.map((g: any) => (
                <div key={g.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between"><span className="font-semibold">{g.name}</span><Badge tone={g.status === 'ONLINE' ? 'success' : 'warning'}>{g.status.toLowerCase()}</Badge></div>
                  <div className="mt-1 flex flex-wrap gap-1">{g.devices.map((dv: any) => <Badge key={dv.id} tone="neutral">{dv.kind.replace(/_/g, ' ').toLowerCase()} · {dv.vendor}</Badge>)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5">
            <SectionTitle title="Rates" sub="Published versions are immutable" />
            <div className="space-y-2 text-sm">
              {rates.data?.map((rp) => {
                const v = rp.versions.find((x: any) => x.status === 'PUBLISHED');
                const def = v?.definition;
                return (
                  <div key={rp.id} className="rounded-xl bg-surface-2 p-3">
                    <div className="flex justify-between font-semibold"><span>{vehicleLabel[rp.vehicleClass]}</span><span className="text-xs text-muted">v{v?.version ?? '—'}</span></div>
                    {def && <div className="mt-1 text-muted">{def.base.firstUnitAmount ? `${rupees(def.base.firstUnitAmount * 100)} first ${def.base.unitMinutes}m, then ` : ''}{rupees(def.base.amount * 100)}/{def.base.unitMinutes}m{def.dailyCap ? ` · cap ${rupees(def.dailyCap * 100)}/day` : ''}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
