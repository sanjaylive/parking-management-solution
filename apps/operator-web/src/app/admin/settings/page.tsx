'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Building2, Info, Palette, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, ErrorState, Input, SectionTitle, Skeleton } from '@park2all/web-ui';
import { cn } from '@park2all/web-ui/cn';
import { api, rupees } from '@/lib/api';
import { Brand, BrandMark, DEFAULT_BRAND, applyBrandColors } from '@/lib/brand';
import { Select } from '../ui';

const TABS = [
  { key: 'brand', label: 'Brand', icon: Palette },
  { key: 'operators', label: 'Operators', icon: Building2 },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'system', label: 'System', icon: Info },
] as const;
type Tab = (typeof TABS)[number]['key'];

function useSave<T>(group: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: T) => api(`/v1/admin/settings/${group}`, { method: 'PUT', json: value }),
    onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); qc.invalidateQueries({ queryKey: ['brand'] }); },
    onError: (e: any) => toast.error(e.details?.fieldErrors ? Object.values(e.details.fieldErrors).flat().join(' · ') : e.message),
  });
}

function ColorField({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-muted">{label}</span>
      <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-2 focus-within:border-brand focus-within:ring-4 focus-within:ring-[var(--ring)]">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="size-8 cursor-pointer rounded-lg border-0 bg-transparent p-0" aria-label={`${label} picker`} />
        <input name={name} value={value} onChange={(e) => onChange(e.target.value)} pattern="#[0-9a-fA-F]{6}" required className="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase outline-none" />
      </div>
    </label>
  );
}

function BrandTab({ initial }: { initial: Brand }) {
  const [b, setB] = useState<Brand>(initial);
  const save = useSave<Brand>('brand');
  const set = (k: keyof Brand) => (v: string) => setB((x) => ({ ...x, [k]: v }));
  // Live preview of colours while editing; restore the saved brand when leaving the page.
  useEffect(() => { if (/^#[0-9a-f]{6}$/i.test(b.primaryColor) && /^#[0-9a-f]{6}$/i.test(b.accentColor)) applyBrandColors(b); }, [b.primaryColor, b.accentColor]);
  useEffect(() => () => applyBrandColors(initial), [initial]);
  const dirty = JSON.stringify(b) !== JSON.stringify(initial);

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(b); }} className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <section className="card space-y-4 p-5">
          <SectionTitle title="Identity" sub="Shown on sign-in pages, the consoles and customer-facing apps." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Platform name" value={b.platformName} onChange={(e) => set('platformName')(e.target.value)} required minLength={2} maxLength={60} />
            <Input label="Tagline" value={b.tagline} onChange={(e) => set('tagline')(e.target.value)} maxLength={120} />
            <div className="sm:col-span-2">
              <Input label="Logo URL (square image; leave empty to use the built-in Park2All logo)" type="url" value={b.logoUrl} onChange={(e) => set('logoUrl')(e.target.value)} placeholder="https://…/logo.svg" />
            </div>
          </div>
        </section>
        <section className="card space-y-4 p-5">
          <SectionTitle title="Colours" sub="Buttons, highlights and gradients. Changes preview live on this page." />
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField name="primaryColor" label="Primary" value={b.primaryColor} onChange={set('primaryColor')} />
            <ColorField name="accentColor" label="Accent" value={b.accentColor} onChange={set('accentColor')} />
          </div>
          <button type="button" onClick={() => setB((x) => ({ ...x, primaryColor: DEFAULT_BRAND.primaryColor, accentColor: DEFAULT_BRAND.accentColor }))} className="text-sm font-semibold text-brand">Reset to default colours</button>
        </section>
        <section className="card space-y-4 p-5">
          <SectionTitle title="Support contact" sub="Where operators and customers can reach you." />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Support email" type="email" value={b.supportEmail} onChange={(e) => set('supportEmail')(e.target.value)} placeholder="support@park.2all.co.in" />
            <Input label="Support phone" value={b.supportPhone} onChange={(e) => set('supportPhone')(e.target.value)} placeholder="+91…" maxLength={30} />
            <Input label="Website" type="url" value={b.website} onChange={(e) => set('website')(e.target.value)} placeholder="https://…" />
          </div>
        </section>
        <div className="flex gap-3">
          <Button type="submit" loading={save.isPending} disabled={!dirty}>Save brand</Button>
          {dirty && <Button type="button" variant="ghost" onClick={() => setB(initial)}>Discard changes</Button>}
        </div>
      </div>

      <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Preview</p>
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="relative overflow-hidden bg-navy p-5 text-white">
            <div className="absolute -right-10 -top-10 size-40 rounded-full bg-grad opacity-50 blur-2xl" />
            <div className="relative flex items-center gap-2.5 font-extrabold"><BrandMark brand={b} />{b.platformName || '—'}</div>
            <p className="relative mt-6 text-xl font-extrabold leading-tight">Every gate, slot and rupee — <span className="text-grad brightness-150">live.</span></p>
            <p className="relative mt-2 text-xs text-white/60">{b.tagline}</p>
          </div>
          <div className="space-y-3 bg-surface p-5">
            <div className="h-9 rounded-xl border border-border bg-bg" />
            <div className="grid h-10 place-items-center rounded-xl bg-grad text-sm font-semibold text-white">Sign in</div>
            <div className="flex gap-2"><Badge tone="brand">Brand</Badge><Badge tone="cyan">Accent</Badge></div>
            {(b.supportEmail || b.supportPhone) && <p className="text-xs text-muted">Help: {[b.supportEmail, b.supportPhone].filter(Boolean).join(' · ')}</p>}
          </div>
        </div>
      </aside>
    </form>
  );
}

function OperatorsTab({ initial }: { initial: { defaultPlanCode: string; defaultTrialDays: number } }) {
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<any[]>('/v1/admin/plans') });
  const save = useSave('operators');
  return (
    <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ defaultPlanCode: f.get('defaultPlanCode'), defaultTrialDays: Number(f.get('defaultTrialDays')) }); }} className="card max-w-2xl space-y-4 p-5">
      <SectionTitle title="Onboarding defaults" sub="Pre-filled when you onboard a new operator. You can still change them per operator." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="defaultPlanCode" label="Default plan" defaultValue={initial.defaultPlanCode}>
          {plans.data?.map((p) => <option key={p.code} value={p.code}>{p.name}{p.priceMonthlyMinor ? ` — ${rupees(p.priceMonthlyMinor)}/month` : ' — custom pricing'}</option>)}
          {!plans.data && <option value={initial.defaultPlanCode}>{initial.defaultPlanCode}</option>}
        </Select>
        <Input name="defaultTrialDays" type="number" min={0} max={90} required label="Default free trial (days)" defaultValue={initial.defaultTrialDays} />
      </div>
      <Button type="submit" loading={save.isPending}>Save</Button>
    </form>
  );
}

const NOTIFY: { key: string; title: string; body: string }[] = [
  { key: 'operatorOnboarded', title: 'New operator onboarded', body: 'Tell the platform team when an operator is created.' },
  { key: 'operatorStatusChanged', title: 'Operator status changes', body: 'Suspensions, reactivations and payment status changes.' },
  { key: 'hardwareAlerts', title: 'Critical hardware alerts', body: 'Barrier failures at any operator. Operators are always told about their own.' },
  { key: 'welcomeOwner', title: 'Welcome message to new owners', body: 'Send the operator owner a getting-started notification.' },
];

function NotificationsTab({ initial }: { initial: Record<string, boolean> }) {
  const [v, setV] = useState(initial);
  const save = useSave('notifications');
  return (
    <div className="card max-w-2xl p-5">
      <SectionTitle title="Platform notifications" sub="Choose which events create in-app notifications for the platform team." />
      <div className="divide-y divide-border">
        {NOTIFY.map((n) => (
          <label key={n.key} className="flex cursor-pointer items-center gap-4 py-4">
            <div className="flex-1"><p className="font-semibold">{n.title}</p><p className="text-sm text-muted">{n.body}</p></div>
            <button type="button" role="switch" aria-checked={v[n.key]} onClick={() => setV((x) => ({ ...x, [n.key]: !x[n.key] }))}
              className={cn('relative h-7 w-12 shrink-0 rounded-full transition', v[n.key] ? 'bg-brand' : 'bg-border')}>
              <span className={cn('absolute top-1 size-5 rounded-full bg-white shadow transition-all', v[n.key] ? 'left-6' : 'left-1')} />
            </button>
          </label>
        ))}
      </div>
      <Button className="mt-2" onClick={() => save.mutate(v)} loading={save.isPending} disabled={JSON.stringify(v) === JSON.stringify(initial)}>Save</Button>
    </div>
  );
}

function SecurityTab({ initial }: { initial: { passwordMinLength: number } }) {
  const save = useSave('security');
  return (
    <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); save.mutate({ passwordMinLength: Number(new FormData(e.currentTarget).get('passwordMinLength')) }); }} className="card max-w-2xl space-y-4 p-5">
      <SectionTitle title="Passwords" sub="Applies to new operator owner accounts and to every password change." />
      <Input name="passwordMinLength" type="number" min={8} max={64} required label="Minimum password length" defaultValue={initial.passwordMinLength} />
      <ul className="space-y-1.5 text-sm text-muted">
        <li>• Passwords are stored as Argon2 hashes and are never visible to anyone.</li>
        <li>• Changing a password signs that person out on all other devices.</li>
        <li>• Sign-in attempts are rate-limited and failures are recorded in the audit log.</li>
      </ul>
      <Button type="submit" loading={save.isPending}>Save</Button>
    </form>
  );
}

function SystemTab() {
  const q = useQuery({ queryKey: ['admin', 'settings', 'system'], queryFn: () => api('/v1/admin/settings/system') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const rows: [string, React.ReactNode][] = s ? [
    ['Mode', s.sandbox ? <Badge tone="warning">Staging (sandbox providers)</Badge> : <Badge tone="success">Production</Badge>],
    ['SMS / OTP provider', s.otpProvider],
    ['Payment provider', s.paymentProvider],
    ['Public URL', s.publicUrl ?? '—'],
    ['Release', <code key="r" className="text-xs">{String(s.release).slice(0, 12)}</code>],
    ['Node.js', s.nodeVersion],
    ['API uptime', `${Math.floor(s.uptimeSeconds / 3600)}h ${Math.floor((s.uptimeSeconds % 3600) / 60)}m`],
    ['Users / operators', `${s.users} / ${s.tenants}`],
  ] : [];
  return (
    <div className="card max-w-2xl p-5">
      <SectionTitle title="System" sub="Read-only. Providers and secrets are configured on the server (.env.production), never in the browser." />
      {q.isLoading ? <Skeleton className="h-48" /> : (
        <dl className="divide-y divide-border">
          {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
        </dl>
      )}
      {s?.sandbox && <p className="mt-3 rounded-xl bg-warning/10 p-3 text-sm text-warning">OTP codes are returned by the API and payments are simulated. Configure real SMS and payment providers on the server before taking real customers.</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('brand');
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api('/v1/admin/settings'), refetchInterval: false });
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Settings</h1><p className="text-sm text-muted">Platform-wide configuration. Every change is recorded in the audit log.</p></div>
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={cn('flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition', tab === t.key ? 'bg-brand text-white shadow' : 'text-muted hover:text-text')}>
            <t.icon className="size-4" />{t.label}
          </button>
        ))}
      </div>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-80 rounded-2xl" /> : (
        <>
          {tab === 'brand' && <BrandTab key={JSON.stringify(q.data.brand)} initial={q.data.brand} />}
          {tab === 'operators' && <OperatorsTab key={JSON.stringify(q.data.operators)} initial={q.data.operators} />}
          {tab === 'notifications' && <NotificationsTab key={JSON.stringify(q.data.notifications)} initial={q.data.notifications} />}
          {tab === 'security' && <SecurityTab key={JSON.stringify(q.data.security)} initial={q.data.security} />}
          {tab === 'system' && <SystemTab />}
        </>
      )}
    </div>
  );
}
