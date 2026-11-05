'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { Button, Input } from '@park2all/web-ui';
import { X } from 'lucide-react';
import { createContext, FormEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, auth } from '@/lib/client';

interface Me { id: string; name: string | null; phone: string; profileComplete: boolean }
interface Ctx { me: Me | null; ready: boolean; requireLogin: () => Promise<Me>; logout: () => Promise<void>; reload: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

/** Customer session for the booking site. Sign-in is the same mobile-OTP flow as the app — no separate signup. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const waiters = useRef<((m: Me) => void)[]>([]);

  const reload = useCallback(async () => {
    if (!auth.get()) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      setMe(await api('/v1/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    reload();
    const h = () => { if (!auth.get()) setMe(null); };
    window.addEventListener('p2a-auth', h);
    return () => window.removeEventListener('p2a-auth', h);
  }, [reload]);

  const requireLogin = useCallback(() => {
    if (me?.profileComplete) return Promise.resolve(me);
    setOpen(true);
    return new Promise<Me>((resolve) => waiters.current.push(resolve));
  }, [me]);

  const done = (m: Me) => {
    setMe(m);
    setOpen(false);
    waiters.current.splice(0).forEach((w) => w(m));
  };

  async function logout() {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    auth.set(null);
    setMe(null);
  }

  return (
    <AuthCtx.Provider value={{ me, ready, requireLogin, logout, reload }}>
      {children}
      <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) waiters.current = []; }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-surface p-6 shadow-2xl" aria-describedby={undefined}>
            <Dialog.Close className="absolute right-4 top-4 rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Close"><X className="size-5" /></Dialog.Close>
            <LoginFlow me={me} onDone={done} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </AuthCtx.Provider>
  );
}

function LoginFlow({ me, onDone }: { me: Me | null; onDone: (m: Me) => void }) {
  const [step, setStep] = useState<'phone' | 'otp' | 'profile'>(me && !me.profileComplete ? 'profile' : 'phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e164 = '+91' + phone.replace(/\D/g, '');

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const sendOtp = (e: FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, '').length !== 10) return setError('Enter your 10-digit mobile number');
    run(async () => {
      const r = await api('/v1/auth/otp/request', { json: { phone: e164 } });
      setSentTo(r.sentTo);
      setDevCode(r.devCode ?? null);
      setStep('otp');
    });
  };

  const verify = (code: string) =>
    run(async () => {
      const r = await api('/v1/auth/otp/verify', { json: { phone: e164, code } });
      auth.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      const m: Me = await api('/v1/auth/me');
      if (m.profileComplete) onDone(m);
      else setStep('profile');
    });

  const saveProfile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (name.length < 2) return setError('Enter your name');
    run(async () => {
      await api('/v1/me/profile', { method: 'PATCH', json: { name } });
      onDone(await api('/v1/auth/me'));
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <Dialog.Title className="text-xl font-extrabold">{step === 'profile' ? 'One last thing' : 'Sign in to book'}</Dialog.Title>
        <p className="mt-1 text-sm text-muted">{step === 'phone' ? 'We’ll text you a one-time code. New here? This creates your account.' : step === 'otp' ? `Enter the 6-digit code sent to ${sentTo}` : 'What should we call you?'}</p>
      </div>
      {step === 'phone' && (
        <form onSubmit={sendOtp} className="space-y-4">
          <label className="flex h-12 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-[var(--ring)]">
            <span className="font-semibold text-muted">+91</span>
            <input autoFocus value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" className="h-full flex-1 bg-transparent text-lg font-semibold tracking-wider outline-none" aria-label="Mobile number" />
          </label>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Get OTP</Button>
        </form>
      )}
      {step === 'otp' && (
        <div className="space-y-4">
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-label="One-time code"
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); e.target.value = v; if (v.length === 6) verify(v); }}
            className="h-14 w-full rounded-xl border border-border bg-surface text-center text-2xl font-extrabold tracking-[0.6em] outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)]"
          />
          {devCode && <p className="text-center text-sm font-semibold text-warning">Development server — your code is {devCode}</p>}
          <button className="text-sm font-semibold text-brand" onClick={() => setStep('phone')}>Use a different number</button>
        </div>
      )}
      {step === 'profile' && (
        <form onSubmit={saveProfile} className="space-y-4">
          <Input name="name" label="Full name" autoFocus autoComplete="name" />
          <Button type="submit" size="lg" className="w-full" loading={busy}>Continue</Button>
        </form>
      )}
      {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
