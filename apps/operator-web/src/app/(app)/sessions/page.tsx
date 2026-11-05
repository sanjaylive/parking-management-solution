'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CarFront, Search } from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, ErrorState, SearchableCombobox, SessionStatus, Skeleton, VehicleNumberPlate } from '@park2all/web-ui';
import { api, duration, rupees, vehicleLabel } from '@/lib/api';
import { useApp } from '@/lib/app-context';

const STATUSES = ['ACTIVE', 'PAYMENT_PENDING', 'EXIT_READY', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];

export default function Sessions() {
  const { facilityId } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '20', ...(facilityId ? { facilityId } : {}), ...(q ? { q } : {}), ...(status ? { status } : activeOnly ? { active: 'true' } : {}) });
  const list = useQuery({ queryKey: ['sessions', params.toString()], queryFn: () => api(`/v1/sessions?${params}`), placeholderData: keepPreviousData, enabled: !!facilityId });
  const now = Date.now();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-extrabold">Parking sessions</h1><p className="text-sm text-muted">{list.data ? `${list.data.total} sessions` : 'Loading…'}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search plate" className="h-10 w-48 rounded-xl border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand" aria-label="Search plate" />
          </div>
          <div className="w-48"><SearchableCombobox ariaLabel="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder="Any status" options={STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase() }))} /></div>
          <Button variant={activeOnly && !status ? 'primary' : 'secondary'} size="md" onClick={() => { setActiveOnly(!activeOnly); setStatus(null); setPage(1); }}>Inside now</Button>
        </div>
      </div>

      {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      <div className="card overflow-hidden">
        {list.isLoading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState title="No sessions match" body="Try clearing filters or searching a different plate." icon={<CarFront className="size-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-5 py-3">Vehicle</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Entered</th><th className="px-3 py-3">Duration</th><th className="px-3 py-3">Slot</th><th className="px-5 py-3 text-right">Due / Paid</th></tr>
              </thead>
              <tbody>
                {list.data?.items.map((s: any) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                    <td className="px-5 py-3"><div className="flex items-center gap-2"><VehicleNumberPlate plate={s.plateNormalized} size="sm" /><span className="text-xs text-muted">{vehicleLabel[s.vehicleClass]}</span></div></td>
                    <td className="px-3 py-3"><SessionStatus status={s.status} />{s.isProvisional && <span className="ml-1 text-xs text-warning">provisional</span>}</td>
                    <td className="px-3 py-3 text-muted">{s.source.toLowerCase().replace('_', '-')}</td>
                    <td className="px-3 py-3 tabular">{new Date(s.entryAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-3 py-3 tabular">{duration(Math.ceil(((s.exitAt ? new Date(s.exitAt).getTime() : now) - new Date(s.entryAt).getTime()) / 60000))}</td>
                    <td className="px-3 py-3 font-mono">{s.assignments[0]?.slot.code ?? '—'}</td>
                    <td className="px-5 py-3 text-right tabular">{rupees(s.amountDueMinor)} <span className="text-muted">/ {rupees(s.amountPaidMinor)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.data && list.data.total > list.data.pageSize && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {Math.ceil(list.data.total / list.data.pageSize)}</span>
          <Button variant="secondary" size="sm" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
