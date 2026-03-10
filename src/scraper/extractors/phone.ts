import type { CheerioAPI } from 'cheerio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { ExtractedDataPoint } from '../../shared/types.js';

/**
 * Extract phone numbers from HTML.
 * Strategy: (1) tel: links (highest confidence), (2) regex on text content.
 */
export function extractPhones(_html: string, $: CheerioAPI, sourceUrl: string): ExtractedDataPoint[] {
  const phones: ExtractedDataPoint[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  // Strategy 1: tel: links (highest confidence)
  $('a[href^="tel:"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const raw = href.replace(/^tel:\s*/i, '').trim();
    if (!raw) return;

    const parsed = parsePhoneNumberFromString(raw, 'US');
    if (parsed && parsed.isValid()) {
      const e164 = parsed.format('E.164');
      if (!seen.has(e164)) {
        seen.add(e164);
        phones.push({
          value: e164,
          source_url: sourceUrl,
          source_element: `a[href="tel:${raw}"]`,
          extraction_method: 'tel_link',
          confidence: 0.95,
          extracted_at: now,
        });
      }
    }
  });

  // Strategy 2: Regex on text content (prioritize footer)
  // Match common US phone formats
  const phoneRegexes = [
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    /\+1\d{10}/g,
  ];

  // Check footer first — contact info is almost always there
  const footerSelectors = ['footer', '[role="contentinfo"]', '#footer', '.footer', '.site-footer'];
  for (const sel of footerSelectors) {
    const footerEl = $(sel).first();
    if (footerEl.length > 0) {
      // tel: links in footer
      footerEl.find('a[href^="tel:"]').each((_i, el) => {
        const href = $(el).attr('href') || '';
        const raw = href.replace(/^tel:\s*/i, '').trim();
        if (!raw) return;
        const parsed = parsePhoneNumberFromString(raw, 'US');
        if (parsed && parsed.isValid()) {
          const e164 = parsed.format('E.164');
          if (!seen.has(e164)) {
            seen.add(e164);
            phones.push({
              value: e164,
              source_url: sourceUrl,
              source_element: `${sel} a[href="tel:${raw}"]`,
              extraction_method: 'footer_tel_link',
              confidence: 0.97,
              extracted_at: now,
            });
          }
        }
      });

      // Regex on footer text
      const footerText = footerEl.text();
      for (const regex of phoneRegexes) {
        const matches = footerText.match(regex);
        if (!matches) continue;
        for (const match of matches) {
          const raw = match.trim();
          let parsed = parsePhoneNumberFromString(raw, 'US');
          if (!parsed || !parsed.isValid()) {
            const digits = raw.replace(/[^\d+]/g, '');
            parsed = parsePhoneNumberFromString(digits, 'US');
            if (!parsed || !parsed.isValid()) {
              if (digits.length === 10) parsed = parsePhoneNumberFromString('+1' + digits);
            }
          }
          if (parsed && parsed.isValid()) {
            const e164 = parsed.format('E.164');
            if (!seen.has(e164)) {
              seen.add(e164);
              phones.push({
                value: e164,
                source_url: sourceUrl,
                source_element: `${sel}_text`,
                extraction_method: 'footer_regex',
                confidence: 0.88,
                extracted_at: now,
              });
            }
          }
        }
      }
      break; // Use the first matching footer
    }
  }

  const textContent = $('body').text();
  for (const regex of phoneRegexes) {
    const matches = textContent.match(regex);
    if (!matches) continue;

    for (const match of matches) {
      const raw = match.trim();
      // Try to parse with libphonenumber
      let parsed = parsePhoneNumberFromString(raw, 'US');
      if (!parsed || !parsed.isValid()) {
        // Try cleaning up
        const digits = raw.replace(/[^\d+]/g, '');
        parsed = parsePhoneNumberFromString(digits, 'US');
        if (!parsed || !parsed.isValid()) {
          // Try with +1 prefix for 10-digit
          if (digits.length === 10) {
            parsed = parsePhoneNumberFromString('+1' + digits);
          }
        }
      }

      if (parsed && parsed.isValid()) {
        const e164 = parsed.format('E.164');
        if (!seen.has(e164)) {
          seen.add(e164);
          phones.push({
            value: e164,
            source_url: sourceUrl,
            source_element: 'body_text',
            extraction_method: 'regex',
            confidence: 0.80,
            extracted_at: now,
          });
        }
      }
    }
  }

  return phones;
}
