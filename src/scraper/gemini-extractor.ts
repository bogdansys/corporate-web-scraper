import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../shared/config.js';
import type { ScrapeResult } from '../shared/types.js';

export interface GeminiExtractionResult {
  company_name: string | null;
  emails: string[];
  phone_numbers: string[];
  addresses: string[];
  short_description: string | null;
  year_founded: number | null;
  logo_url: string | null;
  social_links: Record<string, string | null>;
  confidence_notes: string;
}

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return genAI;
}

/**
 * Strip <script> and <style> tags from HTML to reduce tokens and remove JS-embedded junk.
 */
function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
}

/**
 * Build the extraction prompt for Gemini.
 */
function buildPrompt(domain: string, html: string, existing: ScrapeResult): string {
  // Strip scripts/styles first, then truncate
  const cleaned = stripScriptsAndStyles(html);
  const truncated = cleaned.slice(0, 60_000);

  const existingData = {
    company_name: existing.company_name,
    emails: existing.emails.map((e) => e.value),
    phones: existing.phone_numbers.map((p) => p.value),
    addresses: existing.addresses.map((a) => a.value),
    year_founded: existing.year_founded,
    description: existing.short_description?.value || null,
  };

  return `You are a business data extraction specialist. Extract structured business information from this webpage HTML.

DOMAIN: ${domain}

EXISTING DATA (regex-extracted — may contain errors, validate and correct):
${JSON.stringify(existingData, null, 2)}

CRITICAL RULES:
- Emails: Only include real business contact emails for this company. REJECT placeholder emails (your@email.com, info@example.com), emails from third-party analytics services (anything @sentry.io, @keen.io, @wixpress.com, @gravatar.com), and garbled concatenations of phone numbers or text with email addresses. If an email domain does not match the business, verify it appears as a legitimate contact.
- Phone numbers: Only include actual business contact phone numbers. REJECT numbers found inside URLs (like Facebook group IDs), tracking pixels, JavaScript code, or model/part numbers. Return phones in E.164 format (e.g., +15551234567).
- Addresses: Extract clean, properly formatted physical addresses. REJECT addresses that have surrounding UI text concatenated in (like "6333 Contact Us 123 Main St" should just be "123 Main St"). Deduplicate — return each unique address once.
- Year founded: Extract the year the company was FOUNDED, ESTABLISHED, or started. The copyright year in the footer (e.g., "© 2026") is NOT the founding year unless it explicitly says "Founded in" or "Established in". If you can only find a copyright year, return null.
- Company name: Extract the actual business name. REJECT URLs, overly long page titles with navigation separators, or generic text.
- Description: A concise 1-2 sentence description of what this company does or offers.
- Logo URL: Must be an absolute URL starting with http. If only a relative path exists (like /favicon.ico), prepend "https://${domain}".
- Social links: Only extract social media profile URLs that belong to THIS company. REJECT third-party widget links (like a "DexYP" Twitter link on a local business site).

Return this exact JSON structure:
{
  "company_name": "string or null",
  "emails": ["array of valid email strings"],
  "phone_numbers": ["array of E.164 phone strings"],
  "addresses": ["array of clean address strings"],
  "short_description": "string or null",
  "year_founded": "number or null",
  "logo_url": "absolute URL string or null",
  "social_links": {
    "facebook": "URL or null",
    "twitter": "URL or null",
    "linkedin": "URL or null",
    "instagram": "URL or null",
    "youtube": "URL or null"
  },
  "confidence_notes": "brief note about data quality"
}

PAGE CONTENT:
${truncated}`;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

// Circuit breaker: consecutive 429 failures
let consecutive429s = 0;
const CIRCUIT_BREAKER_LIMIT = 3;

/**
 * Extract structured business data from HTML using Gemini Flash.
 * Returns null on failure (API error, invalid JSON, circuit breaker tripped).
 */
export async function extractWithGemini(
  domain: string,
  html: string,
  existingResult: ScrapeResult,
): Promise<GeminiExtractionResult | null> {
  // Circuit breaker check
  if (consecutive429s >= CIRCUIT_BREAKER_LIMIT) {
    return null;
  }

  const client = getClient();
  const model = client.getGenerativeModel({
    model: config.gemini.model,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const prompt = buildPrompt(domain, html, existingResult);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini timeout (30s)')), 30_000),
        ),
      ]);

      const text = result.response.text();

      // Strip markdown fences if present
      const jsonStr = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(jsonStr) as GeminiExtractionResult;

      // Reset circuit breaker on success
      consecutive429s = 0;

      // Basic validation
      return {
        company_name: parsed.company_name ?? null,
        emails: Array.isArray(parsed.emails) ? parsed.emails.filter((e) => typeof e === 'string') : [],
        phone_numbers: Array.isArray(parsed.phone_numbers) ? parsed.phone_numbers.filter((p) => typeof p === 'string') : [],
        addresses: Array.isArray(parsed.addresses) ? parsed.addresses.filter((a) => typeof a === 'string') : [],
        short_description: parsed.short_description ?? null,
        year_founded: typeof parsed.year_founded === 'number' ? parsed.year_founded : null,
        logo_url: typeof parsed.logo_url === 'string' ? parsed.logo_url : null,
        social_links: parsed.social_links && typeof parsed.social_links === 'object' ? parsed.social_links : {},
        confidence_notes: typeof parsed.confidence_notes === 'string' ? parsed.confidence_notes : '',
      };
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const isRetryable = status === 429 || (status !== undefined && status >= 500);

      if (status === 429) {
        consecutive429s++;
        if (consecutive429s >= CIRCUIT_BREAKER_LIMIT) {
          console.warn(`\n⚠ Gemini rate limit circuit breaker tripped after ${CIRCUIT_BREAKER_LIMIT} consecutive 429s. Skipping remaining Tier 3.`);
          return null;
        }
      }

      if (attempt < MAX_RETRIES && isRetryable) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Non-retryable error or exhausted retries
      return null;
    }
  }

  return null;
}

/**
 * Check if Gemini API is configured and ready.
 */
export function isGeminiConfigured(): boolean {
  return config.gemini.apiKey.length > 0;
}
