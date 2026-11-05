'use client';
import { LocateFixed } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/** Uses browser geolocation only when the user asks; coordinates go in the URL (not personal data beyond the search). */
export function LocateButton() {
  const router = useRouter();
  const sp = useSearchParams();
  const [state, setState] = useState<'idle' | 'busy' | 'denied'>('idle');
  return (
    <button
      type="button"
      onClick={() => {
        if (!navigator.geolocation) return setState('denied');
        setState('busy');
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const q = new URLSearchParams(sp);
            q.set('lat', p.coords.latitude.toFixed(4));
            q.set('lng', p.coords.longitude.toFixed(4));
            router.push(`/?${q}`);
            setState('idle');
          },
          () => setState('denied'),
          { timeout: 8000, maximumAge: 300_000 },
        );
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-semibold text-white hover:bg-white/20"
    >
      <LocateFixed className="size-4" />
      {state === 'busy' ? 'Locating…' : state === 'denied' ? 'Location unavailable' : 'Use my location'}
    </button>
  );
}
