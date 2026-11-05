'use client';
import { useQuery } from '@tanstack/react-query';
import { BatteryCharging, Building2, MapPin, Umbrella } from 'lucide-react';
import Link from 'next/link';
import { Badge, EmptyState, ErrorState, OccupancyRing, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

export default function Facilities() {
  const q = useQuery({ queryKey: ['facilities'], queryFn: () => api<any[]>('/v1/facilities') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Facilities</h1><p className="text-sm text-muted">Sites, gates, zones and capacity</p></div>
      {q.isLoading && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>}
      {q.data?.length === 0 && <EmptyState title="No facilities yet" body="Create your first parking facility to start admitting vehicles." icon={<Building2 className="size-6" />} />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((f) => (
          <Link key={f.id} href={`/facilities/${f.id}`} className="card group flex gap-5 p-5 transition hover:-translate-y-0.5 hover:border-brand/40">
            <OccupancyRing occupied={f.capacity.occupied} total={f.capacity.total} size={104} label={`${f.capacity.available} free`} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2"><span className="font-mono text-xs font-bold text-muted">{f.code}</span>{!f.isPublished && <Badge>unlisted</Badge>}</div>
              <div className="truncate text-lg font-bold group-hover:text-brand">{f.name}</div>
              <div className="flex items-start gap-1 text-sm text-muted"><MapPin className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-2">{f.addressLine}</span></div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge tone="brand">{f._count.gates} gates</Badge>
                {f.occupancyMode === 'SLOT_BASED' && <Badge tone="cyan">{f._count.slots} slots</Badge>}
                {f.hasEv && <Badge tone="success"><BatteryCharging className="size-3" />EV</Badge>}
                {f.covered && <Badge><Umbrella className="size-3" />Covered</Badge>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
