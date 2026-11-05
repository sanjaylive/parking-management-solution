import { ArrowLeft, BatteryCharging, Clock, MapPin, ShieldCheck, Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ReservePanel } from '@/components/reserve';
import { describeRate, vehicleLabel } from '@/lib/format';
import { publicGet } from '@/lib/server';

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return publicGet<any>(`/v1/public/facilities/${id}`, 15);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const f = await load((await params).id).catch(() => null);
  return f ? { title: /parking/i.test(f.name) ? f.name : `${f.name} parking`, description: `Live availability and prices at ${f.name}, ${f.addressLine}. Reserve a spot online.` } : { title: 'Parking not found' };
}

export default async function FacilityPage({ params }: Params) {
  const f = await load((await params).id);
  if (!f) notFound();
  return (
    <div className="space-y-6 pt-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-text"><ArrowLeft className="size-4" />All parking</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-3xl bg-grad p-8 text-white">
            <div className="absolute -right-6 -top-10 text-[180px] font-black leading-none text-white/10">P</div>
            <p className="text-sm font-semibold text-white/70">Operated by {f.operator}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{f.name}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-white/80"><MapPin className="size-4" />{f.addressLine}</p>
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 font-semibold"><Clock className="size-3.5" />{f.open24h ? 'Open 24×7' : 'Limited hours'}</span>
              {f.heightLimitCm && <span className="rounded-full bg-white/15 px-3 py-1 font-semibold">Max height {(f.heightLimitCm / 100).toFixed(1)} m</span>}
              {f.rating.count > 0 && <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 font-semibold"><Star className="size-3.5 fill-current" />{Number(f.rating.average).toFixed(1)} ({f.rating.count})</span>}
            </div>
          </div>

          <section className="card p-6">
            <h2 className="mb-4 text-lg font-bold">Availability now</h2>
            <div className="space-y-4">
              {f.pools.map((p: any) => {
                const used = p.total ? 1 - p.available / p.total : 0;
                return (
                  <div key={p.vehicleClass}>
                    <div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold">{vehicleLabel[p.vehicleClass] ?? p.vehicleClass}</span><span className="tabular text-muted">{p.available} of {p.total} free</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-grad-cyan" style={{ width: `${used * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-lg font-bold">Rates</h2>
            <ul className="divide-y divide-border">
              {f.rates.map((r: any) => (
                <li key={r.vehicleClass} className="py-3 first:pt-0 last:pb-0">
                  <div className="font-semibold">{vehicleLabel[r.vehicleClass] ?? r.vehicleClass}</div>
                  <div className="text-sm text-muted">{describeRate(r.definition)}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card grid gap-6 p-6 sm:grid-cols-2">
            <div>
              <h2 className="mb-3 text-lg font-bold">Amenities</h2>
              <ul className="space-y-2 text-sm">
                {f.amenities.map((a: any) => <li key={a.key} className="flex items-center gap-2">{a.key === 'EV_CHARGING' ? <BatteryCharging className="size-4 text-brand" /> : <ShieldCheck className="size-4 text-brand" />}{a.label}</li>)}
              </ul>
            </div>
            <div>
              <h2 className="mb-3 text-lg font-bold">Good to know</h2>
              <p className="text-sm text-muted">{f.rules ?? 'Follow staff instructions and posted signs.'}</p>
              {f.cancellationPolicy && <p className="mt-2 text-sm text-muted">Free cancellation until {f.cancellationPolicy.freeUntilMinutesBefore} min before start, then {f.cancellationPolicy.feePercent}% fee.</p>}
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          {f.reservable ? (
            <ReservePanel facilityId={f.id} classes={f.pools.map((p: any) => p.vehicleClass)} />
          ) : (
            <div className="card p-6 text-sm text-muted"><p className="font-bold text-text">Walk-in parking</p><p className="mt-1">No booking needed — just drive up. Your number plate is recognised at the gate.</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}
