'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Skeleton } from '@park2all/web-ui';
import { api } from '@/lib/api';
import { SubscriptionStatus, TenantStatus, date } from '../ui';

const PAGE_SIZE = 25;

export default function Operators() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const q = useQuery({
    queryKey: ['admin', 'tenants', query, page],
    queryFn: () => api(`/v1/admin/tenants?page=${page}&pageSize=${PAGE_SIZE}${query ? `&q=${encodeURIComponent(query)}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Operators</h1><p className="text-sm text-muted">Parking companies using Park2All{q.data ? ` · ${q.data.total} total` : ''}.</p></div>
        <Link href="/admin/operators/new"><Button>Onboard operator</Button></Link>
      </div>

      <label className="relative block max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or slug" aria-label="Search operators"
          className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3.5 outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)]" />
      </label>

      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="p-4">Operator</th><th className="p-4">Status</th><th className="p-4">Plan</th><th className="p-4 text-right">Facilities</th><th className="p-4 text-right">Staff</th><th className="p-4">Joined</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.isLoading && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={6} className="p-4"><Skeleton className="h-6" /></td></tr>)}
                {q.data?.items.map((t: any) => {
                  const sub = t.subscriptions[0];
                  return (
                    <tr key={t.id} className="hover:bg-surface-2">
                      <td className="p-4"><Link href={`/admin/operators/${t.id}`} className="font-semibold hover:text-brand">{t.name}</Link><div className="text-xs text-muted">{t.slug} · {t.contactEmail ?? 'no email'}</div></td>
                      <td className="p-4"><TenantStatus status={t.status} /></td>
                      <td className="p-4">{sub ? <span className="flex items-center gap-2">{sub.plan.name}<SubscriptionStatus status={sub.status} /></span> : <span className="text-muted">—</span>}</td>
                      <td className="p-4 text-right tabular-nums">{t._count.facilities}</td>
                      <td className="p-4 text-right tabular-nums">{t._count.members}</td>
                      <td className="p-4 text-muted">{date(t.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {q.data?.items.length === 0 && <EmptyState title={query ? 'No operators match' : 'No operators yet'} body={query ? undefined : 'Onboard the first parking operator to get started.'} icon={<Building2 className="size-6" />} />}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-border p-3 text-sm">
              <span className="text-muted">Page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
