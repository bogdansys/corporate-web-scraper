import type { CheerioAPI } from 'cheerio';
import type { ExtractedDataPoint } from '../../shared/types.js';

const SOCIAL_DOMAINS: Record<string, string> = {
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'twitter.com': 'twitter',
  'www.twitter.com': 'twitter',
  'x.com': 'twitter',
  'www.x.com': 'twitter',
  'linkedin.com': 'linkedin',
  'www.linkedin.com': 'linkedin',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'pinterest.com': 'pinterest',
  'www.pinterest.com': 'pinterest',
  'github.com': 'github',
  'www.github.com': 'github',
  'yelp.com': 'yelp',
  'www.yelp.com': 'yelp',
  'threads.net': 'threads',
  'www.threads.net': 'threads',
};

/**
 * Given a URL string, return the social platform name if it matches a known
 * social domain. Returns null otherwise. Exported for reuse (e.g. JSON-LD sameAs merging).
 */
export function getSocialPlatform(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    return SOCIAL_DOMAINS[url.hostname.toLowerCase()] || null;
  } catch {
    return null;
  }
}

/**
 * Extract social media links from HTML.
 * Strategies: (1) footer anchor tags (highest value), (2) all anchor tags, (3) meta og: tags.
 */
export function extractSocialLinks(
  _html: string,
  $: CheerioAPI,
  sourceUrl: string,
): Record<string, ExtractedDataPoint> {
  const socials: Record<string, ExtractedDataPoint> = {};
  const now = new Date().toISOString();

  // Strategy 1: Footer-targeted social links (highest confidence — footer icons are almost always real)
  const footerSelectors = ['footer', '[role="contentinfo"]', '#footer', '.footer', '.site-footer'];
  for (const sel of footerSelectors) {
    const footerEl = $(sel).first();
    if (footerEl.length > 0) {
      footerEl.find('a[href]').each((_i, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const platform = getSocialPlatform(href);
        if (platform && !socials[platform]) {
          const pathname = new URL(href).pathname.replace(/\/+$/, '');
          if (platform === 'facebook' && (!pathname || pathname === '/')) return;
          socials[platform] = {
            value: href,
            source_url: sourceUrl,
            source_element: `${sel} a[href]`,
            extraction_method: 'footer_anchor',
            confidence: 0.95,
            extracted_at: now,
          };
        }
      });
      break; // Use the first matching footer
    }
  }

  // Strategy 2: All <a> tags with hrefs pointing to social domains
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const platform = getSocialPlatform(href);
    if (platform && !socials[platform]) {
      try {
        const pathname = new URL(href).pathname.replace(/\/+$/, '');
        if (platform === 'facebook' && (!pathname || pathname === '/')) return;
      } catch {
        return;
      }

      socials[platform] = {
        value: href,
        source_url: sourceUrl,
        source_element: `a[href="${href}"]`,
        extraction_method: 'anchor_tag',
        confidence: 0.90,
        extracted_at: now,
      };
    }
  });

  // Strategy 3: Check meta og: tags
  $('meta[property^="og:"]').each((_i, el) => {
    const property = $(el).attr('property') || '';
    const content = $(el).attr('content') || '';
    if (!content) return;

    const platform = getSocialPlatform(content);
    if (platform && !socials[platform]) {
      socials[platform] = {
        value: content,
        source_url: sourceUrl,
        source_element: `meta[property="${property}"]`,
        extraction_method: 'meta_og',
        confidence: 0.85,
        extracted_at: now,
      };
    }
  });

  return socials;
}
