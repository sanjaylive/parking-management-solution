export const rupees = (minor: number | null | undefined) =>
  minor == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);

export const vehicleLabel: Record<string, string> = { CAR: 'Car', SUV: 'SUV', TWO_WHEELER: 'Two-wheeler', EV_CAR: 'Electric car', EV_TWO_WHEELER: 'Electric 2W', LCV: 'LCV', BUS: 'Bus', TRUCK: 'Truck' };

export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function describeRate(def: any): string {
  if (!def) return 'Rates on request';
  const b = def.base;
  const unit = b.unitMinutes === 60 ? 'hr' : `${b.unitMinutes} min`;
  return [
    b.firstUnitAmount != null ? `₹${b.firstUnitAmount} first ${unit}, then ₹${b.amount}/${unit}` : `₹${b.amount}/${unit}`,
    ...(def.windows ?? []).map((w: any) => (w.multiplier != null ? `${w.name} ${w.from}–${w.to} ×${w.multiplier}` : `${w.name} ₹${w.unitAmount}/${unit}`)),
    def.overnight ? `overnight ${def.overnight.from}–${def.overnight.to} flat ₹${def.overnight.flat}` : null,
    def.dailyCap != null ? `max ₹${def.dailyCap}/day` : null,
    def.graceMinutes > 0 ? `first ${def.graceMinutes} min free` : null,
  ].filter(Boolean).join(' · ');
}
