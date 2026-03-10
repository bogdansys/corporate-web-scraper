import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../../src/shared/normalizers/url.js';

describe('normalizeUrl', () => {
  // Test cases from API-input-sample.csv
  const validCases: [string, string][] = [
    ['https://https//acornlawpc.com/', 'acornlawpc.com'],
    ['http://sbstransportllc.com/index.html?lang=en', 'sbstransportllc.com'],
    ['https://safetychain.com/about-us', 'safetychain.com'],
    ['https://www.blueridgechair.com', 'blueridgechair.com'],
    ['awlsnap.com', 'awlsnap.com'],
    ['steppir.com', 'steppir.com'],
    ['trueaudio.com', 'trueaudio.com'],
    ['innsc.com', 'innsc.com'],
    ['elevator.io', 'elevator.io'],
    ['nyexecstaffing.com', 'nyexecstaffing.com'],
    ['puppet.io', 'puppet.io'],
    ['viru.com', 'viru.com'],
    ['wworks.net', 'wworks.net'],
    ['awbrueggemann.com', 'awbrueggemann.com'],
    ['cedarwork.org', 'cedarwork.org'],
    ['http://dreamservicesoftware.com', 'dreamservicesoftware.com'],
  ];

  it.each(validCases)('should normalize "%s" → "%s"', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  // Blacklisted domains
  const blacklisted: string[] = [
    'https://www.google.com/',
    'google.com',
    'www.google.com',
    'facebook.com',
    'https://www.google.com',
  ];

  it.each(blacklisted)('should return null for blacklisted domain "%s"', (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });

  // Invalid cases
  it('should return null for empty string', () => {
    expect(normalizeUrl('')).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(normalizeUrl(undefined)).toBeNull();
  });

  it('should return null for null', () => {
    expect(normalizeUrl(null)).toBeNull();
  });

  it('should return null for whitespace', () => {
    expect(normalizeUrl('   ')).toBeNull();
  });

  it('should return null for garbage like "abc"', () => {
    expect(normalizeUrl('abc')).toBeNull();
  });
});
