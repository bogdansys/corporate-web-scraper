import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { normalizePhone, normalizeUrl, normalizeFacebook } from '../shared/normalizers/index.js';
import { logger } from '../shared/logger.js';
import type { CompanyProfile } from '../shared/types.js';

/**
 * Apply all normalizers to merged profiles.
 * - Phones → E.164
 * - Facebook URL → page ID
 * - Names → cleaned for matching
 */
export function normalizeProfiles(profiles: CompanyProfile[]): CompanyProfile[] {
  let phonesNormalized = 0;
  let facebookNormalized = 0;

  for (const profile of profiles) {
    // Store raw phones before normalizing
    profile.phone_numbers_raw = [...profile.phone_numbers];

    // Normalize phone numbers
    const normalizedPhones: string[] = [];
    const seenPhones = new Set<string>();
    for (const phone of profile.phone_numbers) {
      const normalized = normalizePhone(phone);
      if (normalized && !seenPhones.has(normalized)) {
        seenPhones.add(normalized);
        normalizedPhones.push(normalized);
        phonesNormalized++;
      }
    }
    profile.phone_numbers = normalizedPhones;

    // Normalize Facebook URL → ID
    if (profile.facebook_url) {
      const fbId = normalizeFacebook(profile.facebook_url);
      profile.facebook_id = fbId;
      if (fbId) facebookNormalized++;
    }

    // Normalize domain (already clean from CSV, but ensure consistency)
    profile.domain = normalizeUrl(profile.domain) || profile.domain;

    // Deduplicate emails
    profile.emails = [...new Set(profile.emails.map((e) => e.toLowerCase()))];
    profile.primary_email = profile.emails[0] || null;
  }

  logger.info(`Normalized ${profiles.length} profiles: ${phonesNormalized} phones, ${facebookNormalized} Facebook IDs`);

  mkdirSync('output', { recursive: true });
  writeFileSync('output/normalized-profiles.json', JSON.stringify(profiles, null, 2));
  logger.info('Normalized profiles saved to output/normalized-profiles.json');

  return profiles;
}

// Run standalone
if (process.argv[1]?.includes('normalize')) {
  const raw = readFileSync('output/merged-profiles.json', 'utf-8');
  const profiles: CompanyProfile[] = JSON.parse(raw);
  normalizeProfiles(profiles);
}
