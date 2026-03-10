import { describe, it, expect } from 'vitest';
import { normalizeFacebook } from '../../src/shared/normalizers/facebook.js';

describe('normalizeFacebook', () => {
  // All Facebook URLs from API-input-sample.csv
  const validCases: [string, string][] = [
    ['https://www.facebook.com/acornfurnitureworkshops', 'acornfurnitureworkshops'],
    ['https://facebook.com/bluemercury', 'bluemercury'],
    ['https://www.facebook.com/GSSstrings/', 'gssstrings'],
    [
      'https://www.facebook.com/SBS-Transport-LLC-101932885163238',
      'sbs-transport-llc-101932885163238',
    ],
    ['https://www.facebook.com/SteppIR/', 'steppir'],
    ['https://www.facebook.com/totalseal.pistonrings/', 'totalseal.pistonrings'],
    ['https://www.facebook.com/workitstudio/', 'workitstudio'],
    ['https://www.facebook.com/musselrockcloggers/', 'musselrockcloggers'],
    ['https://facebook.com/puppetheap', 'puppetheap'],
  ];

  it.each(validCases)('should normalize "%s" → "%s"', (input, expected) => {
    expect(normalizeFacebook(input)).toBe(expected);
  });

  // Invalid / edge cases
  it('should return null for empty string', () => {
    expect(normalizeFacebook('')).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(normalizeFacebook(undefined)).toBeNull();
  });

  it('should return null for null', () => {
    expect(normalizeFacebook(null)).toBeNull();
  });

  it('should return null for non-facebook URL', () => {
    expect(normalizeFacebook('https://twitter.com/someuser')).toBeNull();
  });

  it('should return null for bare facebook.com with no page', () => {
    expect(normalizeFacebook('https://www.facebook.com/')).toBeNull();
  });

  it('should handle facebook URL with query params', () => {
    const result = normalizeFacebook('https://www.facebook.com/somepage?ref=123');
    expect(result).toBe('somepage');
  });
});
