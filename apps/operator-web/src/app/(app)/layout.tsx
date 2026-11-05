'use client';
import { useQuery } from '@tanstack/react-query';
import { Bell, Building2, CarFront, LayoutDashboard, LogOut, Menu, ScanLine, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SearchableCombobox } from '@park2all/web-ui';
import { api, auth } from '@/lib/api';
import { cn } from '@park2all/web-ui/cn';
import { useLive } from '@/lib/live';
import { AppCtx } from '@/lib/app-context';
import { NotificationBell } from '@/components/notifications';
import { ProfileDrawer } from '@/components/profile-drawer';
import { BrandMark, useBrand } from '@/lib/brand';


const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/gate', label: 'Gate console', icon: ScanLine },
  { href: '/sessions', label: 'Sessions', icon: CarFront },
  { href: '/facilities', label: 'Facilities', icon: Building2 },
  { href: '/staff', label: 'Team', icon: Users },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [facilityId, setFacility] = useState<string | undefined>();
  const brand = useBrand();

  useEffect(() => {
    const a = auth.get();
    if (!a?.tenantId) router.replace(a?.accessToken ? '/admin' : '/login'); // signed in without an operator = platform admin
    else { setFacility(a.facilityId); setReady(true); }
  }, [router]);

  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/v1/auth/me'), enabled: ready, refetchInterval: false });
  const facilities = useQuery({ queryKey: ['facilities'], queryFn: () => api<any[]>('/v1/facilities'), enabled: ready });
  useEffect(() => {
    if (!facilityId && facilities.data?.length) setFacilityId(facilities.data[0].id);
  }, [facilities.data, facilityId]);
  const live = useLive(facilityId);

  function setFacilityId(id?: string) {
    setFacility(id);
    auth.patch({ facilityId: id });
  }
  async function logout() {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    auth.set(null);
    router.replace('/login');
  }

  if (!ready) return null;
  const membership = me.data?.memberships?.[0];

  const nav = (
    <nav className="space-y-1">
      {NAV.map((n) => {
        const active = path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} onClick={() => setMobileNav(false)} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
            <n.icon className={cn('size-5', active && 'text-cyan-300')} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <AppCtx.Provider value={{ facilityId, setFacilityId, me: me.data, facilities: facilities.data ?? [], live }}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
        <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-navy p-4 text-white transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0', mobileNav ? 'translate-x-0' : '-translate-x-full')}>
          <div className="mb-8 flex items-center justify-between px-2 pt-2">
            <div className="flex min-w-0 items-center gap-2.5 text-lg font-extrabold"><BrandMark brand={brand} /><span className="truncate">{brand.platformName}</span></div>
            <button className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
          </div>
          {nav}
          <div className="mt-auto rounded-2xl bg-white/5 p-3">
            <div className="truncate text-sm font-semibold">{me.data?.name ?? '—'}</div>
            <div className="truncate text-xs text-white/50">{membership?.role?.name} · {membership?.tenant?.name}</div>
            <button onClick={logout} className="mt-3 flex items-center gap-2 text-xs font-semibold text-white/60 hover:text-white"><LogOut className="size-4" />Sign out</button>
          </div>
        </aside>
        {mobileNav && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileNav(false)} />}

        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-xl sm:px-6">
            <button className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu className="size-6" /></button>
            <div className="w-full max-w-xs">
              <SearchableCombobox
                ariaLabel="Facility"
                clearable={false}
                value={facilityId}
                onChange={(v) => v && setFacilityId(v)}
                options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name, hint: f.code }))}
                placeholder={facilities.isLoading ? 'Loading facilities…' : 'Select facility'}
              />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className={cn('hidden items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold sm:flex', live ? 'bg-success/12 text-success' : 'bg-surface-2 text-muted')} title={live ? 'Receiving live updates' : 'Live channel offline — refreshing every 15s'}>
                <span className={cn('size-2 rounded-full', live ? 'animate-pulse bg-success' : 'bg-muted')} />{live ? 'Live' : 'Polling'}
              </span>
              <NotificationBell allHref="/notifications" />
              <ProfileDrawer me={me.data} subtitle={membership ? `${membership.role?.name} · ${membership.tenant?.name}` : undefined} links={[{ href: '/notifications', label: 'Notifications', icon: Bell }, { href: '/staff', label: 'Team', icon: Users }]} />
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
