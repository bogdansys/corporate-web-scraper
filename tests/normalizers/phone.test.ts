import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../src/shared/normalizers/phone.js';

describe('normalizePhone', () => {
  // All test cases from API-input-sample.csv
  const validCases: [string, string][] = [
    ['(786) 426-3492', '+17864263492'],
    ['207.762.9321', '+12077629321'],
    ['(509) 276-6996', '+15092766996'],
    ['715.978.0027', '+17159780027'],
    ['(706) 685.0182', '+17066850182'],
    ['(317) 873-3230', '+13178733230'],
    ['(+877) 449-5079', '+18774495079'],
    ['+1703-684-3590', '+17036843590'],
    ['(678) 387-5715', '+16783875715'],
    ['(956) 968-8142', '+19569688142'],
    ['+1513-221-1151', '+15132211151'],
    ['865-494-3388', '+18654943388'],
  ];

  it.each(validCases)('should normalize "%s" → "%s"', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  // Invalid / edge cases
  it('should return null for empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('should return null for null', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('should return null for non-phone text', () => {
    expect(normalizePhone('not a phone')).toBeNull();
  });

  it('should return null for too-short numbers', () => {
    expect(normalizePhone('123')).toBeNull();
  });

  it('should handle whitespace-only input', () => {
    expect(normalizePhone('   ')).toBeNull();
  });
});
