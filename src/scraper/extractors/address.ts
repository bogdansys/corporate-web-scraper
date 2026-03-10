import type { CheerioAPI } from 'cheerio';
import type { ExtractedDataPoint } from '../../shared/types.js';

// US state abbreviations
const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';

// Street type suffixes (used in regex patterns)
const STREET_TYPES =
  'Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy|Suite|Ste';

/**
 * Extract addresses from HTML.
 * Strategies: (1) JSON-LD, (2) <address> tags, (3) footer <address> tags,
 *             (4) US full address regex, (5) US street+city+state (no zip), (6) PO Box.
 */
export function extractAddresses(
  _html: string,
  $: CheerioAPI,
  sourceUrl: string,
): ExtractedDataPoint[] {
  const addresses: ExtractedDataPoint[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  const addAddress = (value: string, element: string, method: string, confidence: number) => {
    const clean = value.trim().replace(/\s+/g, ' ');
    if (clean && clean.length > 5 && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      addresses.push({
        value: clean,
        source_url: sourceUrl,
        source_element: element,
        extraction_method: method,
        confidence,
        extracted_at: now,
      });
    }
  };

  // Strategy 1: JSON-LD structured data
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const json = JSON.parse($(el).text());
      const items = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];

      for (const item of items) {
        const addr = item.address || item.location?.address;
        if (addr) {
          const addrItems = Array.isArray(addr) ? addr : [addr];
          for (const a of addrItems) {
            if (typeof a === 'string') {
              addAddress(a, 'script[type="application/ld+json"]', 'json_ld', 0.95);
            } else {
              const raw = [
                a.streetAddress,
                a.addressLocality,
                a.addressRegion,
                a.postalCode,
                a.addressCountry,
              ]
                .filter(Boolean)
                .join(', ');
              if (raw) {
                addAddress(raw, 'script[type="application/ld+json"]', 'json_ld', 0.95);
              }
            }
          }
        }
      }
    } catch {
      // Invalid JSON — skip
    }
  });

  // Strategy 2: <address> HTML tags
  $('address').each((_i, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text.length > 10 && text.length < 300) {
      addAddress(text, 'address', 'html_address_tag', 0.85);
    }
  });

  // Strategy 3: Footer <address> tags (high-value location for contact info)
  const footerSelectors = ['footer', '[role="contentinfo"]', '#footer', '.footer', '.site-footer'];
  for (const sel of footerSelectors) {
    const footerEl = $(sel).first();
    if (footerEl.length > 0) {
      footerEl.find('address').each((_i, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (text && text.length > 10 && text.length < 300) {
          addAddress(text, `${sel} address`, 'footer_address_tag', 0.90);
        }
      });
      break;
    }
  }

  // Strategy 4: US full address regex — street + city + state + zip (original, highest regex confidence)
  const bodyText = $('body').text();
  const fullAddressRegex = new RegExp(
    `\\d{1,5}\\s+[A-Za-z0-9.\\s]+(?:${STREET_TYPES})\\b[.,]?\\s*[A-Za-z\\s]+,?\\s*(?:${US_STATES})\\b\\s*\\d{5}(?:-\\d{4})?`,
    'gi',
  );

  const fullMatches = bodyText.match(fullAddressRegex);
  if (fullMatches) {
    for (const match of fullMatches.slice(0, 3)) {
      addAddress(match, 'body_text', 'regex_us_full', 0.75);
    }
  }

  // Strategy 5: US street + city + state WITHOUT zip (relaxed — lower confidence)
  const noZipRegex = new RegExp(
    `\\d{1,5}\\s+[A-Za-z0-9.\\s]+(?:${STREET_TYPES})\\b[.,]?\\s*[A-Za-z\\s]{2,30},\\s*(?:${US_STATES})\\b`,
    'gi',
  );

  const noZipMatches = bodyText.match(noZipRegex);
  if (noZipMatches) {
    for (const match of noZipMatches.slice(0, 3)) {
      addAddress(match, 'body_text', 'regex_us_no_zip', 0.60);
    }
  }

  // Strategy 6: PO Box addresses
  const poBoxRegex = new RegExp(
    `P\\.?\\s*O\\.?\\s*Box\\s+\\d+[,.]?\\s*[A-Za-z\\s]+,?\\s*(?:${US_STATES})\\b\\s*(?:\\d{5}(?:-\\d{4})?)?`,
    'gi',
  );

  const poBoxMatches = bodyText.match(poBoxRegex);
  if (poBoxMatches) {
    for (const match of poBoxMatches.slice(0, 2)) {
      addAddress(match, 'body_text', 'regex_po_box', 0.65);
    }
  }

  return addresses;
}
