/**
 * Extract the Facebook page identifier from a Facebook URL.
 * Returns the lowercase page name/ID, or null if input is empty/invalid.
 *
 * Handles:
 * - "https://www.facebook.com/acornfurnitureworkshops" → "acornfurnitureworkshops"
 * - "https://facebook.com/bluemercury" → "bluemercury"
 * - "https://www.facebook.com/GSSstrings/" → "gssstrings"
 * - "https://www.facebook.com/SBS-Transport-LLC-101932885163238" → "sbs-transport-llc-101932885163238"
 */
export function normalizeFacebook(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Strip protocol
  cleaned = cleaned.replace(/^https?:\/\//i, '');

  // Strip www.
  cleaned = cleaned.replace(/^www\./i, '');

  // Must start with facebook.com
  if (!cleaned.toLowerCase().startsWith('facebook.com')) {
    return null;
  }

  // Remove "facebook.com/"
  cleaned = cleaned.replace(/^facebook\.com\/?/i, '');

  // Strip trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');

  // Strip query params
  const qIdx = cleaned.indexOf('?');
  if (qIdx !== -1) {
    cleaned = cleaned.substring(0, qIdx);
  }

  // Strip hash fragments
  const hashIdx = cleaned.indexOf('#');
  if (hashIdx !== -1) {
    cleaned = cleaned.substring(0, hashIdx);
  }

  // If there are sub-paths (e.g., /posts, /photos), take only the first segment
  // But keep compound IDs like "SBS-Transport-LLC-101932885163238"
  const parts = cleaned.split('/');
  cleaned = parts[0] || '';

  // Lowercase
  cleaned = cleaned.toLowerCase();

  // Validate: must not be empty or a generic page like "pages"
  if (!cleaned || cleaned === 'pages' || cleaned === 'profile.php' || cleaned.length < 2) {
    return null;
  }

  return cleaned;
}
