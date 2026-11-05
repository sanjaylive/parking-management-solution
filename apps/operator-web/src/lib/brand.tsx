'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { cn } from '@park2all/web-ui/cn';
import { API_URL } from './api';

export interface Brand {
  platformName: string; tagline: string; logoUrl: string; primaryColor: string; accentColor: string;
  supportEmail: string; supportPhone: string; website: string;
}
export const DEFAULT_BRAND: Brand = {
  platformName: 'Park2All', tagline: 'Smart Mobility & Parking', logoUrl: '', primaryColor: '#2257ff', accentColor: '#00b8d9',
  supportEmail: '', supportPhone: '', website: '',
};

/** Static files under public/ (the app is mounted at /operator in production). */
export const asset = (p: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${p}`;

/** Applies brand colours as CSS variables. Defaults are left to the stylesheet (which has dark-mode variants). */
export function applyBrandColors(b: Pick<Brand, 'primaryColor' | 'accentColor'>) {
  const root = document.documentElement.style;
  if (b.primaryColor.toLowerCase() === DEFAULT_BRAND.primaryColor && b.accentColor.toLowerCase() === DEFAULT_BRAND.accentColor) {
    ['--brand', '--brand-2', '--ring', '--grad', '--grad-cyan'].forEach((v) => root.removeProperty(v));
    return;
  }
  root.setProperty('--brand', b.primaryColor);
  root.setProperty('--brand-2', b.accentColor);
  root.setProperty('--ring', `${b.primaryColor}55`);
  root.setProperty('--grad', `linear-gradient(135deg, ${b.primaryColor} 0%, ${b.accentColor} 100%)`);
  root.setProperty('--grad-cyan', `linear-gradient(135deg, ${b.accentColor} 0%, ${b.primaryColor} 100%)`);
}

export function useBrand(): Brand {
  const q = useQuery({
    queryKey: ['brand'],
    queryFn: async () => ({ ...DEFAULT_BRAND, ...(await (await fetch(`${API_URL}/v1/public/brand`)).json()) }) as Brand,
    staleTime: 5 * 60_000, refetchInterval: false, retry: 1,
  });
  const brand = q.data ?? DEFAULT_BRAND;
  useEffect(() => {
    if (q.data) applyBrandColors(q.data);
  }, [q.data]);
  useEffect(() => {
    if (q.data) document.title = document.title.replace(/^Park2All/, q.data.platformName);
  }, [q.data]);
  return brand;
}

export function BrandMark({ brand, className }: { brand: Brand; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={brand.logoUrl || asset('/brand/logo-mark.svg')} alt="" className={cn('size-9 shrink-0 rounded-xl object-contain', className)} />;
}
