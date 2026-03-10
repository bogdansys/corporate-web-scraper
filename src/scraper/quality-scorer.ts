import type { ScrapeResult } from '../shared/types.js';
import { config } from '../shared/config.js';

export interface QualityScore {
  score: number;
  needsTier3: boolean;
  reasons: string[];
}

const PLACEHOLDER_EMAILS = new Set([
  'your@email.com',
  'email@domain.com',
  'info@example.com',
  'name@company.com',
  'user@example.com',
  'test@test.com',
  'email@example.com',
  'yourname@email.com',
]);

const JUNK_EMAIL_DOMAINS = new Set([
  'sentry.io',
  'keen.io',
  'wixpress.com',
  'schema.org',
  'json-ld.org',
  'example.com',
  'gravatar.com',
  'wordpress.org',
  'w3.org',
  'googleapis.com',
  'googletagmanager.com',
]);

const SPAM_KEYWORDS = /casino|gambling|betting|slot\s?gacor|poker|happybet|togel|judi|sbobet/i;

/**
 * Score a ScrapeResult for data quality (0-100).
 * Lower scores indicate more data quality problems.
 */
export function scoreResult(result: ScrapeResult): QualityScore {
  let score = 100;
  const reasons: string[] = [];

  // ── Missing data ──
  if (!result.company_name) {
    score -= 15;
    reasons.push('missing_company_name');
  }
  if (result.emails.length === 0) {
    score -= 10;
    reasons.push('no_emails');
  }
  if (result.phone_numbers.length === 0) {
    score -= 10;
    reasons.push('no_phones');
  }
  if (result.addresses.length === 0) {
    score -= 10;
    reasons.push('no_addresses');
  }
  if (!result.short_description) {
    score -= 5;
    reasons.push('no_description');
  }

  // ── Garbage email detection ──
  for (const email of result.emails) {
    const val = email.value.toLowerCase();

    // Placeholder emails
    if (PLACEHOLDER_EMAILS.has(val)) {
      score -= 20;
      reasons.push(`placeholder_email:${val}`);
    }

    // Junk analytics/service domains
    const emailDomain = val.split('@')[1];
    if (emailDomain && JUNK_EMAIL_DOMAINS.has(emailDomain)) {
      score -= 15;
      reasons.push(`junk_email_domain:${emailDomain}`);
    }

    // Garbled concatenation: local part has 7+ consecutive digits (phone + email mashup)
    const localPart = val.split('@')[0];
    if (localPart && /\d{7,}/.test(localPart)) {
      score -= 20;
      reasons.push(`garbled_email:${val.slice(0, 50)}`);
    }

    // URL-encoded email not decoded
    if (val.includes('%')) {
      score -= 10;
      reasons.push(`urlencoded_email:${val.slice(0, 50)}`);
    }
  }

  // ── year_founded sanity ──
  const currentYear = new Date().getFullYear();
  if (result.year_founded !== null && result.year_founded >= currentYear) {
    score -= 15;
    reasons.push(`future_year_founded:${result.year_founded}`);
  }

  // ── Company name issues ──
  if (result.company_name) {
    if (/^https?:\/\//.test(result.company_name)) {
      score -= 15;
      reasons.push('company_name_is_url');
    }
    if (result.company_name.length > 80) {
      score -= 10;
      reasons.push('company_name_too_long');
    }
  }

  // ── Address quality ──
  for (const addr of result.addresses) {
    if (addr.value.length > 150) {
      score -= 10;
      reasons.push('address_too_long');
    }
    if (/contact\s*us|click|call\s*us|email\s*us/i.test(addr.value)) {
      score -= 15;
      reasons.push(`garbage_address:${addr.value.slice(0, 50)}`);
    }
  }

  // ── Relative logo URL ──
  if (result.logo_url && !result.logo_url.startsWith('http') && !result.logo_url.startsWith('data:')) {
    score -= 5;
    reasons.push('relative_logo_url');
  }

  // ── Empty success: pages crawled but nothing extracted ──
  if (
    result.success &&
    result.pages_crawled.length > 0 &&
    result.emails.length === 0 &&
    result.phone_numbers.length === 0 &&
    result.addresses.length === 0 &&
    !result.company_name
  ) {
    score -= 30;
    reasons.push('empty_success');
  }

  // ── Hijacked / spam domain ──
  if (result.short_description?.value) {
    if (SPAM_KEYWORDS.test(result.short_description.value) && !SPAM_KEYWORDS.test(result.domain)) {
      score -= 30;
      reasons.push('hijacked_spam_domain');
    }
  }

  const finalScore = Math.max(0, score);
  return {
    score: finalScore,
    needsTier3: finalScore < config.gemini.qualityThreshold,
    reasons,
  };
}
