'use client';
import { useQuery } from '@tanstack/react-query';
import { Building2, LayoutDashboard, LogOut, Menu, Moon, ScrollText, Sun, Tags, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorState } from '@park2all/web-ui';
import { cn } from '@park2all/web-ui/cn';
import { api, auth } from '@/lib/api';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/operators', label: 'Operators', icon: Building2 },
  { href: '/admin/plans', label: 'Plans', icon: Tags },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

/** Platform admin portal: only users with a platform role (Super Admin, Support) get past this layout. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (!auth.get()?.accessToken) router.replace('/login');
    else setReady(true);
  }, [router]);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/v1/auth/me'), enabled: ready, refetchInterval: false });
  const isPlatform = (me.data?.platformRoles?.length ?? 0) > 0;
  useEffect(() => {
    if (me.data && !isPlatform) router.replace(auth.get()?.tenantId ? '/dashboard' : '/login');
  }, [me.data, isPlatform, router]);
  useEffect(() => {
    if (me.error && !auth.get()) router.replace('/login');
  }, [me.error, router]);

  function toggleTheme() {
    const current = document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('p2a.theme', next); } catch { /* ignore */ }
  }
  async function logout() {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    auth.set(null);
    router.replace('/login');
  }

  if (!ready) return null;
  if (me.error) return <main className="p-6"><ErrorState error={me.error} onRetry={() => me.refetch()} /></main>;
  if (!isPlatform) return null;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-navy p-4 text-white transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0', mobileNav ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-8 flex items-center justify-between px-2 pt-2">
          <div className="flex items-center gap-2.5 text-lg font-extrabold"><span className="grid size-9 place-items-center rounded-xl bg-grad">P</span>Park2All <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">Admin</span></div>
          <button className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => {
            const active = n.exact ? path === n.href : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} onClick={() => setMobileNav(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
                <n.icon className={cn('size-5', active && 'text-cyan-300')} />{n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl bg-white/5 p-3">
          <div className="truncate text-sm font-semibold">{me.data?.name ?? '—'}</div>
          <div className="truncate text-xs text-white/50">{me.data?.email}</div>
          <button onClick={logout} className="mt-3 flex items-center gap-2 text-xs font-semibold text-white/60 hover:text-white"><LogOut className="size-4" />Sign out</button>
        </div>
      </aside>
      {mobileNav && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileNav(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-xl sm:px-6">
          <button className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu className="size-6" /></button>
          <span className="text-sm font-semibold text-muted">Platform administration</span>
          <button onClick={toggleTheme} className="ml-auto grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted hover:text-text" aria-label="Toggle theme">
            <Sun className="hidden size-5 dark:block" /><Moon className="size-5 dark:hidden" />
          </button>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
