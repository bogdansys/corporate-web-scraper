/**
 * Blacklisted domains — these are noise in the test data.
 * If someone puts "google.com" as their website, it's not useful.
 */
const BLACKLISTED_DOMAINS = new Set([
  'google.com',
  'www.google.com',
  'bing.com',
  'www.bing.com',
  'facebook.com',
  'www.facebook.com',
  'youtube.com',
  'www.youtube.com',
  'twitter.com',
  'www.twitter.com',
  'instagram.com',
  'www.instagram.com',
]);

/**
 * Normalize a raw URL/domain string to a clean bare domain.
 * Returns null if input is empty, blacklisted, or invalid.
 *
 * Handles:
 * - Double protocols: "https://https//acornlawpc.com/" → "acornlawpc.com"
 * - Paths/params: "http://sbstransportllc.com/index.html?lang=en" → "sbstransportllc.com"
 * - www prefix: "https://www.blueridgechair.com" → "blueridgechair.com"
 * - Blacklisted: "google.com" → null
 */
export function normalizeUrl(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Strip multiple protocols (handle "https://https//", "http://http://", etc.)
  // Keep stripping protocol prefixes until none remain
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/^https?:\/\//i, '');
  }
  // Also strip any remaining "https//" or "http//" fragments
  cleaned = cleaned.replace(/^https?\/\//i, '');

  // Strip www.
  cleaned = cleaned.replace(/^www\./i, '');

  // Take only the hostname (strip paths, query params, fragments)
  // Split on first / and take everything before it
  const slashIdx = cleaned.indexOf('/');
  if (slashIdx !== -1) {
    cleaned = cleaned.substring(0, slashIdx);
  }

  // Strip query params (shouldn't be here after path strip, but just in case)
  const qIdx = cleaned.indexOf('?');
  if (qIdx !== -1) {
    cleaned = cleaned.substring(0, qIdx);
  }

  // Strip fragments
  const hashIdx = cleaned.indexOf('#');
  if (hashIdx !== -1) {
    cleaned = cleaned.substring(0, hashIdx);
  }

  // Lowercase
  cleaned = cleaned.toLowerCase();

  // Strip trailing dots
  cleaned = cleaned.replace(/\.+$/, '');

  // Validate: must have at least one dot and be > 3 chars
  if (!cleaned || cleaned.length < 4 || !cleaned.includes('.')) {
    return null;
  }

  // Check blacklist
  if (BLACKLISTED_DOMAINS.has(cleaned)) {
    return null;
  }

  return cleaned;
}
