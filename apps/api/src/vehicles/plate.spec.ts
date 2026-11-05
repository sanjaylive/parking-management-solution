import { checkPlate, displayPlate, normalizePlate } from './plate';

describe('plates', () => {
  it('normalizes', () => {
    expect(normalizePlate(' mh-12 ab 1234 ')).toBe('MH12AB1234');
  });
  it.each([
    ['MH12AB1234', 'STANDARD'],
    ['DL3CAF0001', 'STANDARD'],
    ['KA01A1', 'STANDARD'],
    ['22BH1234AB', 'BHARAT'],
  ])('accepts %s', (p, f) => {
    expect(checkPlate(p)).toMatchObject({ valid: true, format: f });
  });
  it.each(['XYZ', '1234MH', 'MH12AB12345'])('rejects %s', (p) => expect(checkPlate(p).valid).toBe(false));
  it('uses generic rule for unknown countries', () => expect(checkPlate('ABC123', 'ZZ').valid).toBe(true));
  it('displays', () => expect(displayPlate('MH12AB1234')).toBe('MH 12 AB 1234'));
});
