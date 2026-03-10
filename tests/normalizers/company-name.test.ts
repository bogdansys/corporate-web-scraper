import { describe, it, expect } from 'vitest';
import { normalizeCompanyName } from '../../src/shared/normalizers/company-name.js';

describe('normalizeCompanyName', () => {
  // All test cases from API-input-sample.csv and IMPLEMENTATION-GUIDE
  const validCases: [string, string][] = [
    ['SafetyChain Software Services Pty. Ltd.', 'safetychain software services'],
    ['SBS*', 'sbs'],
    ['&AWL', 'awl'],
    ['Hueboost Services //', 'hueboost services'],
    ['Inc. Mercury', 'mercury'],
    ['Forge Marketing & Management Pty.', 'forge marketing management'],
    ['Cadott Family Restaurant Limited', 'cadott family restaurant'],

    ['Blue Ridge Chair - Limited', 'blue ridge chair'],
    ['A W Brueggemann Co.', 'a w brueggemann'],
    ['Cedar Work Inc.', 'cedar work'],
    ['JETT Business Technology LTD', 'jett business technology'],
    ['Total Seal Inc.', 'total seal'],
    ['True Audio Services', 'true audio services'],
    ['RyanLBatesDDS', 'ryanlbatesdds'],
    ['Acorn Law P.C.', 'acorn law p.c'],
    ['Advance Net Support', 'advance net support'],
    ['Aroostook', 'aroostook'],
    ['Denham\'s Florist Inc', 'denham\'s florist'],
    ['Garrett-Wietholter-State-Farm-Agent', 'garrett-wietholter-state-farm-agent'],
    ['GSS', 'gss'],
    ['American Inns of Court Company', 'american inns of court'],
    ['NY AL Elevator', 'ny al elevator'],
    ['NY Staffing LLC.', 'ny staffing'],
    ['Puppet Heap USA', 'puppet heap usa'],
    ['SteppIR Tree Services', 'steppir tree services'],
    ['Templo Ebenezer Weslaco Holding', 'templo ebenezer weslaco'],
    ['The Greenwich Cincinnati', 'the greenwich cincinnati'],
    ['ViruStar LLC.', 'virustar'],
  ];

  it.each(validCases)('should normalize "%s" → "%s"', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  // Garbage inputs → null
  it('should return null for "Inc." (empty after stripping)', () => {
    expect(normalizeCompanyName('Inc.')).toBeNull();
  });

  it('should return null for ".." (garbage)', () => {
    expect(normalizeCompanyName('..')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(normalizeCompanyName('')).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(normalizeCompanyName(undefined)).toBeNull();
  });

  it('should return null for null', () => {
    expect(normalizeCompanyName(null)).toBeNull();
  });

  it('should return null for whitespace-only', () => {
    expect(normalizeCompanyName('   ')).toBeNull();
  });
});
