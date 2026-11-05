import { calculatePrice, parseRateDefinition, RateDefinitionInput } from './engine';

const IST = 'Asia/Kolkata';
// Helper: build a UTC Date from an IST wall-clock string (IST = UTC+05:30, no DST).
const ist = (s: string) => new Date(s + '+05:30');

const hourly: RateDefinitionInput = { graceMinutes: 10, base: { unitMinutes: 60, amount: 40 } };

function price(def: RateDefinitionInput, entry: Date, exit: Date, extra: Partial<Parameters<typeof calculatePrice>[0]> = {}, tz = IST) {
  return calculatePrice({ definition: parseRateDefinition(def), timezone: tz, entryAt: entry, exitAt: exit, ...extra });
}

describe('pricing engine', () => {
  it('free within grace period', () => {
    const r = price(hourly, ist('2026-11-05T10:00'), ist('2026-11-05T10:09'));
    expect(r.netMinor).toBe(0);
  });

  it('rounds up partial hours', () => {
    expect(price(hourly, ist('2026-11-05T10:00'), ist('2026-11-05T10:11')).netMinor).toBe(4000);
    expect(price(hourly, ist('2026-11-05T10:00'), ist('2026-11-05T12:01')).netMinor).toBe(12000);
  });

  it('first-unit pricing', () => {
    const r = price({ base: { unitMinutes: 60, amount: 30, firstUnitAmount: 50 } }, ist('2026-11-05T10:00'), ist('2026-11-05T12:30'));
    expect(r.netMinor).toBe(5000 + 3000 + 3000);
  });

  it('per-minute fractional rates are decimal-safe', () => {
    // 0.35 * 3 = 1.05 exactly (float would give 1.0499999)
    const r = price({ base: { unitMinutes: 1, amount: '0.35' } }, ist('2026-11-05T10:00'), ist('2026-11-05T10:03'));
    expect(r.netMinor).toBe(105);
  });

  it('applies peak-hour multiplier by unit start time', () => {
    const def: RateDefinitionInput = {
      base: { unitMinutes: 60, amount: 40 },
      windows: [{ name: 'peak', days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00', multiplier: 1.5 }],
    };
    // Thursday 16:00 -> 19:00: 16-17 normal, 17-18 peak, 18-19 peak
    const r = price(def, ist('2026-11-05T16:00'), ist('2026-11-05T19:00'));
    expect(r.netMinor).toBe(4000 + 6000 + 6000);
  });

  it('weekend rates replace base unit amount', () => {
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 40 }, windows: [{ name: 'weekend', days: [6, 7], unitAmount: 60 }] };
    expect(price(def, ist('2026-11-07T10:00'), ist('2026-11-07T12:00')).netMinor).toBe(12000); // Saturday
  });

  it('event date pricing', () => {
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 40 }, windows: [{ name: 'concert', dates: ['2026-11-05'], unitAmount: 200 }] };
    expect(price(def, ist('2026-11-05T22:00'), ist('2026-11-06T01:00')).netMinor).toBe(20000 + 20000 + 4000);
  });

  it('daily cap per local calendar day across midnight', () => {
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 40 }, dailyCap: 200 };
    // Nov 5 10:00 -> Nov 6 10:00: Nov 5 has 14 units (560 → cap 200), Nov 6 has 10 (400 → cap 200)
    const r = price(def, ist('2026-11-05T10:00'), ist('2026-11-06T10:00'));
    expect(r.netMinor).toBe(40000);
  });

  it('overnight flat charge once per night', () => {
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 40 }, overnight: { from: '22:00', to: '06:00', flat: 100 } };
    // 20:00 -> 08:00 next day: 20,21 normal (80), 22..05 overnight flat 100, 06,07 normal (80)
    const r = price(def, ist('2026-11-05T20:00'), ist('2026-11-06T08:00'));
    expect(r.netMinor).toBe(8000 + 10000 + 8000);
    expect(r.lines.find((l) => l.code === 'OVERNIGHT')?.amountMinor).toBe(10000);
  });

  it('multi-night long stay', () => {
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 40 }, overnight: { from: '22:00', to: '06:00', flat: 100 }, dailyCap: 300 };
    const r = price(def, ist('2026-11-01T08:00'), ist('2026-11-04T08:00'));
    // 3 nights × 100; days: Nov1 08-22 =14u → cap 300, Nov2 06-22=16u→300, Nov3 →300, Nov4 06-08 = 2u → 80
    expect(r.netMinor).toBe(30000 + 30000 * 3 + 8000);
  });

  it('fixed entry + lost ticket + EV + valet extras', () => {
    const def: RateDefinitionInput = { fixedEntry: 20, base: { unitMinutes: 60, amount: 40 }, lostTicketFee: 300, evSurcharge: 50, valetFee: 100 };
    const r = price(def, ist('2026-11-05T10:00'), ist('2026-11-05T11:00'), { lostTicket: true, ev: true, valet: true });
    expect(r.netMinor).toBe(2000 + 4000 + 30000 + 5000 + 10000);
  });

  it('pass covers parking but not extras', () => {
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 40 }, valetFee: 100 };
    const r = price(def, ist('2026-11-05T10:00'), ist('2026-11-05T15:00'), { passCovered: true, valet: true });
    expect(r.netMinor).toBe(10000);
  });

  it('percent discount with max cap and flat discount never negative', () => {
    const r1 = price(hourly, ist('2026-11-05T10:00'), ist('2026-11-05T15:00'), { discount: { kind: 'PERCENT', value: 50, maxMinor: 5000 } });
    expect(r1.grossMinor).toBe(20000);
    expect(r1.discountMinor).toBe(5000);
    const r2 = price(hourly, ist('2026-11-05T10:00'), ist('2026-11-05T11:00'), { discount: { kind: 'FLAT', value: 500 } });
    expect(r2.netMinor).toBe(0);
  });

  it('free minutes from definition and coupon', () => {
    const r = price({ freeMinutes: 30, base: { unitMinutes: 60, amount: 40 } }, ist('2026-11-05T10:00'), ist('2026-11-05T11:30'), {
      discount: { kind: 'FREE_MINUTES', value: 60 },
    });
    expect(r.netMinor).toBe(0);
  });

  it('handles DST spring-forward (America/New_York) — 23-hour local day', () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT. Entry 00:00 EST (05:00Z), exit 04:00 EDT (08:00Z) = 3 real hours.
    const r = price({ base: { unitMinutes: 60, amount: 10 } }, new Date('2026-03-08T05:00:00Z'), new Date('2026-03-08T08:00:00Z'), {}, 'America/New_York');
    expect(r.durationMinutes).toBe(180);
    expect(r.netMinor).toBe(3000);
  });

  it('handles DST fall-back with peak window keyed on local time', () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST; 01:00-02:00 local happens twice. Window 01:00-02:00 ×2.
    const def: RateDefinitionInput = { base: { unitMinutes: 60, amount: 10 }, windows: [{ name: 'x', from: '01:00', to: '02:00', multiplier: 2 }] };
    // 05:00Z = 01:00 EDT, 06:00Z = 01:00 EST, 07:00Z = 02:00 EST
    const r = price(def, new Date('2026-11-01T05:00:00Z'), new Date('2026-11-01T07:00:00Z'), {}, 'America/New_York');
    expect(r.netMinor).toBe(4000);
  });

  it('rejects invalid definitions and timezones', () => {
    expect(() => parseRateDefinition({ base: { unitMinutes: 0, amount: 10 } })).toThrow();
    expect(() => parseRateDefinition({ base: { unitMinutes: 60, amount: -1 } })).toThrow();
    expect(() => price(hourly, ist('2026-11-05T10:00'), ist('2026-11-05T11:00'), {}, 'Mars/Olympus')).toThrow();
    expect(() => price(hourly, ist('2026-11-05T11:00'), ist('2026-11-05T10:00'))).toThrow();
  });
});
