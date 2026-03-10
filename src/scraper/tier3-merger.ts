import type { ScrapeResult, ExtractedDataPoint } from '../shared/types.js';
import type { GeminiExtractionResult } from './gemini-extractor.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Create an ExtractedDataPoint for Gemini-extracted data.
 */
function geminiDataPoint(value: string, sourceUrl: string, confidence: number): ExtractedDataPoint {
  return {
    value,
    source_url: sourceUrl,
    source_element: 'gemini_extraction',
    extraction_method: 'gemini_flash',
    confidence,
    extracted_at: new Date().toISOString(),
  };
}

/**
 * Normalize a phone number to E.164 format using libphonenumber-js.
 */
function normalizePhone(phone: string): string | null {
  try {
    // Try parsing as-is first
    let parsed = parsePhoneNumberFromString(phone, 'US');
    if (parsed?.isValid()) return parsed.format('E.164');

    // Try stripping non-digits and re-parsing
    const digits = phone.replace(/[^\d+]/g, '');
    parsed = parsePhoneNumberFromString(digits, 'US');
    if (parsed?.isValid()) return parsed.format('E.164');

    // If it already looks like E.164, keep it
    if (/^\+\d{10,15}$/.test(digits)) return digits;

    return null;
  } catch {
    return null;
  }
}

/**
 * Merge Gemini extraction results back into an existing ScrapeResult.
 *
 * Strategy:
 * - Replace fields where Gemini provides better data
 * - For arrays (emails, phones, addresses): use Gemini's clean output entirely
 * - For social_links: merge new platforms
 * - For scalars: use Gemini's if existing is bad/missing
 */
export function mergeGeminiResult(
  existing: ScrapeResult,
  gemini: GeminiExtractionResult,
  domain: string,
): ScrapeResult {
  const merged = { ...existing };
  const sourceUrl = existing.pages_crawled[0] || `https://${domain}`;

  // ── Company name ──
  if (gemini.company_name) {
    const existingBad =
      !existing.company_name ||
      existing.company_name.length > 80 ||
      /^https?:\/\//.test(existing.company_name);
    if (existingBad) {
      merged.company_name = gemini.company_name;
    }
  }

  // ── Emails: replace entirely with Gemini's clean output ──
  if (gemini.emails.length > 0) {
    merged.emails = gemini.emails.map((email) =>
      geminiDataPoint(email.toLowerCase(), sourceUrl, 0.92),
    );
  }

  // ── Phones: replace with Gemini's, normalize through libphonenumber ──
  if (gemini.phone_numbers.length > 0) {
    const seen = new Set<string>();
    merged.phone_numbers = [];

    for (const phone of gemini.phone_numbers) {
      const normalized = normalizePhone(phone);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        merged.phone_numbers.push(geminiDataPoint(normalized, sourceUrl, 0.92));
      }
    }
  }

  // ── Addresses: replace with Gemini's deduplicated output ──
  if (gemini.addresses.length > 0) {
    merged.addresses = gemini.addresses.map((addr) =>
      geminiDataPoint(addr, sourceUrl, 0.90),
    );
  }

  // ── Year founded ──
  const currentYear = new Date().getFullYear();
  if (gemini.year_founded !== null) {
    // Gemini found a real founding year
    merged.year_founded = gemini.year_founded;
  } else if (existing.year_founded !== null && existing.year_founded >= currentYear) {
    // Gemini returned null and existing is garbage (copyright year) — clear it
    merged.year_founded = null;
  }

  // ── Description ──
  if (gemini.short_description) {
    merged.short_description = geminiDataPoint(gemini.short_description, sourceUrl, 0.90);
  }

  // ── Logo URL: prefer Gemini if it's absolute and existing isn't ──
  if (gemini.logo_url && gemini.logo_url.startsWith('http')) {
    if (!existing.logo_url || !existing.logo_url.startsWith('http')) {
      merged.logo_url = gemini.logo_url;
    }
  }

  // ── Social links: merge new platforms from Gemini ──
  if (gemini.social_links) {
    for (const [platform, url] of Object.entries(gemini.social_links)) {
      if (url && typeof url === 'string' && url.startsWith('http')) {
        if (!merged.social_links[platform]) {
          merged.social_links[platform] = geminiDataPoint(url, sourceUrl, 0.90);
        }
      }
    }
  }

  return merged;
}
