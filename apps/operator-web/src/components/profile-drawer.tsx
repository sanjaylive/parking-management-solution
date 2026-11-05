'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, KeyRound, LogOut, Monitor, Moon, Pencil, Smartphone, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Input } from '@park2all/web-ui';
import { cn } from '@park2all/web-ui/cn';
import { api, auth } from '@/lib/api';
import { ago } from './notifications';

type Theme = 'light' | 'dark' | 'system';
const initials = (name?: string | null) => (name ?? '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

export function readTheme(): Theme {
  try { return (localStorage.getItem('p2a.theme') as Theme) ?? 'system'; } catch { return 'system'; }
}
export function setTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { t === 'system' ? localStorage.removeItem('p2a.theme') : localStorage.setItem('p2a.theme', t); } catch { /* storage blocked */ }
}

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return <span className={cn('grid size-10 shrink-0 place-items-center rounded-full bg-grad text-sm font-bold text-white', className)}>{initials(name)}</span>;
}

function device(ua?: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

/**
 * Account drawer opened from the avatar in the top-right corner: profile, password, active sign-ins,
 * appearance and shortcuts. Shared by the admin portal and the operator console.
 */
export function ProfileDrawer({ me, subtitle, links }: { me: any; subtitle?: string; links: { href: string; label: string; icon: typeof Bell }[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>('system');
  useEffect(() => setThemeState(readTheme()), [open]);

  const sessions = useQuery({ queryKey: ['me', 'sessions'], queryFn: () => api<any[]>('/v1/auth/sessions'), enabled: open });
  const rename = useMutation({
    mutationFn: (name: string) => api('/v1/auth/me', { method: 'PATCH', json: { name } }),
    onSuccess: () => { toast.success('Name updated'); setEditing(false); qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const changePw = useMutation({
    mutationFn: (b: { currentPassword: string; newPassword: string }) => api('/v1/auth/password', { method: 'POST', json: b }),
    onSuccess: () => { toast.success('Password changed. Other devices were signed out.'); setPwOpen(false); qc.invalidateQueries({ queryKey: ['me', 'sessions'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  async function logout() {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    auth.set(null);
    qc.clear();
    router.replace('/login');
  }
  function submitName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    rename.mutate(String(new FormData(e.currentTarget).get('name') ?? '').trim());
  }
  function submitPw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) { toast.error('The new passwords do not match'); return; }
    changePw.mutate({ currentPassword: String(f.get('currentPassword')), newPassword: String(f.get('newPassword')) });
  }
  function pickTheme(t: Theme) { setTheme(t); setThemeState(t); }

  const roles: string[] = [...(me?.platformRoles ?? []).map((r: string) => r.replace(/_/g, ' ').toLowerCase()), ...(me?.memberships ?? []).map((m: any) => m.role?.name).filter(Boolean)];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(false); setPwOpen(false); } }}>
      <Dialog.Trigger asChild>
        <button className="rounded-full ring-offset-2 ring-offset-bg transition hover:ring-2 hover:ring-brand/40" aria-label="Open account menu">
          <Avatar name={me?.name} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="drawer-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col bg-bg shadow-2xl outline-none" aria-describedby={undefined}>
          <div className="relative overflow-hidden bg-navy px-5 pb-6 pt-5 text-white">
            <div className="absolute -right-16 -top-20 size-56 rounded-full bg-grad opacity-50 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-white/70">Account</Dialog.Title>
              <Dialog.Close className="grid size-9 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="size-5" /></Dialog.Close>
            </div>
            <div className="relative mt-4 flex items-center gap-4">
              <Avatar name={me?.name} className="size-16 text-xl ring-4 ring-white/10" />
              <div className="min-w-0">
                <p className="truncate text-lg font-extrabold">{me?.name ?? '—'}</p>
                <p className="truncate text-sm text-white/60">{me?.email ?? me?.phone}</p>
                {subtitle && <p className="truncate text-xs text-white/50">{subtitle}</p>}
              </div>
            </div>
            <div className="relative mt-4 flex flex-wrap gap-1.5">
              {roles.map((r) => <Badge key={r} className="bg-white/10 capitalize text-white">{r}</Badge>)}
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Profile</h3>
              {editing ? (
                <form onSubmit={submitName} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
                  <Input name="name" label="Full name" defaultValue={me?.name ?? ''} required minLength={2} maxLength={80} autoFocus />
                  <div className="flex gap-2"><Button type="submit" size="sm" loading={rename.isPending}>Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
                </form>
              ) : (
                <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
                  <Row label="Name" value={me?.name ?? '—'} action={<button onClick={() => setEditing(true)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label="Edit name"><Pencil className="size-4" /></button>} />
                  <Row label="Email" value={me?.email ?? '—'} />
                  {me?.phone && <Row label="Mobile" value={me.phone} />}
                  <Row label="Last sign-in" value={me?.lastLoginAt ? ago(me.lastLoginAt) : '—'} />
                  <Row label="Member since" value={me?.createdAt ? new Date(me.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'} />
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Appearance</h3>
              <div className="grid grid-cols-3 gap-2">
                {([['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'System']] as const).map(([t, I, l]) => (
                  <button key={t} onClick={() => pickTheme(t)} aria-pressed={theme === t} className={cn('flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-semibold transition', theme === t ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-muted hover:text-text')}>
                    <I className="size-5" />{l}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Security</h3>
              {pwOpen ? (
                <form onSubmit={submitPw} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
                  <Input name="currentPassword" type="password" label="Current password" required autoComplete="current-password" autoFocus />
                  <Input name="newPassword" type="password" label="New password" required minLength={8} autoComplete="new-password" />
                  <Input name="confirm" type="password" label="Confirm new password" required minLength={8} autoComplete="new-password" />
                  <p className="text-xs text-muted">Changing your password signs you out on every other device.</p>
                  <div className="flex gap-2"><Button type="submit" size="sm" loading={changePw.isPending}>Change password</Button><Button type="button" size="sm" variant="ghost" onClick={() => setPwOpen(false)}>Cancel</Button></div>
                </form>
              ) : (
                <button onClick={() => setPwOpen(true)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left text-sm font-semibold hover:bg-surface-2">
                  <KeyRound className="size-5 text-muted" />Change password
                </button>
              )}
              <div className="rounded-2xl border border-border bg-surface">
                <p className="border-b border-border px-4 py-3 text-sm font-semibold">Active sign-ins</p>
                {sessions.isLoading && <p className="px-4 py-3 text-sm text-muted">Loading…</p>}
                {sessions.data?.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    {/Android|iPhone|iPad/.test(s.userAgent ?? '') ? <Smartphone className="size-4 text-muted" /> : <Monitor className="size-4 text-muted" />}
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{device(s.userAgent)}</p><p className="truncate text-xs text-muted">{s.ip ?? 'unknown IP'} · {ago(s.createdAt)}</p></div>
                    {s.current && <Badge tone="success">this device</Badge>}
                  </div>
                ))}
              </div>
            </section>

            {links.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Shortcuts</h3>
                <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
                  {links.map((l) => (
                    <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm font-semibold hover:bg-surface-2"><l.icon className="size-4.5 text-muted" />{l.label}</Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="border-t border-border p-4">
            <Button variant="secondary" className="w-full" onClick={logout}><LogOut className="size-4" />Sign out</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{value}</span>
      {action}
    </div>
  );
}

