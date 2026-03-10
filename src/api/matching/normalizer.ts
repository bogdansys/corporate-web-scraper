import { normalizePhone, normalizeUrl, normalizeFacebook, normalizeCompanyName } from '../../shared/normalizers/index.js';
import type { MatchInput, NormalizedInput } from '../../shared/types.js';

/**
 * Normalize all API input fields before matching.
 * Flags which fields are usable (non-null after normalization).
 */
export function normalizeMatchInput(input: MatchInput): NormalizedInput {
  const name = normalizeCompanyName(input.name);
  const domain = normalizeUrl(input.website);
  const phone = normalizePhone(input.phone_number);
  const facebook_id = normalizeFacebook(input.facebook_profile);

  const usable_fields: string[] = [];
  if (domain) usable_fields.push('website');
  if (phone) usable_fields.push('phone');
  if (facebook_id) usable_fields.push('facebook');
  if (name) usable_fields.push('name');

  return { name, domain, phone, facebook_id, usable_fields };
}
