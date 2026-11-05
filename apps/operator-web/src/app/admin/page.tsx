'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, Car, IndianRupee, MapPin, Repeat, UserRound } from 'lucide-react';
import Link from 'next/link';
import { Button, ErrorState, MetricCard, SectionTitle, Skeleton } from '@park2all/web-ui';
import { api, rupees } from '@/lib/api';
import { TenantStatus, date } from './ui';

const STATUSES = ['ACTIVE', 'TRIAL', 'PAST_DUE', 'SUSPENDED', 'CLOSED'];

export default function AdminOverview() {
  const q = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api('/v1/admin/dashboard') });
  const recent = useQuery({ queryKey: ['admin', 'tenants', '', 1], queryFn: () => api('/v1/admin/tenants?pageSize=5') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const totalTenants = d ? Object.values<number>(d.tenants).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Overview</h1><p className="text-sm text-muted">All operators on Park2All, last 24 hours.</p></div>
        <Link href="/admin/operators/new"><Button>Onboard operator</Button></Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {d ? (
          <>
            <MetricCard label="Operators" value={totalTenants} hint={`${d.facilities} facilities`} icon={<Building2 className="size-5" />} />
            <MetricCard label="MRR" value={rupees(d.mrrMinor)} hint="Active paid subscriptions" icon={<Repeat className="size-5" />} tone="success" />
            <MetricCard label="Revenue (24h)" value={rupees(d.revenue24hMinor)} hint="Parking payments, all operators" icon={<IndianRupee className="size-5" />} tone="cyan" />
            <MetricCard label="Vehicles parked now" value={d.activeSessions} hint={`${d.sessions24h} entries in 24h`} icon={<Car className="size-5" />} tone="violet" />
          </>
        ) : Array.from({ length: 4 }).map((_, i) => <div key={i} className="card space-y-3 p-5"><Skeleton className="w-24" /><Skeleton className="h-8 w-20" /><Skeleton className="w-32" /></div>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5">
          <SectionTitle title="Operators by status" />
          <div className="space-y-2">
            {STATUSES.map((s) => (
              <div key={s} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
                <TenantStatus status={s} />
                <span className="font-bold tabular-nums">{d ? d.tenants[s] ?? 0 : '—'}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2"><UserRound className="size-4 text-muted" />{d?.customers ?? '—'} customers</div>
            <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2"><AlertTriangle className={d?.openAlerts ? 'size-4 text-warning' : 'size-4 text-muted'} />{d?.openAlerts ?? '—'} open alerts</div>
          </div>
        </div>

        <div className="card p-5 xl:col-span-2">
          <SectionTitle title="Newest operators" action={<Link href="/admin/operators" className="text-sm font-semibold text-brand">View all</Link>} />
          <div className="divide-y divide-border">
            {recent.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="my-2 h-10" />)}
            {recent.data?.items.map((t: any) => (
              <Link key={t.id} href={`/admin/operators/${t.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t.name}</div>
                  <div className="flex items-center gap-1 truncate text-xs text-muted"><MapPin className="size-3" />{t._count.facilities} facilities · {t._count.members} staff · joined {date(t.createdAt)}</div>
                </div>
                <span className="hidden text-xs text-muted sm:block">{t.subscriptions[0]?.plan.name ?? 'No plan'}</span>
                <TenantStatus status={t.status} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
