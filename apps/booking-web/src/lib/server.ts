import 'server-only';

const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

/** Public, unauthenticated reads for server components. Availability changes fast: short revalidation. */
export async function publicGet<T>(path: string, revalidate = 20): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { next: { revalidate } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`API ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    console.error('publicGet failed', path, e);
    throw e;
  }
}
