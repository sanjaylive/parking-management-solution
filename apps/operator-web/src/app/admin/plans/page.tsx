'use client';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { Badge, ErrorState, Skeleton } from '@park2all/web-ui';
import { api, rupees } from '@/lib/api';

const LIMITS: [string, string][] = [['maxFacilities', 'Facilities'], ['maxGates', 'Gates'], ['maxStaff', 'Staff'], ['monthlySessions', 'Sessions / month']];
const FEATURES: [string, string][] = [['feature.anpr', 'ANPR cameras'], ['feature.corporate', 'Corporate accounts'], ['feature.api', 'API access'], ['feature.advancedReports', 'Advanced reports']];

export default function Plans() {
  const q = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<any[]>('/v1/admin/plans') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Plans</h1><p className="text-sm text-muted">Subscription plans and what each one allows.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {q.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
        {q.data?.slice().sort((a, b) => (a.priceMonthlyMinor || Infinity) - (b.priceMonthlyMinor || Infinity)).map((p) => {
          const ent = Object.fromEntries(p.entitlements.map((e: any) => [e.key, e.value]));
          return (
            <div key={p.id} className="card flex flex-col p-5">
              <div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">{p.name}</h2>{!p.active && <Badge tone="neutral">inactive</Badge>}</div>
              <div className="text-xs text-muted">{p.code}</div>
              {p.priceMonthlyMinor ? (
                <><div className="mt-3 text-2xl font-extrabold">{rupees(p.priceMonthlyMinor)}<span className="text-sm font-medium text-muted">/month</span></div>
                  <div className="text-xs text-muted">{rupees(p.priceYearlyMinor)}/year</div></>
              ) : <><div className="mt-3 text-2xl font-extrabold">Custom</div><div className="text-xs text-muted">Priced per contract</div></>}
              <dl className="mt-4 space-y-1.5 text-sm">
                {LIMITS.map(([k, l]) => <div key={k} className="flex justify-between"><dt className="text-muted">{l}</dt><dd className="font-semibold tabular-nums">{ent[k] == null ? '—' : ent[k] === -1 ? 'Unlimited' : ent[k].toLocaleString('en-IN')}</dd></div>)}
              </dl>
              <ul className="mt-3 space-y-1.5 text-sm">
                {FEATURES.map(([k, l]) => <li key={k} className={ent[k] ? 'flex items-center gap-2' : 'flex items-center gap-2 text-muted'}>{ent[k] ? <Check className="size-4 text-success" /> : <Minus className="size-4" />}{l}</li>)}
              </ul>
              <div className="mt-auto pt-4 text-xs text-muted">{p._count.subscriptions} subscription(s)</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
