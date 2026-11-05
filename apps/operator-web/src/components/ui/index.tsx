'use client';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { AlertTriangle, Check, ChevronsUpDown, Inbox, Loader2, X } from 'lucide-react';
import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, useState } from 'react';
import { cn } from '@/lib/cn';

// ───────── Button ─────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' | 'xl'; loading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none',
        { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base', xl: 'h-16 px-8 text-lg rounded-2xl' }[size],
        {
          primary: 'bg-grad text-white shadow-[0_6px_20px_-6px_var(--brand)] hover:brightness-110',
          secondary: 'bg-surface-2 text-text border border-border hover:border-brand/50',
          ghost: 'text-muted hover:text-text hover:bg-surface-2',
          danger: 'bg-danger text-white hover:brightness-110',
          success: 'bg-success text-white hover:brightness-110 shadow-[0_6px_20px_-6px_var(--success)]',
        }[variant],
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }>(({ label, error, className, id, ...p }, ref) => {
  const inputId = id ?? p.name;
  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      {label && <span className="text-sm font-medium text-muted">{label}</span>}
      <input
        ref={ref}
        id={inputId}
        className={cn('h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-text placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-[var(--ring)]', error && 'border-danger', className)}
        {...p}
      />
      {error && <span className="text-xs text-danger">{error}</span>}
    </label>
  );
});
Input.displayName = 'Input';

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'cyan'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    brand: 'bg-brand/12 text-brand',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/12 text-danger',
    cyan: 'bg-brand-2/15 text-brand-2',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

// ───────── Indian number plate ─────────
export function VehicleNumberPlate({ plate, size = 'md' }: { plate: string; size?: 'sm' | 'md' | 'lg' }) {
  const m = plate.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  const text = m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : plate;
  return (
    <span className={cn('inline-flex items-stretch overflow-hidden rounded-md border-2 border-[#0b1530] bg-white font-mono font-bold text-[#0b1530] shadow-sm dark:border-white/80', { sm: 'text-xs', md: 'text-sm', lg: 'text-2xl' }[size])}>
      <span className={cn('flex items-center bg-[#1d4ed8] text-[8px] font-black text-white', size === 'lg' ? 'px-1.5 text-[11px]' : 'px-1')}>IND</span>
      <span className={cn('tracking-wider', { sm: 'px-1.5 py-0.5', md: 'px-2 py-0.5', lg: 'px-3 py-1' }[size])}>{text}</span>
    </span>
  );
}

// ───────── Metric card ─────────
export function MetricCard({ label, value, hint, icon, tone = 'brand' }: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: 'brand' | 'cyan' | 'success' | 'warning' | 'violet' }) {
  const ring = { brand: 'from-brand/20 to-indigo/10 text-brand', cyan: 'from-brand-2/25 to-brand/10 text-brand-2', success: 'from-success/20 to-success/5 text-success', warning: 'from-warning/25 to-warning/5 text-warning', violet: 'from-violet/25 to-indigo/10 text-violet' }[tone];
  return (
    <div className="card p-5 transition hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={cn('grid size-10 place-items-center rounded-xl bg-gradient-to-br', ring)}>{icon}</span>
      </div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight tabular">{value}</div>
      {hint && <div className="mt-1 text-sm text-muted">{hint}</div>}
    </div>
  );
}

// ───────── Occupancy ring ─────────
export function OccupancyRing({ occupied, total, reserved = 0, size = 168, label }: { occupied: number; total: number; reserved?: number; size?: number; label?: string }) {
  const stroke = size / 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? occupied / total : 0;
  const rPct = total ? Math.min(reserved / total, 1 - pct) : 0;
  const color = pct > 0.9 ? 'var(--danger)' : pct > 0.75 ? 'var(--warning)' : 'url(#occGrad)';
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${occupied} of ${total} occupied`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="occGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-2)" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {rPct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--violet)" strokeOpacity={0.45} strokeWidth={stroke} strokeDasharray={`${rPct * c} ${c}`} strokeDashoffset={-pct * c} strokeLinecap="round" />}
        {pct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${pct * c} ${c}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray .8s cubic-bezier(.2,.8,.2,1)' }} />}
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-extrabold tabular" style={{ fontSize: size / 5.5 }}>{Math.round(pct * 100)}%</div>
        <div className="text-xs font-medium text-muted">{label ?? `${occupied}/${total} filled`}</div>
      </div>
    </div>
  );
}

// ───────── States ─────────
export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton h-4', className)} />;

export function EmptyState({ title, body, icon, action }: { title: string; body?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-muted">{icon ?? <Inbox className="size-6" />}</div>
      <div className="text-base font-semibold">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger/8 p-4 text-sm">
      <AlertTriangle className="size-5 shrink-0 text-danger" />
      <span className="flex-1">{(error as Error)?.message ?? 'Something went wrong'}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

// ───────── Searchable combobox (keyboard accessible, clearable) ─────────
export interface Option { value: string; label: string; hint?: string }
export function SearchableCombobox({ options, value, onChange, placeholder = 'Select…', clearable = true, className, ariaLabel }: { options: Option[]; value?: string | null; onChange: (v: string | null) => void; placeholder?: string; clearable?: boolean; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button role="combobox" aria-expanded={open} aria-label={ariaLabel ?? placeholder} className={cn('flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 text-left text-sm transition hover:border-brand/50', className)}>
          <span className={cn('truncate', !selected && 'text-muted')}>{selected?.label ?? placeholder}</span>
          <span className="flex items-center gap-1 text-muted">
            {clearable && selected && (
              <span role="button" tabIndex={0} aria-label="Clear" onClick={(e) => { e.stopPropagation(); onChange(null); }} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onChange(null))} className="rounded p-0.5 hover:bg-surface-2">
                <X className="size-3.5" />
              </span>
            )}
            <ChevronsUpDown className="size-4" />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <Command>
            <Command.Input autoFocus placeholder="Search…" className="h-10 w-full border-b border-border bg-transparent px-3 text-sm outline-none" />
            <Command.List className="max-h-64 overflow-auto p-1">
              <Command.Empty className="p-3 text-center text-sm text-muted">No matches</Command.Empty>
              {options.map((o) => (
                <Command.Item key={o.value} value={`${o.label} ${o.hint ?? ''}`} onSelect={() => { onChange(o.value); setOpen(false); }} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm data-[selected=true]:bg-surface-2">
                  <Check className={cn('size-4 text-brand', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SectionTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {sub && <p className="text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const sessionTone: Record<string, Parameters<typeof Badge>[0]['tone']> = { ACTIVE: 'brand', PAYMENT_PENDING: 'warning', EXIT_READY: 'cyan', COMPLETED: 'success', CANCELLED: 'neutral', EXCEPTION: 'danger' };
export const SessionStatus = ({ status }: { status: string }) => <Badge tone={sessionTone[status] ?? 'neutral'}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
