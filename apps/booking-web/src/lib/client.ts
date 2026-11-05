'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

interface Tokens { accessToken: string; refreshToken: string }
const KEY = 'p2a.customer.auth';

export const auth = {
  get(): Tokens | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  },
  set(t: Tokens | null) {
    try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event('p2a-auth'));
  },
};

let refreshing: Promise<boolean> | null = null;
function refresh() {
  const t = auth.get();
  if (!t) return Promise.resolve(false);
  refreshing ??= fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) })
    .then(async (r) => {
      if (!r.ok) { auth.set(null); return false; }
      const j = await r.json();
      auth.set({ accessToken: j.accessToken, refreshToken: j.refreshToken });
      return true;
    })
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = any>(path: string, init: { method?: string; json?: unknown } = {}, retry = true): Promise<T> {
  const t = auth.get();
  const headers: Record<string, string> = {};
  if (t) headers.authorization = `Bearer ${t.accessToken}`;
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: init.method ?? (init.json ? 'POST' : 'GET'), headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach Park2All. Check your connection.');
  }
  if (res.status === 401 && retry && t && (await refresh())) return api<T>(path, init, false);
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) throw new ApiError(res.status, body?.code ?? 'ERROR', body?.message ?? res.statusText, body?.details);
  return body as T;
}
