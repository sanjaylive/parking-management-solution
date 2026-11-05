'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, SectionTitle } from '@park2all/web-ui';
import { api, rupees } from '@/lib/api';
import { Select } from '../../ui';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default function OnboardOperator() {
  const router = useRouter();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<any[]>('/v1/admin/plans') });
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api('/v1/admin/settings'), refetchInterval: false });
  const defaults = settings.data?.operators;
  const minPw = settings.data?.security.passwordMinLength ?? 10;
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) => api('/v1/admin/tenants', { method: 'POST', json: body }),
    onSuccess: (t: any) => { toast.success(`${t.name} onboarded`); qc.invalidateQueries({ queryKey: ['admin'] }); router.replace(`/admin/operators/${t.id}`); },
    onError: (e: any) => setError(e.details?.fieldErrors ? Object.entries(e.details.fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join(' · ') : e.message),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const opt = (v?: string) => (v?.trim() ? v.trim() : undefined);
    create.mutate({
      name: f.name.trim(), slug: f.slug.trim(), legalName: opt(f.legalName), gstin: opt(f.gstin)?.toUpperCase(),
      contactEmail: f.contactEmail.trim(), contactPhone: opt(f.contactPhone), planCode: f.planCode, trialDays: Number(f.trialDays),
      owner: { name: f.ownerName.trim(), email: f.ownerEmail.trim(), password: f.ownerPassword },
    });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/admin/operators" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text"><ArrowLeft className="size-4" />Operators</Link>
      <div><h1 className="text-2xl font-extrabold">Onboard operator</h1><p className="text-sm text-muted">Creates the company, its owner login and a subscription in one step.</p></div>

      <form onSubmit={submit} className="space-y-5">
        <section className="card space-y-4 p-5">
          <SectionTitle title="Company" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="name" label="Display name" required minLength={2} maxLength={120} value={name} placeholder="Skyline Parking Co."
              onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
            <Input name="slug" label="Slug (unique, lowercase)" required pattern="[a-z0-9-]{3,40}" title="3–40 lowercase letters, digits or hyphens" value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} />
            <Input name="legalName" label="Legal name (optional)" />
            <Input name="gstin" label="GSTIN (optional)" pattern="[0-9]{2}[A-Za-z0-9]{13}" title="15-character GSTIN" />
            <Input name="contactEmail" type="email" label="Contact email" required />
            <Input name="contactPhone" label="Contact phone (optional)" placeholder="+91…" />
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <SectionTitle title="Subscription" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select key={defaults?.defaultPlanCode ?? 'loading'} name="planCode" label="Plan" required defaultValue={defaults?.defaultPlanCode ?? ''}>
              <option value="" disabled>{plans.isLoading ? 'Loading plans…' : 'Choose a plan'}</option>
              {plans.data?.filter((p) => p.active).sort((a, b) => (a.priceMonthlyMinor || Infinity) - (b.priceMonthlyMinor || Infinity)).map((p) => <option key={p.code} value={p.code}>{p.name} — {p.priceMonthlyMinor ? `${rupees(p.priceMonthlyMinor)}/month` : 'custom pricing'}</option>)}
            </Select>
            <Input key={defaults?.defaultTrialDays ?? 'loading'} name="trialDays" type="number" label="Free trial (days, 0 = start paid)" required min={0} max={90} defaultValue={defaults?.defaultTrialDays ?? 14} />
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <SectionTitle title="Owner login" sub="The operator signs in to the console at /operator with these details. Share the password securely." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="ownerName" label="Owner name" required minLength={2} />
            <Input name="ownerEmail" type="email" label="Owner email" required autoComplete="off" />
            <Input name="ownerPassword" type="password" label={`Temporary password (${minPw}+ characters)`} required minLength={minPw} autoComplete="new-password" />
          </div>
        </section>

        {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" size="lg" loading={create.isPending}>Create operator</Button>
          <Link href="/admin/operators"><Button type="button" size="lg" variant="secondary">Cancel</Button></Link>
        </div>
      </form>
    </div>
  );
}
