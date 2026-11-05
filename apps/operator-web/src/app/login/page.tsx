'use client';
import { Car, ShieldCheck, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { api, ApiError, auth } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const r = await api('/v1/auth/login', { method: 'POST', json: { identifier: f.get('identifier'), password: f.get('password') } });
      auth.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      const me = await api('/v1/auth/me');
      const m = me.memberships[0];
      if (!m) { auth.set(null); throw new ApiError(403, 'NO_TENANT', 'This account is not a member of any parking operator.'); }
      auth.patch({ tenantId: m.tenantId, facilityId: m.facilityIds?.[0] });
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 size-[520px] rounded-full bg-grad opacity-40 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 size-[420px] rounded-full bg-grad-cyan opacity-30 blur-3xl" />
        <div className="relative flex items-center gap-3 text-xl font-extrabold"><span className="grid size-10 place-items-center rounded-xl bg-grad">P</span>Park2All</div>
        <div className="relative max-w-md space-y-6">
          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight">Every gate, slot and rupee — <span className="text-grad brightness-150">live.</span></h1>
          <p className="text-lg text-white/70">Run multi-site parking with real-time occupancy, server-verified payments and hardware you can trust.</p>
          <ul className="space-y-3 text-white/80">
            {[[Zap, 'Real-time occupancy across every facility'], [ShieldCheck, 'Audited overrides and tamper-proof ledger'], [Car, 'QR, ANPR and walk-in lanes in one console']].map(([I, t]: any) => (
              <li key={t} className="flex items-center gap-3"><I className="size-5 text-cyan-300" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/50">Smart Mobility & Parking</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-2xl font-extrabold">Sign in to your console</h2>
            <p className="mt-1 text-sm text-muted">Operators, managers and gate staff.</p>
          </div>
          <Input name="identifier" label="Email or mobile" autoComplete="username" required placeholder="you@company.com" />
          <Input name="password" type="password" label="Password" autoComplete="current-password" required minLength={8} />
          {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>Sign in</Button>
        </form>
      </section>
    </main>
  );
}
