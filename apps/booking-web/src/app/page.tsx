import { BatteryCharging, MapPin, Search, Umbrella, UserRound } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { publicGet } from '@/lib/server';
import { rupees } from '@/lib/format';
import { LocateButton } from '@/components/locate';

type SP = Record<string, string | undefined>;
const DEFAULT = { lat: '12.9716', lng: '77.5946' };
const FILTERS = [
  { key: 'ev', label: 'EV charging' },
  { key: 'covered', label: 'Covered' },
  { key: 'valet', label: 'Valet' },
  { key: 'open24h', label: '24 hours' },
  { key: 'reservable', label: 'Bookable' },
];
const SORTS = [['distance', 'Nearest'], ['price', 'Cheapest'], ['availability', 'Most free']];

function href(sp: SP, patch: SP) {
  const next = { ...sp, ...patch };
  const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  return `/?${q}`;
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ lat: sp.lat ?? DEFAULT.lat, lng: sp.lng ?? DEFAULT.lng, radiusKm: '15', sort: sp.sort ?? 'distance' });
  if (sp.q) q.set('q', sp.q);
  for (const f of FILTERS) if (sp[f.key]) q.set(f.key, 'true');
  let facilities: any[] = [];
  let failed = false;
  try {
    facilities = (await publicGet<any[]>(`/v1/public/facilities?${q}`)) ?? [];
  } catch {
    failed = true;
  }
  const usingDefault = !sp.lat;

  return (
    <div className="space-y-8 pt-6">
      <section className="relative overflow-hidden rounded-3xl bg-navy px-6 py-10 text-white sm:px-10 sm:py-14">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-grad opacity-50 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 size-80 rounded-full bg-grad-cyan opacity-30 blur-3xl" />
        <div className="relative max-w-2xl space-y-5">
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">Parking, sorted <span className="text-cyan-300">before you arrive.</span></h1>
          <p className="text-lg text-white/70">Live availability, upfront prices and a QR pass that opens the gate.</p>
          <form action="/" className="flex flex-col gap-2 sm:flex-row">
            {sp.lat && <input type="hidden" name="lat" value={sp.lat} />}
            {sp.lng && <input type="hidden" name="lng" value={sp.lng} />}
            <label className="flex h-14 flex-1 items-center gap-3 rounded-2xl bg-white px-4 text-[#0b1530]">
              <Search className="size-5 text-[#5b6785]" />
              <input name="q" defaultValue={sp.q} placeholder="Mall, station, office, area…" className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-[#5b6785]" aria-label="Search parking" />
            </label>
            <button className="h-14 rounded-2xl bg-grad px-6 font-bold">Search</button>
          </form>
          <div className="flex flex-wrap items-center gap-3 text-sm text-white/70">
            <Suspense fallback={null}><LocateButton /></Suspense>
            {usingDefault && <span>Showing results around Bengaluru</span>}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const on = !!sp[f.key];
            return (
              <Link key={f.key} href={href(sp, { [f.key]: on ? undefined : '1' })} className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${on ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-muted hover:border-brand/40'}`} aria-pressed={on}>
                {f.label}
              </Link>
            );
          })}
          <span className="ml-auto flex items-center gap-1 text-sm text-muted">
            Sort:
            {SORTS.map(([k, label]) => (
              <Link key={k} href={href(sp, { sort: k })} className={`rounded-lg px-2 py-1 font-semibold ${(sp.sort ?? 'distance') === k ? 'bg-surface-2 text-text' : 'hover:text-text'}`}>{label}</Link>
            ))}
          </span>
        </div>

        {failed && <p className="rounded-2xl border border-danger/30 bg-danger/8 p-4 text-sm">We couldn’t load parking right now. Please refresh in a moment.</p>}
        {!failed && facilities.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border p-12 text-center">
            <p className="text-lg font-bold">No parking matches those filters</p>
            <p className="mt-1 text-sm text-muted">Try removing a filter or searching another area.</p>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {facilities.map((f) => {
            const pct = f.total ? f.available / f.total : 0;
            const tone = f.available === 0 ? 'text-danger bg-danger/10' : pct < 0.1 ? 'text-warning bg-warning/15' : 'text-success bg-success/12';
            return (
              <Link key={f.id} href={`/p/${f.id}`} className="card group flex gap-4 p-5 transition hover:-translate-y-0.5 hover:border-brand/40">
                <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-grad text-2xl font-extrabold text-white">P</div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="truncate text-lg font-bold group-hover:text-brand">{f.name}</h2>
                    <div className="text-right"><div className="text-lg font-extrabold tabular">{rupees(f.hourlyMinor)}</div><div className="text-xs text-muted">next hour</div></div>
                  </div>
                  <p className="flex items-center gap-1 truncate text-sm text-muted"><MapPin className="size-3.5 shrink-0" />{f.distanceKm != null ? `${f.distanceKm} km · ` : ''}{f.addressLine}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`}>{f.available === 0 ? 'Full' : `${f.available} free`}</span>
                    {f.hasEv && <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand"><BatteryCharging className="size-3" />EV</span>}
                    {f.covered && <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted"><Umbrella className="size-3" />Covered</span>}
                    {f.hasValet && <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted"><UserRound className="size-3" />Valet</span>}
                    {f.reservable && <span className="rounded-full bg-violet/12 px-2.5 py-0.5 text-xs font-semibold text-violet">Bookable</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
