import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Convert a rupee Decimal/number/string to integer paise, rounding half-up. */
export function toMinor(rupees: Decimal.Value): number {
  return new Decimal(rupees).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromMinor(minor: number): string {
  return new Decimal(minor).div(100).toFixed(2);
}

export { Decimal };
