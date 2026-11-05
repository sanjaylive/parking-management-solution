/**
 * Park2All pricing engine — pure, deterministic, decimal-safe.
 *
 * Time handling: iterates over billing units as UTC instants and resolves each unit's
 * local wall-clock (facility IANA timezone) via Intl, so DST shifts and cross-midnight
 * stays are handled without wall-clock arithmetic.
 */
import { z } from 'zod';
import { Decimal, toMinor } from '../common/money';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const money = z.union([z.number(), z.string()]).transform((v) => new Decimal(v)).refine((d) => d.gte(0), 'must be >= 0');

export const rateDefinitionSchema = z.object({
  /** If total stay <= grace minutes the stay is free (unless fixedEntry applies). */
  graceMinutes: z.number().int().min(0).default(0),
  /** First N minutes are not billed (applied before unit iteration). */
  freeMinutes: z.number().int().min(0).default(0),
  /** One-time fee charged on entry regardless of duration (after grace). */
  fixedEntry: money.prefault(0),
  base: z.object({
    unitMinutes: z.number().int().min(1).max(1440),
    amount: money,
    /** Optional distinct price for the very first unit (e.g. "first hour ₹50, then ₹30/h"). */
    firstUnitAmount: money.optional(),
  }),
  /** Time-window modifiers. Later entries take precedence. days: 1=Mon..7=Sun. dates: YYYY-MM-DD (event pricing). */
  windows: z
    .array(
      z
        .object({
          name: z.string(),
          days: z.array(z.number().int().min(1).max(7)).optional(),
          dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
          from: hhmm.default('00:00'),
          to: hhmm.default('00:00'), // 00:00 -> 00:00 = whole day
          multiplier: money.optional(),
          unitAmount: money.optional(),
        })
        .refine((w) => w.multiplier !== undefined || w.unitAmount !== undefined, 'multiplier or unitAmount required'),
    )
    .default([]),
  /** Flat overnight charge replacing unit charges for units starting inside the window. */
  overnight: z.object({ from: hhmm, to: hhmm, flat: money }).optional(),
  /** Maximum charge per local calendar day (applied to unit charges, not fixed/extras). */
  dailyCap: money.optional(),
  lostTicketFee: money.prefault(0),
  evSurcharge: money.prefault(0),
  valetFee: money.prefault(0),
});

export type RateDefinitionInput = z.input<typeof rateDefinitionSchema>;
export type RateDefinition = z.output<typeof rateDefinitionSchema>;

export interface PriceInput {
  definition: RateDefinition;
  timezone: string;
  entryAt: Date;
  exitAt: Date;
  lostTicket?: boolean;
  ev?: boolean;
  valet?: boolean;
  /** Covered by a valid pass: unit charges waived; extras (valet/EV) still apply. */
  passCovered?: boolean;
  discount?: { kind: 'PERCENT' | 'FLAT' | 'FREE_MINUTES'; value: Decimal.Value; maxMinor?: number | null };
}

export interface PriceLine {
  code: string;
  label: string;
  amountMinor: number;
  meta?: Record<string, unknown>;
}

export interface PriceResult {
  durationMinutes: number;
  billableMinutes: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  lines: PriceLine[];
}

const MAX_UNITS = 600_000; // ~400 days of per-minute billing; guards runaway loops

interface LocalParts {
  date: string; // YYYY-MM-DD local
  weekday: number; // 1..7
  minuteOfDay: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function localParts(at: Date, tz: string): LocalParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: wd, minuteOfDay: Number(p.hour) * 60 + Number(p.minute) };
}

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Is minuteOfDay within [from, to)? Handles windows crossing midnight; from==to means all day. */
function inWindow(m: number, from: string, to: string): boolean {
  const a = toMin(from);
  const b = toMin(to);
  if (a === b) return true;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** Overnight "night key": the local date on which the night started. */
function nightKey(lp: LocalParts, at: Date, tz: string, from: string): string {
  if (lp.minuteOfDay >= toMin(from)) return lp.date;
  return localParts(new Date(at.getTime() - 24 * 3600_000), tz).date;
}

export function calculatePrice(input: PriceInput): PriceResult {
  const { definition: d, timezone: tz } = input;
  if (input.exitAt < input.entryAt) throw new Error('exitAt before entryAt');
  // Validate tz early (throws RangeError on unknown zone)
  localParts(input.entryAt, tz);

  const durationMinutes = Math.ceil((input.exitAt.getTime() - input.entryAt.getTime()) / 60_000);
  const lines: PriceLine[] = [];

  const withinGrace = durationMinutes <= d.graceMinutes;
  let freeMinutes = d.freeMinutes;
  if (input.discount?.kind === 'FREE_MINUTES') freeMinutes += Number(input.discount.value);

  let billableMinutes = 0;

  if (!withinGrace && !input.passCovered) {
    if (d.fixedEntry.gt(0)) lines.push({ code: 'FIXED_ENTRY', label: 'Entry fee', amountMinor: toMinor(d.fixedEntry) });

    billableMinutes = Math.max(0, durationMinutes - freeMinutes);
    const units = Math.ceil(billableMinutes / d.base.unitMinutes);
    if (units > MAX_UNITS) throw new Error('Stay too long to price; requires manual settlement');

    const startMs = input.entryAt.getTime() + freeMinutes * 60_000;
    const perDay = new Map<string, Decimal>();
    const nightsCharged = new Set<string>();
    const windowHits = new Map<string, number>();
    let overnightTotal = new Decimal(0);
    let billedUnits = 0; // units charged at unit rates (not absorbed by an overnight flat fee)

    for (let i = 0; i < units; i++) {
      const at = new Date(startMs + i * d.base.unitMinutes * 60_000);
      const lp = localParts(at, tz);

      if (d.overnight && inWindow(lp.minuteOfDay, d.overnight.from, d.overnight.to)) {
        const nk = nightKey(lp, at, tz, d.overnight.from);
        if (!nightsCharged.has(nk)) {
          nightsCharged.add(nk);
          overnightTotal = overnightTotal.plus(d.overnight.flat);
        }
        continue;
      }

      billedUnits++;
      let unitAmt = i === 0 && d.base.firstUnitAmount ? d.base.firstUnitAmount : d.base.amount;
      for (const w of d.windows) {
        const dayOk = !w.days || w.days.includes(lp.weekday);
        const dateOk = !w.dates || w.dates.includes(lp.date);
        if (dayOk && dateOk && inWindow(lp.minuteOfDay, w.from, w.to)) {
          if (w.unitAmount) unitAmt = w.unitAmount;
          if (w.multiplier) unitAmt = unitAmt.mul(w.multiplier);
          windowHits.set(w.name, (windowHits.get(w.name) ?? 0) + 1);
        }
      }
      perDay.set(lp.date, (perDay.get(lp.date) ?? new Decimal(0)).plus(unitAmt));
    }

    let parkingTotal = new Decimal(0);
    let capSaved = new Decimal(0);
    for (const [, amt] of perDay) {
      if (d.dailyCap && amt.gt(d.dailyCap)) {
        capSaved = capSaved.plus(amt.minus(d.dailyCap));
        parkingTotal = parkingTotal.plus(d.dailyCap);
      } else parkingTotal = parkingTotal.plus(amt);
    }
    if (billedUnits > 0) {
      lines.push({
        code: 'PARKING',
        label: `Parking (${billedUnits} × ${d.base.unitMinutes} min)`,
        amountMinor: toMinor(parkingTotal),
        meta: {
          units: billedUnits,
          unitMinutes: d.base.unitMinutes,
          days: perDay.size,
          windows: Object.fromEntries(windowHits),
          dailyCapSavedMinor: toMinor(capSaved),
        },
      });
    }
    if (nightsCharged.size > 0) {
      lines.push({
        code: 'OVERNIGHT',
        label: `Overnight (${nightsCharged.size} night${nightsCharged.size > 1 ? 's' : ''})`,
        amountMinor: toMinor(overnightTotal),
      });
    }
  }

  if (input.lostTicket && d.lostTicketFee.gt(0))
    lines.push({ code: 'LOST_TICKET', label: 'Lost ticket fee', amountMinor: toMinor(d.lostTicketFee) });
  if (input.ev && d.evSurcharge.gt(0))
    lines.push({ code: 'EV_SURCHARGE', label: 'EV charging bay', amountMinor: toMinor(d.evSurcharge) });
  if (input.valet && d.valetFee.gt(0)) lines.push({ code: 'VALET', label: 'Valet service', amountMinor: toMinor(d.valetFee) });

  const grossMinor = lines.reduce((s, l) => s + l.amountMinor, 0);

  let discountMinor = 0;
  if (input.discount && input.discount.kind !== 'FREE_MINUTES') {
    discountMinor =
      input.discount.kind === 'PERCENT'
        ? new Decimal(grossMinor).mul(input.discount.value).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
        : toMinor(input.discount.value);
    if (input.discount.maxMinor != null) discountMinor = Math.min(discountMinor, input.discount.maxMinor);
    discountMinor = Math.min(discountMinor, grossMinor);
    if (discountMinor > 0) lines.push({ code: 'DISCOUNT', label: 'Discount', amountMinor: -discountMinor });
  }

  return {
    durationMinutes,
    billableMinutes,
    grossMinor,
    discountMinor,
    netMinor: grossMinor - discountMinor,
    lines,
  };
}

export function parseRateDefinition(raw: unknown): RateDefinition {
  return rateDefinitionSchema.parse(raw);
}
