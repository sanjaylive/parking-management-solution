'use client';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@park2all/web-ui';
import { api } from '@/lib/api';
import { Select, dateTime } from '../ui';

function AuditLog() {
  const params = useSearchParams();
  const router = useRouter();
  const tenantId = params.get('tenantId') ?? '';
  const [action, setAction] = useState(params.get('action') ?? '');
  const [debounced, setDebounced] = useState(action);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(action.trim()), 300); return () => clearTimeout(t); }, [action]);

  const tenants = useQuery({ queryKey: ['admin', 'tenants', 'all'], queryFn: () => api('/v1/admin/tenants?pageSize=100') });
  const names: Record<string, string> = Object.fromEntries((tenants.data?.items ?? []).map((t: any) => [t.id, t.name]));
  const qs = new URLSearchParams({ ...(tenantId && { tenantId }), ...(debounced && { action: debounced }) }).toString();
  const q = useQuery({ queryKey: ['admin', 'audit', 'list', qs], queryFn: () => api<any[]>(`/v1/admin/audit${qs ? `?${qs}` : ''}`) });

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Audit log</h1><p className="text-sm text-muted">The latest 200 recorded actions across the platform.</p></div>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Select aria-label="Operator" value={tenantId} onChange={(e) => router.replace(e.target.value ? `/admin/audit?tenantId=${e.target.value}` : '/admin/audit')}>
          <option value="">All operators</option>
          {tenants.data?.items.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action starts with… (e.g. tenant.)" aria-label="Filter by action"
          className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)]" />
      </div>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="card divide-y divide-border">
          {q.isLoading && <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
          {q.data?.length === 0 && <EmptyState title="No matching entries" icon={<ScrollText className="size-6" />} />}
          {q.data?.map((a) => (
            <div key={a.id}>
              <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left text-sm hover:bg-surface-2">
                <span className="w-36 shrink-0 text-muted">{dateTime(a.at)}</span>
                <span className="font-semibold">{a.action}</span>
                <span className="text-muted">{a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ''}</span>
                <span className="ml-auto text-xs text-muted">{a.tenantId ? names[a.tenantId] ?? a.tenantId.slice(0, 8) : 'platform'} · {a.actorKind.toLowerCase()}</span>
              </button>
              {open === a.id && (
                <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                  {(['before', 'after'] as const).map((k) => (
                    <div key={k}><div className="mb-1 text-xs font-semibold uppercase text-muted">{k}</div>
                      <pre className="max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 text-xs">{a[k] ? JSON.stringify(a[k], null, 2) : '—'}</pre></div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  return <Suspense fallback={null}><AuditLog /></Suspense>;
}
