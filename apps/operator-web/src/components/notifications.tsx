'use client';
import * as Popover from '@radix-ui/react-popover';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, BellOff, Building2, Check, CheckCheck, Cpu, Megaphone, ReceiptIndianRupee, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { Button, EmptyState, ErrorState, Skeleton } from '@park2all/web-ui';
import { cn } from '@park2all/web-ui/cn';
import { API_URL, api, auth } from '@/lib/api';

export interface AppNotification {
  id: string; title: string; body: string; type: string; severity: 'info' | 'success' | 'warning' | 'critical';
  link: string | null; readAt: string | null; createdAt: string;
}

export const TYPES: Record<string, { label: string; icon: typeof Bell }> = {
  operator: { label: 'Operators', icon: Building2 },
  billing: { label: 'Billing', icon: ReceiptIndianRupee },
  hardware: { label: 'Hardware', icon: Cpu },
  security: { label: 'Security', icon: ShieldCheck },
  announcement: { label: 'Announcements', icon: Megaphone },
  system: { label: 'System', icon: Settings2 },
};
const TONE: Record<string, string> = {
  info: 'bg-brand/12 text-brand', success: 'bg-success/12 text-success', warning: 'bg-warning/15 text-warning', critical: 'bg-danger/12 text-danger',
};

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }) : null;
export function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month']];
  for (let i = 0; i < steps.length; i++) {
    const [limit, unit] = steps[i];
    if (Math.abs(s) < limit) return Math.abs(s) < 45 && unit === 'second' ? 'just now' : rtf!.format(Math.round(s / (i ? steps[i - 1][0] : 1)), unit);
  }
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Unread count + live delivery (socket room user:<id>), with polling as the fallback. */
export function useNotificationFeed() {
  const qc = useQueryClient();
  const unread = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api<{ count: number }>('/v1/notifications/unread-count'), refetchInterval: 30_000 });
  useEffect(() => {
    const token = auth.get()?.accessToken;
    if (!token) return;
    const s = io(`${API_URL}/live`, { auth: { token }, transports: ['websocket'] });
    s.on('notification', (n: AppNotification) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      const show = n.severity === 'critical' ? toast.error : n.severity === 'warning' ? toast.warning : n.severity === 'success' ? toast.success : toast.info;
      show(n.title, { description: n.body });
    });
    return () => { s.disconnect(); };
  }, [qc]);
  return unread.data?.count ?? 0;
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const onError = (e: unknown) => toast.error((e as Error).message);
  return {
    markRead: useMutation({ mutationFn: ({ id, unread }: { id: string; unread?: boolean }) => api(`/v1/notifications/${id}/read${unread ? '?unread=true' : ''}`, { method: 'POST' }), onSuccess: done, onError }),
    markAll: useMutation({ mutationFn: () => api('/v1/notifications/read-all', { method: 'POST' }), onSuccess: done, onError }),
    remove: useMutation({ mutationFn: (id: string) => api(`/v1/notifications/${id}`, { method: 'DELETE' }), onSuccess: done, onError }),
  };
}

export function NotificationRow({ n, onOpen, compact }: { n: AppNotification; onOpen: (n: AppNotification) => void; compact?: boolean }) {
  const { markRead, remove } = useNotificationActions();
  const Icon = TYPES[n.type]?.icon ?? Bell;
  return (
    <div className={cn('group relative flex gap-3 px-4 py-3 transition hover:bg-surface-2', !n.readAt && 'bg-brand/[0.04]')}>
      <button onClick={() => onOpen(n)} className="absolute inset-0" aria-label={`Open: ${n.title}`} />
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', TONE[n.severity] ?? TONE.info)}>
        {n.severity === 'critical' ? <AlertTriangle className="size-4.5" /> : <Icon className="size-4.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={cn('flex-1 text-sm leading-snug', n.readAt ? 'font-medium text-muted' : 'font-semibold')}>{n.title}</p>
          {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
        </div>
        <p className={cn('mt-0.5 text-sm text-muted', compact && 'line-clamp-2')}>{n.body}</p>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <span>{ago(n.createdAt)}</span><span aria-hidden>·</span><span>{TYPES[n.type]?.label ?? 'System'}</span>
        </div>
      </div>
      <div className="relative z-10 flex shrink-0 items-start gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <button onClick={() => markRead.mutate({ id: n.id, unread: !!n.readAt })} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-text" title={n.readAt ? 'Mark as unread' : 'Mark as read'} aria-label={n.readAt ? 'Mark as unread' : 'Mark as read'}>
          {n.readAt ? <Bell className="size-4" /> : <Check className="size-4" />}
        </button>
        {!compact && (
          <button onClick={() => remove.mutate(n.id)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger" title="Delete" aria-label="Delete notification">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Open a notification: mark it read and follow its link (links are in-app paths). */
export function useOpenNotification(onDone?: () => void) {
  const router = useRouter();
  const { markRead } = useNotificationActions();
  return (n: AppNotification) => {
    if (!n.readAt) markRead.mutate({ id: n.id });
    onDone?.();
    if (n.link) router.push(n.link);
  };
}

export function NotificationBell({ allHref }: { allHref: string }) {
  const count = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const { markAll } = useNotificationActions();
  const openN = useOpenNotification(() => setOpen(false));
  const q = useQuery({
    queryKey: ['notifications', 'popover', tab],
    queryFn: () => api<{ items: AppNotification[] }>(`/v1/notifications?limit=8&filter=${tab}`),
    enabled: open,
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="relative grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:text-text" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
          <Bell className={cn('size-5', count > 0 && 'text-text')} />
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-white ring-2 ring-bg">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} collisionPadding={12}
          className="z-50 w-[min(400px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/15 pop-in">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="font-bold">Notifications</p>
              <p className="text-xs text-muted">{count ? `${count} unread` : 'You are all caught up'}</p>
            </div>
            <button onClick={() => markAll.mutate()} disabled={!count || markAll.isPending} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-40">
              <CheckCheck className="size-4" />Mark all read
            </button>
          </div>
          <div className="flex gap-1 border-b border-border px-3 py-2">
            {(['all', 'unread'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition', tab === t ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text')}>{t}</button>
            ))}
          </div>
          <div className="max-h-[min(440px,60vh)] divide-y divide-border overflow-y-auto">
            {q.isLoading && <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
            {q.error && <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}
            {q.data?.items.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted"><BellOff className="size-6" /></span>
                <p className="font-semibold">{tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
                <p className="text-sm text-muted">New activity shows up here instantly.</p>
              </div>
            )}
            {q.data?.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={openN} compact />)}
          </div>
          <Link href={allHref} onClick={() => setOpen(false)} className="block border-t border-border px-4 py-3 text-center text-sm font-semibold text-brand hover:bg-surface-2">View all notifications</Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Full notification centre (used by /admin/notifications and /notifications). */
export function NotificationCenter({ header }: { header?: React.ReactNode }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [type, setType] = useState<string | null>(null);
  const { markAll } = useNotificationActions();
  const openN = useOpenNotification();
  const count = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api<{ count: number }>('/v1/notifications/unread-count') });
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'center', filter, type],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ items: AppNotification[]; nextBefore: string | null }>(
      `/v1/notifications?limit=25&filter=${filter}${type ? `&type=${type}` : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Notifications</h1><p className="text-sm text-muted">{count.data?.count ? `${count.data.count} unread` : 'You are all caught up'}</p></div>
        <Button variant="secondary" onClick={() => markAll.mutate()} disabled={!count.data?.count} loading={markAll.isPending}><CheckCheck className="size-4" />Mark all as read</Button>
      </div>
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border bg-surface p-1">
          {(['all', 'unread'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn('rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition', filter === f ? 'bg-brand text-white' : 'text-muted hover:text-text')}>{f}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setType(null)} className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', !type ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text')}>All types</button>
          {Object.entries(TYPES).map(([k, t]) => (
            <button key={k} onClick={() => setType(type === k ? null : k)} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition', type === k ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text')}>
              <t.icon className="size-3.5" />{t.label}
            </button>
          ))}
        </div>
      </div>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="card divide-y divide-border overflow-hidden">
          {q.isLoading && <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
          {!q.isLoading && items.length === 0 && <EmptyState title={filter === 'unread' ? 'No unread notifications' : 'Nothing here yet'} body="Operator activity, billing changes, hardware alerts and announcements appear here." icon={<Bell className="size-6" />} />}
          {items.map((n) => <NotificationRow key={n.id} n={n} onOpen={openN} />)}
          {q.hasNextPage && (
            <div className="p-3 text-center"><Button variant="ghost" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>Load older</Button></div>
          )}
        </div>
      )}
    </div>
  );
}
