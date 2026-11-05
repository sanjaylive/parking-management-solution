/**
 * Country-configurable number-plate normalization.
 * Normalized form: uppercase alphanumerics only. Validation is advisory for ANPR (low-confidence /
 * invalid-format reads go to manual review) and enforced for manual entry unless `allowNonStandard`.
 */
export interface PlateRule {
  country: string;
  patterns: { name: string; re: RegExp }[];
  /** Common OCR confusions to try when a read fails validation, applied position-aware by pattern. */
  ocrSubstitutions?: Record<string, string>;
}

const IN: PlateRule = {
  country: 'IN',
  patterns: [
    { name: 'STANDARD', re: /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/ },
    { name: 'BHARAT', re: /^\d{2}BH\d{4}[A-Z]{1,2}$/ },
    { name: 'DIPLOMATIC', re: /^\d{1,3}(CD|CC|UN)\d{1,4}$/ },
    { name: 'TEMPORARY', re: /^T\d{4}[A-Z]{2}\d{4}[A-Z]{1,2}$/ },
  ],
  ocrSubstitutions: { O: '0', I: '1', Z: '2', S: '5', B: '8' },
};

const GENERIC: PlateRule = { country: '*', patterns: [{ name: 'GENERIC', re: /^[A-Z0-9]{2,12}$/ }] };

const registry = new Map<string, PlateRule>([['IN', IN]]);

export function registerPlateRule(rule: PlateRule) {
  registry.set(rule.country, rule);
}

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface PlateCheck {
  normalized: string;
  valid: boolean;
  format?: string;
}

export function checkPlate(raw: string, country = 'IN'): PlateCheck {
  const normalized = normalizePlate(raw);
  const rule = registry.get(country) ?? GENERIC;
  const hit = rule.patterns.find((p) => p.re.test(normalized));
  return { normalized, valid: !!hit, format: hit?.name };
}

/** Pretty display: "MH12AB1234" -> "MH 12 AB 1234" for Indian standard plates. */
export function displayPlate(normalized: string, country = 'IN'): string {
  if (country === 'IN') {
    const m = normalized.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
    if (m) return [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ');
  }
  return normalized;
}
