'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Mail, Phone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, EmptyState, ErrorState, SectionTitle, Skeleton } from '@park2all/web-ui';
import { api, rupees } from '@/lib/api';
import { Select, SubscriptionStatus, Textarea, TenantStatus, date, dateTime } from '../../ui';

const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CLOSED'];

function StatusForm({ tenant }: { tenant: any }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(tenant.status);
  const change = useMutation({
    mutationFn: (b: { status: string; reason: string }) => api(`/v1/admin/tenants/${tenant.id}/status`, { method: 'PATCH', json: b }),
    onSuccess: (_d, b) => { toast.success(`Status set to ${b.status.toLowerCase().replace('_', ' ')}`); qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const reason = String(new FormData(form).get('reason') ?? '').trim();
    change.mutate({ status, reason }, { onSuccess: () => form.reset() });
  }
  const danger = status === 'SUSPENDED' || status === 'CLOSED';
  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <SectionTitle title="Account status" sub="Suspended and closed operators can no longer use the console. Every change is recorded in the audit log." />
      <Select name="status" label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
      </Select>
      <Textarea name="reason" label="Reason" required minLength={3} placeholder="e.g. Payment received for November" />
      <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={change.isPending} disabled={status === tenant.status}>
        {status === tenant.status ? 'No change' : `Set to ${status.replace('_', ' ').toLowerCase()}`}
      </Button>
    </form>
  );
}

export default function OperatorDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['admin', 'tenant', id], queryFn: () => api(`/v1/admin/tenants/${id}`) });
  const audit = useQuery({ queryKey: ['admin', 'audit', id], queryFn: () => api<any[]>(`/v1/admin/audit?tenantId=${id}`) });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  const sub = t?.subscriptions?.slice().sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];

  return (
    <div className="space-y-5">
      <Link href="/admin/operators" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text"><ArrowLeft className="size-4" />Operators</Link>
      {!t ? <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-40" /></div> : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3"><h1 className="text-2xl font-extrabold">{t.name}</h1><TenantStatus status={t.status} /></div>
              <p className="mt-1 text-sm text-muted">{t.slug}{t.legalName ? ` · ${t.legalName}` : ''}{t.gstin ? ` · GSTIN ${t.gstin}` : ''} · joined {date(t.createdAt)}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted">
                {t.contactEmail && <span className="flex items-center gap-1.5"><Mail className="size-4" />{t.contactEmail}</span>}
                {t.contactPhone && <span className="flex items-center gap-1.5"><Phone className="size-4" />{t.contactPhone}</span>}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-2">
              <div className="card p-5">
                <SectionTitle title="Subscription" />
                {sub ? (
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div><div className="text-xs text-muted">Plan</div><div className="font-semibold">{sub.plan.name}</div></div>
                    <div><div className="text-xs text-muted">Status</div><SubscriptionStatus status={sub.status} /></div>
                    <div><div className="text-xs text-muted">Price</div><div className="font-semibold">{!sub.plan.priceMonthlyMinor ? 'Custom' : sub.billingCycle === 'YEARLY' ? `${rupees(sub.plan.priceYearlyMinor)}/yr` : `${rupees(sub.plan.priceMonthlyMinor)}/mo`}</div></div>
                    <div><div className="text-xs text-muted">{sub.status === 'TRIALING' ? 'Trial ends' : 'Renews'}</div><div className="font-semibold">{date(sub.currentPeriodEnd)}</div></div>
                  </div>
                ) : <p className="text-sm text-muted">No subscription.</p>}
                {sub?.invoices?.length > 0 && <p className="mt-3 text-xs text-muted">{sub.invoices.length} invoice(s)</p>}
              </div>

              <div className="card p-5">
                <SectionTitle title="Facilities" sub={`${t.facilities.length} car park(s)`} />
                {t.facilities.length === 0 ? <EmptyState title="No facilities yet" body="The operator adds car parks from their console." icon={<Building2 className="size-6" />} /> : (
                  <div className="divide-y divide-border">
                    {t.facilities.map((f: any) => (
                      <div key={f.id} className="flex items-center justify-between py-2.5">
                        <div><div className="font-semibold">{f.name}</div><div className="text-xs text-muted">{f.code}</div></div>
                        <Badge tone={f.isPublished ? 'success' : 'neutral'}>{f.isPublished ? 'published' : 'draft'}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card p-5">
                <SectionTitle title="Team" sub={`${t.members.length} member(s)`} />
                <div className="divide-y divide-border">
                  {t.members.map((m: any) => (
                    <div key={m.id ?? m.userId} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0"><div className="truncate font-semibold">{m.user.name}</div><div className="truncate text-xs text-muted">{m.user.email ?? m.user.phone}</div></div>
                      <div className="flex items-center gap-2"><Badge tone="brand">{m.role.key.replace(/_/g, ' ').toLowerCase()}</Badge>{m.active === false && <Badge tone="danger">disabled</Badge>}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <StatusForm key={t.status} tenant={t} />
              <div className="card p-5">
                <SectionTitle title="Recent activity" />
                {audit.isLoading && <Skeleton className="h-20" />}
                {audit.data?.length === 0 && <p className="text-sm text-muted">Nothing recorded yet.</p>}
                <ol className="space-y-2.5">
                  {audit.data?.slice(0, 12).map((a) => (
                    <li key={a.id} className="text-sm"><div className="font-medium">{a.action}</div><div className="text-xs text-muted">{dateTime(a.at)} · {a.entityType}</div></li>
                  ))}
                </ol>
                {(audit.data?.length ?? 0) > 12 && <Link href={`/admin/audit?tenantId=${t.id}`} className="mt-3 block text-sm font-semibold text-brand">See all</Link>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
