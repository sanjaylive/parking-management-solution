'use client';
import { forwardRef, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Badge } from '@park2all/web-ui';
import { cn } from '@park2all/web-ui/cn';

const field = 'w-full rounded-xl border border-border bg-surface px-3.5 text-text outline-none transition focus:border-brand focus:ring-4 focus:ring-[var(--ring)]';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label?: string }>(({ label, className, id, children, ...p }, ref) => (
  <label className="block space-y-1.5" htmlFor={id ?? p.name}>
    {label && <span className="text-sm font-medium text-muted">{label}</span>}
    <select ref={ref} id={id ?? p.name} className={cn(field, 'h-11', className)} {...p}>{children}</select>
  </label>
));
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }>(({ label, className, id, ...p }, ref) => (
  <label className="block space-y-1.5" htmlFor={id ?? p.name}>
    {label && <span className="text-sm font-medium text-muted">{label}</span>}
    <textarea ref={ref} id={id ?? p.name} className={cn(field, 'min-h-20 py-2.5', className)} {...p} />
  </label>
));
Textarea.displayName = 'Textarea';

const tenantTone: Record<string, 'success' | 'cyan' | 'warning' | 'danger' | 'neutral'> = { ACTIVE: 'success', TRIAL: 'cyan', PAST_DUE: 'warning', SUSPENDED: 'danger', CLOSED: 'neutral' };
const subTone: Record<string, 'success' | 'cyan' | 'warning' | 'danger' | 'neutral'> = { ACTIVE: 'success', TRIALING: 'cyan', PAST_DUE: 'warning', CANCELLED: 'neutral', EXPIRED: 'danger' };
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();

export const TenantStatus = ({ status }: { status: string }) => <Badge tone={tenantTone[status] ?? 'neutral'}>{label(status)}</Badge>;
export const SubscriptionStatus = ({ status }: { status: string }) => <Badge tone={subTone[status] ?? 'neutral'}>{label(status)}</Badge>;

export const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
