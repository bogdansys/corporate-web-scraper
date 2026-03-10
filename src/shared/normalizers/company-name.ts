/**
 * Legal suffixes to strip from company names.
 * Order matters — longer patterns first to avoid partial matches.
 */
const LEGAL_SUFFIXES = [
  /\bHoldings?\b/gi,
  /\bLimited\b/gi,
  /\bCompany\b/gi,
  /\bPty\.?\b/gi,
  /\bLtd\.?\b/gi,
  /\bLLC\.?\b/gi,
  /\bInc\.?\b/gi,
  /\bCorp\.?\b/gi,
  /\bCo\.(?=\s*$)/gi, // Only strip "Co." at end to avoid stripping "Co" from middle of words
  /\bLTD\b/gi,
];

/**
 * Normalize a company name for matching.
 * Strips legal suffixes, special characters, and normalizes whitespace.
 * Returns null if the result is empty or < 2 chars (garbage).
 *
 * Handles:
 * - "SafetyChain Software Services Pty. Ltd." → "safetychain software services"
 * - "SBS*" → "sbs"
 * - "&AWL" → "awl"
 * - "Inc." → null (empty after stripping)
 * - ".." → null (garbage)
 * - "Inc. Mercury" → "mercury"
 */
export function normalizeCompanyName(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Strip special characters: &, *, //, ..
  cleaned = cleaned.replace(/&/g, ' ');
  cleaned = cleaned.replace(/\*/g, '');
  cleaned = cleaned.replace(/\/\//g, '');
  cleaned = cleaned.replace(/\.\./g, '');

  // Strip legal suffixes (multiple passes to catch nested ones like "Pty. Ltd.")
  for (const suffix of LEGAL_SUFFIXES) {
    cleaned = cleaned.replace(suffix, ' ');
  }
  // Second pass for cases where stripping revealed new suffixes
  for (const suffix of LEGAL_SUFFIXES) {
    cleaned = cleaned.replace(suffix, ' ');
  }

  // Strip leading/trailing punctuation and dashes (but keep internal ones)
  cleaned = cleaned.replace(/^[\s\-.,;:!?'"]+/, '');
  cleaned = cleaned.replace(/[\s\-.,;:!?'"]+$/, '');

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Lowercase
  cleaned = cleaned.toLowerCase();

  // Final trim of leading/trailing dashes/dots that may remain
  cleaned = cleaned.replace(/^[\-.\s]+/, '').replace(/[\-.\s]+$/, '');

  // If result is empty or < 2 chars → garbage
  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  return cleaned;
}
