'use client';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

export default function Staff() {
  const q = useQuery({ queryKey: ['members'], queryFn: () => api<any[]>('/v1/operator/members') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Team</h1><p className="text-sm text-muted">Roles control what each person can do at the gate and in the console.</p></div>
      <div className="card divide-y divide-border">
        {q.isLoading && <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {q.data?.length === 0 && <EmptyState title="No team members" icon={<Users className="size-6" />} />}
        {q.data?.map((m) => (
          <div key={m.id} className="flex items-center gap-4 p-4">
            <div className="grid size-11 place-items-center rounded-full bg-grad text-sm font-bold text-white">{(m.user.name ?? '?').split(' ').map((s: string) => s[0]).slice(0, 2).join('')}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{m.user.name}</div>
              <div className="truncate text-sm text-muted">{m.user.email ?? m.user.phone}</div>
            </div>
            <Badge tone="brand">{m.role.name}</Badge>
            {!m.active && <Badge tone="danger">disabled</Badge>}
            <span className="hidden text-xs text-muted md:block">{m.facilityIds.length ? `${m.facilityIds.length} facilities` : 'All facilities'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
