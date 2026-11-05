'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Car, CircleDollarSign, Clock, IndianRupee, ShieldAlert, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, EmptyState, ErrorState, MetricCard, OccupancyRing, SectionTitle, Skeleton } from '@park2all/web-ui';
import { api, rupees, vehicleLabel } from '@/lib/api';
import { useApp } from '@/lib/app-context';

export default function Dashboard() {
  const { facilityId, facilities } = useApp();
  const q = useQuery({ queryKey: ['dashboard', facilityId], queryFn: () => api(`/v1/operator/dashboard${facilityId ? `?facilityId=${facilityId}` : ''}`), enabled: !!facilityId });
  const facility = facilities.find((f) => f.id === facilityId);

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-navy p-6 text-white sm:p-8">
        <div className="absolute -right-24 -top-24 size-80 rounded-full bg-grad opacity-50 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 size-72 rounded-full bg-grad-cyan opacity-30 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-white/60">Live overview</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{facility?.name ?? 'Your facilities'}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {d?.subscription && <Badge className="bg-white/10 text-white">{d.subscription.plan.name} · {d.subscription.status.toLowerCase()}</Badge>}
              {d && <Badge className="bg-white/10 text-white">{d.totals.available} spaces free</Badge>}
              {d?.upcomingReservations > 0 && <Badge className="bg-white/10 text-white">{d.upcomingReservations} bookings next 24h</Badge>}
            </div>
          </div>
          <div className="rounded-3xl bg-white/5 p-3 backdrop-blur">
            {d ? <OccupancyRing occupied={d.totals.occupied} total={d.totals.total} reserved={d.totals.reservedDue} size={176} /> : <div className="size-44 skeleton rounded-full" />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {d ? (
          <>
            <MetricCard label="Vehicles inside" value={d.totals.occupied} hint={`${d.totals.available} available`} icon={<Car className="size-5" />} />
            <MetricCard label="Entries today" value={d.entriesToday} hint={<span className="inline-flex items-center gap-1"><ArrowUpFromLine className="size-3.5" />{d.exitsToday} exits</span>} icon={<ArrowDownToLine className="size-5" />} tone="cyan" />
            <MetricCard label="Revenue today" value={rupees(d.revenueTodayMinor)} hint={`${d.paymentsToday} payments`} icon={<IndianRupee className="size-5" />} tone="success" />
            <MetricCard label="Awaiting payment" value={d.pendingPayments} hint={`${d.staffOnDuty} staff on duty`} icon={<CircleDollarSign className="size-5" />} tone={d.pendingPayments ? 'warning' : 'violet'} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="card space-y-3 p-5"><Skeleton className="w-24" /><Skeleton className="h-8 w-20" /><Skeleton className="w-32" /></div>)
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <SectionTitle title="Entries by hour" sub="Today, facility local time" />
          <div className="h-64">
            {d ? (
              <ResponsiveContainer>
                <AreaChart data={d.entriesByHour} margin={{ left: -20, right: 8 }}>
                  <defs>
                    <linearGradient id="ent" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text)' }} labelFormatter={(h) => `${h}:00 – ${h}:59`} />
                  <Area type="monotone" dataKey="entries" stroke="var(--brand)" strokeWidth={2.5} fill="url(#ent)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Skeleton className="h-full" />}
          </div>
        </div>

        <div className="card p-5">
          <SectionTitle title="Occupancy by vehicle type" />
          <div className="space-y-4">
            {d?.occupancy.flatMap((o: any) => o.pools).map((p: any) => {
              const pct = p.total ? (p.occupied / p.total) * 100 : 0;
              return (
                <div key={p.vehicleClass}>
                  <div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold">{vehicleLabel[p.vehicleClass] ?? p.vehicleClass}</span><span className="tabular text-muted">{p.occupied}/{p.total}{p.reservedDue ? ` · ${p.reservedDue} held` : ''}</span></div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-grad-cyan transition-all duration-700" style={{ width: `${pct}%` }} /></div>
                  {p.sensorDrift ? <p className="mt-1 text-xs text-warning">Sensor count differs by {p.sensorDrift}</p> : null}
                </div>
              );
            }) ?? <Skeleton className="h-32" />}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <SectionTitle title="Gates" sub="Status and last heartbeat" />
          <div className="grid gap-3 sm:grid-cols-2">
            {d?.gates.map((g: any) => (
              <div key={g.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <span className={`size-3 rounded-full ${g.status === 'ONLINE' ? 'bg-success shadow-[0_0_0_4px_color-mix(in_oklab,var(--success)_20%,transparent)]' : g.status === 'DEGRADED' ? 'bg-warning' : 'bg-danger'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{g.name}</div>
                  <div className="text-xs text-muted">{g.code} · {g.direction.toLowerCase()}</div>
                </div>
                <Badge tone={g.status === 'ONLINE' ? 'success' : g.status === 'DEGRADED' ? 'warning' : 'danger'}>{g.status.toLowerCase()}</Badge>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <SectionTitle title="Alerts" sub={d?.pendingOverrides ? `${d.pendingOverrides} overrides awaiting approval` : 'Hardware and operations'} />
          {d && d.alerts.length === 0 && <EmptyState title="All systems normal" body="No open hardware alerts." icon={<ShieldAlert className="size-6" />} />}
          <ul className="space-y-2">
            {d?.alerts.map((a: any) => (
              <li key={a.id} className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
                <AlertTriangle className={`mt-0.5 size-4 ${a.severity === 'CRITICAL' ? 'text-danger' : 'text-warning'}`} />
                <div className="flex-1"><div className="font-semibold">{a.message}</div><div className="flex items-center gap-1 text-xs text-muted"><Clock className="size-3" />{new Date(a.createdAt).toLocaleString()}</div></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {d && <p className="flex items-center gap-1.5 text-xs text-muted"><Users className="size-3.5" />Updated {new Date(q.dataUpdatedAt).toLocaleTimeString()}</p>}
    </div>
  );
}
