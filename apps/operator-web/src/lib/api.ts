'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

interface Auth { accessToken: string; refreshToken: string; tenantId?: string; facilityId?: string }
const KEY = 'p2a.operator.auth';

export const auth = {
  get(): Auth | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  },
  set(a: Auth | null) {
    try { a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event('p2a-auth'));
  },
  patch(p: Partial<Auth>) { const a = this.get(); if (a) this.set({ ...a, ...p }); },
};

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const a = auth.get();
  if (!a) return false;
  refreshing ??= fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: a.refreshToken }) })
    .then(async (r) => {
      if (!r.ok) { auth.set(null); return false; }
      const t = await r.json();
      auth.patch({ accessToken: t.accessToken, refreshToken: t.refreshToken });
      return true;
    })
    .finally(() => { setTimeout(() => (refreshing = null), 0); });
  return refreshing;
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; idempotent?: boolean } = {}, retry = true): Promise<T> {
  const a = auth.get();
  const headers = new Headers(init.headers);
  if (a?.accessToken) headers.set('authorization', `Bearer ${a.accessToken}`);
  if (a?.tenantId) headers.set('x-tenant-id', a.tenantId);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.idempotent) headers.set('idempotency-key', crypto.randomUUID());
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (res.status === 401 && retry && a) {
    if (await refresh()) return api<T>(path, init, false);
  }
  if (res.status === 204) return undefined as T;
  // Empty 200 body (e.g. "no current shift") must become null, not {}.
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) body ??= {};
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? res.statusText, body.details);
  return body as T;
}

export const rupees = (minor: number | null | undefined) =>
  minor == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);

export const duration = (mins: number) => (mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`);

export const vehicleLabel: Record<string, string> = { CAR: 'Car', SUV: 'SUV', TWO_WHEELER: 'Two-wheeler', EV_CAR: 'EV car', EV_TWO_WHEELER: 'EV two-wheeler', LCV: 'LCV', BUS: 'Bus', TRUCK: 'Truck' };
