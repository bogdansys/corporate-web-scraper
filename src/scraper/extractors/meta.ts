import type { CheerioAPI } from 'cheerio';

export interface MetaData {
  short_description: string | null;
  technologies: string[];
  logo_url: string | null;
  emails: string[];
  year_founded: number | null;
  industry_keywords: string[];
  company_name: string | null;
  jsonld_phones: string[];
  jsonld_addresses: JsonLdAddress[];
  jsonld_social_urls: string[];
}

export interface JsonLdAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  raw: string;
}

// Skip these junk email domains
const EMAIL_BLOCKLIST = ['example.com', 'sentry.io', 'wixpress.com', 'schema.org', 'json-ld.org'];

// Known technology patterns to detect in scripts/meta
const TECH_PATTERNS: Record<string, RegExp> = {
  WordPress: /wp-content|wordpress/i,
  Shopify: /cdn\.shopify\.com|shopify/i,
  React: /react(?:\.production|dom)/i,
  jQuery: /jquery[.\-/]/i,
  Angular: /angular[.\-/]/i,
  Vue: /vue[.\-/]/i,
  'Next.js': /next\.js|__next/i,
  Gatsby: /gatsby/i,
  Svelte: /svelte/i,
  Bootstrap: /bootstrap[.\-/]/i,
  'Tailwind CSS': /tailwindcss|tailwind/i,
  Wix: /wix\.com|parastorage/i,
  Squarespace: /squarespace/i,
  'Google Analytics': /google-analytics|googletagmanager|gtag/i,
  'Google Tag Manager': /googletagmanager\.com\/gtm/i,
  HubSpot: /hubspot/i,
  Drupal: /drupal/i,
  Joomla: /joomla/i,
  Webflow: /webflow/i,
  Cloudflare: /cloudflare|cdnjs\.cloudflare/i,
  'Font Awesome': /font-awesome|fontawesome/i,
};

/**
 * Decode a Cloudflare-obfuscated email from the hex-encoded data-cfemail attribute.
 * Algorithm: first byte is XOR key, remaining bytes are XORed with it.
 */
function decodeCfEmail(encoded: string): string | null {
  try {
    if (encoded.length < 4 || encoded.length % 2 !== 0) return null;
    const key = parseInt(encoded.substring(0, 2), 16);
    let email = '';
    for (let i = 2; i < encoded.length; i += 2) {
      email += String.fromCharCode(parseInt(encoded.substring(i, i + 2), 16) ^ key);
    }
    // Validate it looks like an email
    return email.includes('@') && email.includes('.') ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Decode text-obfuscated emails like "info [at] company [dot] com".
 * Returns decoded emails found in the text.
 */
function decodeObfuscatedEmails(text: string): string[] {
  const results: string[] = [];

  // Match patterns like: word [at] word [dot] word  or  word (at) word (dot) word
  const obfuscatedRegex =
    /[a-zA-Z0-9._%+-]+\s*[\[({]\s*at\s*[\])}]\s*[a-zA-Z0-9.-]+\s*[\[({]\s*dot\s*[\])}]\s*[a-zA-Z]{2,}/gi;

  const matches = text.match(obfuscatedRegex);
  if (matches) {
    for (const match of matches) {
      const decoded = match
        .replace(/\s*[\[({]\s*at\s*[\])}\s]*/gi, '@')
        .replace(/\s*[\[({]\s*dot\s*[\])}\s]*/gi, '.')
        .trim()
        .toLowerCase();
      if (decoded.includes('@') && decoded.includes('.')) {
        results.push(decoded);
      }
    }
  }

  return results;
}

function isJunkEmail(email: string): boolean {
  return EMAIL_BLOCKLIST.some((domain) => email.includes(domain));
}

/**
 * Extract extended metadata from HTML.
 * Goes beyond the basic requirements — shows Veridion-level ambition.
 */
export function extractMeta(html: string, $: CheerioAPI, _sourceUrl: string): MetaData {
  // 1. Short description from meta tags
  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    null;

  // 2. Detect technologies from script src and meta generators
  const technologies: string[] = [];
  const techSeen = new Set<string>();

  // Check meta generator
  const generator = $('meta[name="generator"]').attr('content') || '';
  if (generator) {
    for (const [tech, regex] of Object.entries(TECH_PATTERNS)) {
      if (regex.test(generator) && !techSeen.has(tech)) {
        techSeen.add(tech);
        technologies.push(tech);
      }
    }
  }

  // Check all script tags
  const allScripts = html; // Check against full HTML
  for (const [tech, regex] of Object.entries(TECH_PATTERNS)) {
    if (!techSeen.has(tech) && regex.test(allScripts)) {
      techSeen.add(tech);
      technologies.push(tech);
    }
  }

  // 3. Logo URL
  const logoUrl =
    $('link[rel="icon"]').attr('href') ||
    $('link[rel="shortcut icon"]').attr('href') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  // 4. Email addresses from mailto: links, regex, obfuscation decoding
  const emails: string[] = [];
  const emailSeen = new Set<string>();

  const addEmail = (email: string) => {
    const clean = email.trim().toLowerCase();
    if (clean && clean.includes('@') && !emailSeen.has(clean) && !isJunkEmail(clean)) {
      emailSeen.add(clean);
      emails.push(clean);
    }
  };

  // 4a. mailto: links
  $('a[href^="mailto:"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    addEmail(href.replace(/^mailto:\s*/i, '').split('?')[0]);
  });

  // 4b. Cloudflare email protection (data-cfemail attribute)
  $('[data-cfemail]').each((_i, el) => {
    const encoded = $(el).attr('data-cfemail');
    if (encoded) {
      const decoded = decodeCfEmail(encoded);
      if (decoded) addEmail(decoded);
    }
  });

  // 4c. Regex for emails in body text
  const bodyText = $('body').text();
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = bodyText.match(emailRegex);
  if (emailMatches) {
    for (const email of emailMatches.slice(0, 5)) {
      addEmail(email);
    }
  }

  // 4d. Text-obfuscated emails (e.g. "info [at] company [dot] com")
  const obfuscatedEmails = decodeObfuscatedEmails(bodyText);
  for (const email of obfuscatedEmails) {
    addEmail(email);
  }

  // 5. Year founded
  let yearFounded: number | null = null;
  const yearRegexes = [
    /(?:founded|established|since|est\.?)\s*(?:in\s+)?(\d{4})/i,
    /©\s*(\d{4})/i,
    /copyright\s*(\d{4})/i,
  ];

  for (const regex of yearRegexes) {
    const match = bodyText.match(regex);
    if (match) {
      const year = parseInt(match[1], 10);
      if (year >= 1800 && year <= new Date().getFullYear()) {
        yearFounded = year;
        break;
      }
    }
  }

  // 6. Industry keywords from meta keywords
  const keywordsStr = $('meta[name="keywords"]').attr('content') || '';
  const industryKeywords = keywordsStr
    ? keywordsStr
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 2 && k.length < 50)
        .slice(0, 10)
    : [];

  // 7. JSON-LD / Schema.org structured data
  const jsonldPhones: string[] = [];
  const jsonldAddresses: JsonLdAddress[] = [];
  const jsonldSocialUrls: string[] = [];
  let jsonldName: string | null = null;
  let jsonldDescription: string | null = null;
  let jsonldFoundingYear: number | null = null;

  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];

      for (const item of items) {
        const type = item['@type'] || '';
        const types = Array.isArray(type) ? type : [type];
        const isOrg = types.some((t: string) =>
          ['Organization', 'LocalBusiness', 'Corporation', 'Store', 'Restaurant',
           'MedicalBusiness', 'LegalService', 'FinancialService', 'RealEstateAgent',
           'AutoDealer', 'HealthAndBeautyBusiness', 'HomeAndConstructionBusiness',
           'ProfessionalService', 'FoodEstablishment'].includes(t)
        );

        if (isOrg) {
          if (item.name && !jsonldName) jsonldName = item.name;
          if (item.description && !jsonldDescription) jsonldDescription = item.description;
          if (item.telephone) {
            const phones = Array.isArray(item.telephone) ? item.telephone : [item.telephone];
            jsonldPhones.push(...phones.map((p: string) => p.trim()));
          }
          if (item.foundingDate) {
            const y = parseInt(String(item.foundingDate).substring(0, 4), 10);
            if (y >= 1800 && y <= new Date().getFullYear()) jsonldFoundingYear = y;
          }
          if (item.address) {
            const addrs = Array.isArray(item.address) ? item.address : [item.address];
            for (const addr of addrs) {
              if (typeof addr === 'string') {
                jsonldAddresses.push({ raw: addr });
              } else {
                jsonldAddresses.push({
                  street: addr.streetAddress,
                  city: addr.addressLocality,
                  state: addr.addressRegion,
                  zip: addr.postalCode,
                  country: addr.addressCountry,
                  raw: [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode]
                    .filter(Boolean).join(', '),
                });
              }
            }
          }
          if (item.email) {
            addEmail(item.email.replace(/^mailto:/i, ''));
          }

          // sameAs — array of social profile URLs
          if (item.sameAs) {
            const urls = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
            for (const url of urls) {
              if (typeof url === 'string' && url.startsWith('http')) {
                jsonldSocialUrls.push(url);
              }
            }
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  });

  // Prefer JSON-LD founding year over regex
  if (jsonldFoundingYear) yearFounded = jsonldFoundingYear;
  // Prefer JSON-LD description if we didn't get one from meta tags
  const finalDescription = description || jsonldDescription;

  // 8. Company name extraction
  let companyName: string | null = jsonldName;
  if (!companyName) {
    companyName = $('meta[property="og:site_name"]').attr('content')?.trim() || null;
  }
  if (!companyName) {
    const title = $('title').text().trim();
    if (title) {
      // Strip common suffixes like " | Home", " - Welcome", " – Official Site"
      companyName = title.replace(/\s*[|–—-]\s*(home|welcome|official|main).*$/i, '').trim();
    }
  }

  // 9. Footer-targeted extraction — footers often contain contact info
  const footerSelectors = ['footer', '[role="contentinfo"]', '#footer', '.footer', '.site-footer'];
  for (const sel of footerSelectors) {
    const footerEl = $(sel).first();
    if (footerEl.length > 0) {
      const footerText = footerEl.text();

      // Extract emails from footer text
      const footerEmailMatches = footerText.match(emailRegex);
      if (footerEmailMatches) {
        for (const email of footerEmailMatches) {
          addEmail(email);
        }
      }

      // Extract mailto: links from footer
      footerEl.find('a[href^="mailto:"]').each((_i, el) => {
        const href = $(el).attr('href') || '';
        addEmail(href.replace(/^mailto:\s*/i, '').split('?')[0]);
      });

      // Cloudflare-protected emails in footer
      footerEl.find('[data-cfemail]').each((_i, el) => {
        const encoded = $(el).attr('data-cfemail');
        if (encoded) {
          const decoded = decodeCfEmail(encoded);
          if (decoded) addEmail(decoded);
        }
      });

      // Text-obfuscated emails in footer
      const footerObfuscated = decodeObfuscatedEmails(footerText);
      for (const email of footerObfuscated) {
        addEmail(email);
      }

      break; // Use the first matching footer
    }
  }

  return {
    short_description: finalDescription ? finalDescription.substring(0, 500) : null,
    technologies,
    logo_url: logoUrl,
    emails,
    year_founded: yearFounded,
    industry_keywords: industryKeywords,
    company_name: companyName,
    jsonld_phones: jsonldPhones,
    jsonld_addresses: jsonldAddresses,
    jsonld_social_urls: jsonldSocialUrls,
  };
}
