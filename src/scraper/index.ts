import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { promises as dns } from 'dns';
import { parse } from 'csv-parse/sync';
import { load } from 'cheerio';
import pLimit from 'p-limit';
import { fetchPage } from './fetcher.js';
import { fetchPageWithBrowser, launchBrowser, closeBrowser } from './browser-fetcher.js';
import { fetchWithPinchTab, launchPinchTabPool, closePinchTabPool } from './pinchtab-fetcher.js';
import { getRobotsRules, isPathAllowed } from './robots.js';
import { extractPhones } from './extractors/phone.js';
import { extractSocialLinks, getSocialPlatform } from './extractors/social.js';
import { extractAddresses } from './extractors/address.js';
import { extractMeta } from './extractors/meta.js';
import { htmlToText } from './html-to-text.js';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { ScrapeResult } from '../shared/types.js';
import { scoreResult } from './quality-scorer.js';
import { extractWithGemini, extractWithGeminiFromText, isGeminiConfigured } from './gemini-extractor.js';
import { mergeGeminiResult } from './tier3-merger.js';

// Subpages ordered by contact-data yield: contact pages first, then about, then team
const SUBPAGES = [
  '/contact', '/contact-us', '/get-in-touch', '/connect',
  '/about', '/about-us', '/locations',
  '/team', '/our-team', '/people', '/staff',
];

/**
 * DNS pre-check: returns true if the domain resolves.
 */
async function dnsWithTimeout(hostname: string, timeoutMs = 5000): Promise<boolean> {
  return Promise.race([
    dns.resolve4(hostname).then(() => true, () => false),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function dnsResolves(domain: string): Promise<boolean> {
  if (await dnsWithTimeout(domain)) return true;
  // Try www. variant
  if (!domain.startsWith('www.')) {
    return dnsWithTimeout(`www.${domain}`);
  }
  return false;
}

// ── Killswitch ──────────────────────────────────────────
let killed = false;
function setupKillswitch() {
  const handler = () => {
    if (killed) process.exit(1);
    killed = true;
    console.log('\n\n⚠ KILLSWITCH — saving results and exiting (Ctrl+C again to force)...');
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

/**
 * Extract all data from pre-fetched HTML using the standard extraction pipeline.
 * Single source of truth — used by both Tier 1 and Tier 2.
 */
function extractFromHtml(html: string, sourceUrl: string, result: ScrapeResult): void {
  const $ = load(html);
  result.phone_numbers = extractPhones(html, $, sourceUrl);
  result.social_links = extractSocialLinks(html, $, sourceUrl);
  result.addresses = extractAddresses(html, $, sourceUrl);

  const meta = extractMeta(html, $, sourceUrl);
  result.short_description = meta.short_description
    ? {
        value: meta.short_description,
        source_url: sourceUrl,
        source_element: 'meta[name="description"]',
        extraction_method: 'meta_tag',
        confidence: 0.90,
        extracted_at: new Date().toISOString(),
      }
    : null;
  result.technologies = meta.technologies;
  result.logo_url = meta.logo_url;
  result.emails = meta.emails.map((e) => ({
    value: e,
    source_url: sourceUrl,
    source_element: 'mailto_or_regex',
    extraction_method: 'email_extraction',
    confidence: 0.85,
    extracted_at: new Date().toISOString(),
  }));
  result.year_founded = meta.year_founded;
  result.industry_keywords = meta.industry_keywords;
  result.company_name = meta.company_name;

  // Merge JSON-LD phones (dedup against already-extracted phones)
  if (meta.jsonld_phones.length > 0) {
    const existingPhones = new Set(result.phone_numbers.map((p) => p.value));
    for (const phone of meta.jsonld_phones) {
      if (!existingPhones.has(phone)) {
        existingPhones.add(phone);
        result.phone_numbers.push({
          value: phone,
          source_url: sourceUrl,
          source_element: 'script[type="application/ld+json"]',
          extraction_method: 'jsonld_schema',
          confidence: 0.95,
          extracted_at: new Date().toISOString(),
        });
      }
    }
  }

  // Merge JSON-LD addresses (always try — dedup against already-extracted)
  if (meta.jsonld_addresses.length > 0) {
    const existingAddrs = new Set(result.addresses.map((a) => a.value.toLowerCase()));
    for (const addr of meta.jsonld_addresses) {
      if (addr.raw && !existingAddrs.has(addr.raw.toLowerCase())) {
        existingAddrs.add(addr.raw.toLowerCase());
        result.addresses.push({
          value: addr.raw,
          source_url: sourceUrl,
          source_element: 'script[type="application/ld+json"]',
          extraction_method: 'jsonld_schema',
          confidence: 0.95,
          extracted_at: new Date().toISOString(),
        });
      }
    }
  }

  // Merge JSON-LD sameAs social links (high-confidence structured data)
  if (meta.jsonld_social_urls.length > 0) {
    for (const url of meta.jsonld_social_urls) {
      const platform = getSocialPlatform(url);
      if (platform && !result.social_links[platform]) {
        result.social_links[platform] = {
          value: url,
          source_url: sourceUrl,
          source_element: 'script[type="application/ld+json"] sameAs',
          extraction_method: 'jsonld_sameAs',
          confidence: 0.95,
          extracted_at: new Date().toISOString(),
        };
      }
    }
  }
}

/**
 * Scrape a single domain: homepage + optional subpages.
 */
async function scrapeDomain(domain: string): Promise<{ result: ScrapeResult; html: string }> {
  const start = Date.now();
  const result: ScrapeResult = {
    domain,
    company_name: null,
    success: false,
    phone_numbers: [],
    social_links: {},
    addresses: [],
    emails: [],
    short_description: null,
    technologies: [],
    logo_url: null,
    industry_keywords: [],
    year_founded: null,
    crawl_time_ms: 0,
    pages_crawled: [],
  };
  let allHtml = ''; // Accumulate HTML from all pages for Tier 3

  // DNS pre-check — skip dead domains immediately
  if (!(await dnsResolves(domain))) {
    result.error = 'DNS resolution failed — domain is dead';
    result.crawl_time_ms = Date.now() - start;
    return { result, html: '' };
  }

  // Try HTTPS, HTTP, then with www. prefix
  const withWww = domain.startsWith('www.') ? null : `www.${domain}`;
  const urls = [
    `https://${domain}`,
    `http://${domain}`,
    ...(withWww ? [`https://${withWww}`, `http://${withWww}`] : []),
  ];
  let homepageHtml: string | null = null;
  let homepageUrl = '';
  let lastError = '';

  for (const url of urls) {
    const res = await fetchPage(url);
    if (res.html) {
      homepageHtml = res.html;
      homepageUrl = url;
      result.pages_crawled.push(url);
      break;
    }
    lastError = res.error || 'Unknown error';
  }

  if (!homepageHtml) {
    result.error = `Failed to fetch homepage: ${lastError}`;
    result.crawl_time_ms = Date.now() - start;
    return { result, html: '' };
  }

  result.success = true;
  allHtml = `<!-- PAGE: ${homepageUrl} -->\n${homepageHtml}`;

  // Extract all data from homepage using the shared pipeline
  extractFromHtml(homepageHtml, homepageUrl, result);

  // Crawl subpages if missing key data (phones, emails, or addresses)
  // Use a time budget so subpages don't cause the 20s domain deadline to discard homepage data
  const SUBPAGE_BUDGET_MS = 10_000; // Max 10s on subpages
  const needsSubpages =
    result.phone_numbers.length === 0 ||
    result.emails.length === 0 ||
    result.addresses.length === 0;
  const elapsedSoFar = Date.now() - start;

  if (needsSubpages && elapsedSoFar < SUBPAGE_BUDGET_MS) {
    const subpageDeadline = start + SUBPAGE_BUDGET_MS;
    const robotsRules = await getRobotsRules(domain);

    // Respect crawl-delay if specified
    if (robotsRules.crawlDelay && robotsRules.crawlDelay > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(robotsRules.crawlDelay! * 1000, 5000)),
      );
    }

    let subpagesFetched = 0;
    const maxSubpages = config.scraper.maxSubpages || 3;

    // Derive base URL from the homepage that actually worked (inherit protocol + hostname)
    let subpageBase: string;
    try {
      const parsed = new URL(homepageUrl);
      subpageBase = `${parsed.protocol}//${parsed.hostname}`;
    } catch {
      subpageBase = `https://${domain}`;
    }

    for (const subpage of SUBPAGES) {
      // Stop if out of time, got everything, or hit subpage limit
      if (
        Date.now() >= subpageDeadline ||
        subpagesFetched >= maxSubpages ||
        (result.phone_numbers.length > 0 && result.emails.length > 0 && result.addresses.length > 0)
      ) {
        break;
      }

      // Skip subpages disallowed by robots.txt
      if (!isPathAllowed(subpage, robotsRules)) {
        logger.debug(`robots.txt disallows ${subpage} on ${domain}, skipping`);
        continue;
      }

      const subUrl = `${subpageBase}${subpage}`;
      const subRes = await fetchPage(subUrl);

      if (subRes.html) {
        subpagesFetched++;
        result.pages_crawled.push(subUrl);
        allHtml += `\n<!-- PAGE: ${subUrl} -->\n${subRes.html}`;
        const sub$ = load(subRes.html);

        // Extract phones from subpage
        if (result.phone_numbers.length === 0) {
          const subPhones = extractPhones(subRes.html, sub$, subUrl);
          result.phone_numbers.push(...subPhones);
        }

        // Extract social links from subpage (merge new platforms only)
        const subSocials = extractSocialLinks(subRes.html, sub$, subUrl);
        for (const [platform, data] of Object.entries(subSocials)) {
          if (!result.social_links[platform]) {
            result.social_links[platform] = data;
          }
        }

        // Extract addresses from subpage
        if (result.addresses.length === 0) {
          const subAddresses = extractAddresses(subRes.html, sub$, subUrl);
          result.addresses.push(...subAddresses);
        }

        // Extract emails and JSON-LD data from subpage
        const subMeta = extractMeta(subRes.html, sub$, subUrl);
        if (subMeta.emails.length > 0) {
          const existingEmails = new Set(result.emails.map((e) => e.value));
          for (const email of subMeta.emails) {
            if (!existingEmails.has(email)) {
              existingEmails.add(email);
              result.emails.push({
                value: email,
                source_url: subUrl,
                source_element: 'mailto_or_regex',
                extraction_method: 'email_extraction',
                confidence: 0.80,
                extracted_at: new Date().toISOString(),
              });
            }
          }
        }

        // Merge JSON-LD phones from subpages
        if (subMeta.jsonld_phones.length > 0 && result.phone_numbers.length === 0) {
          for (const phone of subMeta.jsonld_phones) {
            result.phone_numbers.push({
              value: phone,
              source_url: subUrl,
              source_element: 'script[type="application/ld+json"]',
              extraction_method: 'jsonld_schema',
              confidence: 0.95,
              extracted_at: new Date().toISOString(),
            });
          }
        }

        // Merge JSON-LD addresses from subpages (dedup)
        if (subMeta.jsonld_addresses.length > 0) {
          const existingAddrs = new Set(result.addresses.map((a) => a.value.toLowerCase()));
          for (const addr of subMeta.jsonld_addresses) {
            if (addr.raw && !existingAddrs.has(addr.raw.toLowerCase())) {
              existingAddrs.add(addr.raw.toLowerCase());
              result.addresses.push({
                value: addr.raw,
                source_url: subUrl,
                source_element: 'script[type="application/ld+json"]',
                extraction_method: 'jsonld_schema',
                confidence: 0.95,
                extracted_at: new Date().toISOString(),
              });
            }
          }
        }

        // Merge JSON-LD sameAs social links from subpages
        if (subMeta.jsonld_social_urls.length > 0) {
          for (const url of subMeta.jsonld_social_urls) {
            const platform = getSocialPlatform(url);
            if (platform && !result.social_links[platform]) {
              result.social_links[platform] = {
                value: url,
                source_url: subUrl,
                source_element: 'script[type="application/ld+json"] sameAs',
                extraction_method: 'jsonld_sameAs',
                confidence: 0.95,
                extracted_at: new Date().toISOString(),
              };
            }
          }
        }
      }
    }
  }

  result.crawl_time_ms = Date.now() - start;
  return { result, html: allHtml };
}

/**
 * Tier 2: Scrape a single domain using headless browser.
 * Reuses the exact same extraction pipeline as Tier 1.
 */
async function scrapeDomainBrowser(domain: string): Promise<{ result: ScrapeResult; html: string }> {
  const start = Date.now();
  const result: ScrapeResult = {
    domain,
    company_name: null,
    success: false,
    phone_numbers: [],
    social_links: {},
    addresses: [],
    emails: [],
    short_description: null,
    technologies: [],
    logo_url: null,
    industry_keywords: [],
    year_founded: null,
    crawl_time_ms: 0,
    pages_crawled: [],
  };
  let capturedHtml = '';

  const url = `https://${domain}`;
  const res = await fetchPageWithBrowser(url);

  if (!res.html) {
    // Try www variant
    const wwwUrl = `https://www.${domain}`;
    const wwwRes = await fetchPageWithBrowser(wwwUrl);
    if (!wwwRes.html) {
      result.error = `Tier 2 failed: ${wwwRes.error || res.error}`;
      result.crawl_time_ms = Date.now() - start;
      return { result, html: '' };
    }
    result.success = true;
    result.pages_crawled.push(wwwUrl);
    capturedHtml = `<!-- PAGE: ${wwwUrl} -->\n${wwwRes.html}`;
    extractFromHtml(wwwRes.html, wwwUrl, result);
  } else {
    result.success = true;
    result.pages_crawled.push(url);
    capturedHtml = `<!-- PAGE: ${url} -->\n${res.html}`;
    extractFromHtml(res.html, url, result);
  }

  result.crawl_time_ms = Date.now() - start;
  return { result, html: capturedHtml };
}

/**
 * Tier 2 (PinchTab): Fetch page text using PinchTab multi-instance browser.
 * Captures clean text for Tier 3. No HTML extraction (PinchTab doesn't expose raw HTML).
 * Domains scraped here go directly to Tier 3 for data extraction.
 */
async function scrapeDomainPinchTab(domain: string): Promise<{ result: ScrapeResult; text: string }> {
  const start = Date.now();
  const result: ScrapeResult = {
    domain,
    company_name: null,
    success: false,
    phone_numbers: [],
    social_links: {},
    addresses: [],
    emails: [],
    short_description: null,
    technologies: [],
    logo_url: null,
    industry_keywords: [],
    year_founded: null,
    crawl_time_ms: 0,
    pages_crawled: [],
  };

  const url = `https://${domain}`;
  let res = await fetchWithPinchTab(url);

  if (!res.text) {
    // Try www variant
    const wwwUrl = `https://www.${domain}`;
    res = await fetchWithPinchTab(wwwUrl);
  }

  if (!res.text) {
    result.error = `PinchTab Tier 2 failed: ${res.error || 'No content'}`;
    result.crawl_time_ms = Date.now() - start;
    return { result, text: '' };
  }

  result.success = true;
  result.pages_crawled.push(res.url);
  if (res.title) {
    result.company_name = res.title;
  }

  result.crawl_time_ms = Date.now() - start;
  return { result, text: res.text };
}

/**
 * Main scraper: read domains from CSV and scrape them concurrently.
 */
async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let limit = 0;
  let sample = 0;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }
  const sampleIdx = args.indexOf('--sample');
  if (sampleIdx !== -1) {
    sample = args[sampleIdx + 1] ? parseInt(args[sampleIdx + 1], 10) : 50;
  }
  const useTier2 = args.includes('--tier2');
  const useTier3 = args.includes('--tier3');
  const usePinchTab = args.includes('--pinchtab');

  // Read domains from CSV
  const csvPath = 'SampleData/sample-websites.csv';
  const csvContent = readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true }) as {
    domain: string;
  }[];

  let domains = records.map((r) => r.domain.trim()).filter(Boolean);
  const totalAvailable = domains.length;

  if (sample > 0) {
    // Fisher-Yates shuffle, then take the first `sample` items
    for (let i = domains.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [domains[i], domains[j]] = [domains[j], domains[i]];
    }
    domains = domains.slice(0, Math.min(sample, domains.length));
    console.log(`🎲 Randomly sampled ${domains.length} domains from ${totalAvailable}`);
  } else if (limit > 0) {
    domains = domains.slice(0, limit);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           VERIDION CRAWLER — TIER 1 (HTTP)          ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Domains               │ ${domains.length.toString().padStart(6)}                  ║`);
  console.log(`║  Concurrency           │ ${config.scraper.concurrency.toString().padStart(6)}                  ║`);
  console.log('║  Ctrl+C = graceful stop                             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const overallStart = Date.now();
  setupKillswitch();
  const limiter = pLimit(config.scraper.concurrency);

  const results: ScrapeResult[] = [];
  const htmlStore = new Map<string, string>(); // domain → accumulated HTML for Tier 3
  let completed = 0;
  let successCount = 0;

  const promises = domains.map((domain) =>
    limiter(async () => {
      if (killed) return;
      const DOMAIN_DEADLINE = 20_000;
      const scrapeResult = await Promise.race([
        scrapeDomain(domain),
        new Promise<{ result: ScrapeResult; html: string }>((resolve) =>
          setTimeout(() => resolve({
            result: {
              domain, company_name: null, success: false, phone_numbers: [], social_links: {},
              addresses: [], emails: [], short_description: null, technologies: [],
              logo_url: null, industry_keywords: [], year_founded: null,
              crawl_time_ms: DOMAIN_DEADLINE, pages_crawled: [],
              error: 'Domain deadline exceeded (20s)',
            },
            html: '',
          }), DOMAIN_DEADLINE),
        ),
      ]);
      const result = scrapeResult.result;
      if (scrapeResult.html) htmlStore.set(domain, scrapeResult.html);
      if (killed && !result.success) return;
      completed++;
      if (result.success) successCount++;

      const pct = ((successCount / completed) * 100).toFixed(1);
      const bar = '█'.repeat(Math.floor((completed / domains.length) * 30)) +
                  '░'.repeat(30 - Math.floor((completed / domains.length) * 30));
      process.stdout.write(
        `\r[${bar}] ${completed}/${domains.length} | ✓${successCount} (${pct}%) | ${domain.slice(0, 30).padEnd(30)} ${result.success ? '✓' : '✗'}   `,
      );
      if (completed === domains.length) process.stdout.write('\n');

      results.push(result);
      return result;
    }),
  );

  await Promise.all(promises);
  if (killed) process.stdout.write('\n');

  // ── Tier 2: Headless browser fallback ──────────────────
  let tier2Recovered = 0;
  const textStore = new Map<string, string>(); // domain → clean text for Tier 3

  if ((useTier2 || usePinchTab) && !killed) {
    // Find failed domains that are worth retrying
    // Skip: DNS dead, 404s, TLS/SSL errors, connection refused — browser won't fix these
    const retriable = results.filter(
      (r) =>
        !r.success &&
        !r.error?.includes('DNS resolution failed') &&
        !r.error?.includes('HTTP 404') &&
        !r.error?.match(/SSL|TLS|certificate|CERT_/i) &&
        !r.error?.includes('ECONNREFUSED'),
    );

    if (retriable.length > 0) {
      const engine = usePinchTab ? 'PINCHTAB' : 'PLAYWRIGHT';
      const concurrency = usePinchTab ? config.pinchtab.concurrency : 3;

      console.log('');
      console.log('╔══════════════════════════════════════════════════════╗');
      console.log(`║     TIER 2 — ${engine.padEnd(10)} BROWSER FALLBACK          ║`);
      console.log('╠══════════════════════════════════════════════════════╣');
      console.log(`║  Retrying              │ ${retriable.length.toString().padStart(6)} domains           ║`);
      console.log(`║  Concurrency           │ ${concurrency.toString().padStart(6)}                  ║`);
      console.log('╚══════════════════════════════════════════════════════╝');
      console.log('');

      if (usePinchTab) {
        await launchPinchTabPool();
      } else {
        await launchBrowser();
      }
      const tier2Limiter = pLimit(concurrency);
      let tier2Done = 0;

      const tier2Promises = retriable.map((failedResult) =>
        tier2Limiter(async () => {
          if (killed) return;
          const BROWSER_DEADLINE = 20_000;

          if (usePinchTab) {
            // PinchTab path: get text (no HTML), store for Tier 3
            const t2 = await Promise.race([
              scrapeDomainPinchTab(failedResult.domain),
              new Promise<{ result: ScrapeResult; text: string }>((resolve) =>
                setTimeout(() => resolve({
                  result: {
                    domain: failedResult.domain, company_name: null, success: false,
                    phone_numbers: [], social_links: {}, addresses: [], emails: [],
                    short_description: null, technologies: [], logo_url: null,
                    industry_keywords: [], year_founded: null,
                    crawl_time_ms: BROWSER_DEADLINE, pages_crawled: [],
                    error: 'PinchTab Tier 2 deadline exceeded (20s)',
                  },
                  text: '',
                }), BROWSER_DEADLINE),
              ),
            ]);

            tier2Done++;
            if (t2.result.success) {
              tier2Recovered++;
              if (t2.text) textStore.set(failedResult.domain, t2.text);
              const idx = results.indexOf(failedResult);
              if (idx !== -1) results[idx] = t2.result;
            }
          } else {
            // Playwright path: get HTML, extract data
            const t2 = await Promise.race([
              scrapeDomainBrowser(failedResult.domain),
              new Promise<{ result: ScrapeResult; html: string }>((resolve) =>
                setTimeout(() => resolve({
                  result: {
                    domain: failedResult.domain, company_name: null, success: false,
                    phone_numbers: [], social_links: {}, addresses: [], emails: [],
                    short_description: null, technologies: [], logo_url: null,
                    industry_keywords: [], year_founded: null,
                    crawl_time_ms: BROWSER_DEADLINE, pages_crawled: [],
                    error: 'Tier 2 deadline exceeded (20s)',
                  },
                  html: '',
                }), BROWSER_DEADLINE),
              ),
            ]);

            tier2Done++;
            if (t2.result.success) {
              tier2Recovered++;
              if (t2.html) htmlStore.set(failedResult.domain, t2.html);
              const idx = results.indexOf(failedResult);
              if (idx !== -1) results[idx] = t2.result;
            }
          }

          const bar = '█'.repeat(Math.floor((tier2Done / retriable.length) * 30)) +
                      '░'.repeat(30 - Math.floor((tier2Done / retriable.length) * 30));
          process.stdout.write(
            `\r[${bar}] ${tier2Done}/${retriable.length} | recovered ${tier2Recovered} | ${failedResult.domain.slice(0, 30).padEnd(30)}   `,
          );
          if (tier2Done === retriable.length) process.stdout.write('\n');
        }),
      );

      await Promise.all(tier2Promises);

      if (usePinchTab) {
        await closePinchTabPool();
      } else {
        await closeBrowser();
      }

      if (tier2Recovered > 0) {
        logger.info(`Tier 2 (${engine}) recovered ${tier2Recovered}/${retriable.length} domains`);
      } else {
        logger.info(`Tier 2 (${engine}) recovered 0 additional domains`);
      }
    }
  }

  // ── Tier 3: Gemini AI data refinement ──────────────────
  let tier3Improved = 0;
  let tier3CandidateCount = 0;
  let tier3TextMode = 0; // Count how many used text-based (token-efficient) prompt
  let tier3HtmlMode = 0; // Count how many used HTML-based (legacy) prompt
  if (useTier3 && !killed) {
    if (!isGeminiConfigured()) {
      console.log('\n⚠ Tier 3 requested but GEMINI_API_KEY is not set. Skipping AI refinement.\n');
    } else {
      // Convert HTML to text for all domains in htmlStore (token reduction)
      for (const [domain, html] of htmlStore) {
        if (!textStore.has(domain)) {
          textStore.set(domain, htmlToText(html));
        }
      }

      // Score all successful results and find candidates
      // Candidates need either text or html available
      const successWithData = results.filter(
        (r) => r.success && (textStore.has(r.domain) || htmlStore.has(r.domain)),
      );
      const allScored = successWithData.map((r) => ({ result: r, quality: scoreResult(r) }));

      // Show scoring overview
      const successTotal = results.filter((r) => r.success).length;
      const withData = successWithData.length;
      const withText = [...textStore.keys()].filter((d) => results.some((r) => r.success && r.domain === d)).length;
      const belowThreshold = allScored.filter(({ quality }) => quality.needsTier3).length;

      console.log('');
      console.log(`ℹ Tier 3 scoring: ${successTotal} successful, ${withData} have data stored (${withText} text, ${htmlStore.size} html), ${belowThreshold} below quality threshold (${config.gemini.qualityThreshold})`);

      // Log all scores for debugging
      for (const { result: r, quality } of allScored.sort((a, b) => a.quality.score - b.quality.score)) {
        const tag = quality.needsTier3 ? '⚠' : '✓';
        console.log(`  ${tag} ${r.domain.padEnd(35)} score=${String(quality.score).padStart(3)} ${quality.reasons.length > 0 ? '(' + quality.reasons.join(', ') + ')' : ''}`);
      }

      const candidates = allScored
        .filter(({ quality }) => quality.needsTier3)
        .sort((a, b) => a.quality.score - b.quality.score); // Worst first

      tier3CandidateCount = candidates.length;

      if (candidates.length > 0) {
        console.log('');
        console.log('╔══════════════════════════════════════════════════════╗');
        console.log('║         TIER 3 — GEMINI AI DATA REFINEMENT          ║');
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║  Candidates            │ ${candidates.length.toString().padStart(6)} domains           ║`);
        console.log(`║  Concurrency           │ ${config.gemini.concurrency.toString().padStart(6)}                  ║`);
        console.log('╚══════════════════════════════════════════════════════╝');
        console.log('');

        // Log scoring details
        for (const { result: r, quality } of candidates) {
          logger.debug(`Tier 3 candidate: ${r.domain} (score=${quality.score}, reasons=${quality.reasons.join(', ')})`);
        }

        const tier3Limiter = pLimit(config.gemini.concurrency);
        let tier3Done = 0;

        const tier3Promises = candidates.map(({ result: candidateResult, quality }) =>
          tier3Limiter(async () => {
            if (killed) return;

            // Prefer text-based extraction (token-efficient) over HTML
            const text = textStore.get(candidateResult.domain);
            const html = htmlStore.get(candidateResult.domain);
            if (!text && !html) return;

            try {
              let geminiResult;
              if (text) {
                // Token-efficient path: ~1-2K tokens instead of ~15-20K
                geminiResult = await extractWithGeminiFromText(
                  candidateResult.domain,
                  text,
                  candidateResult,
                );
                tier3TextMode++;
              } else {
                // Legacy path: full HTML
                geminiResult = await extractWithGemini(
                  candidateResult.domain,
                  html!,
                  candidateResult,
                );
                tier3HtmlMode++;
              }

              if (geminiResult) {
                const merged = mergeGeminiResult(candidateResult, geminiResult, candidateResult.domain);
                const idx = results.indexOf(candidateResult);
                if (idx !== -1) {
                  results[idx] = merged;
                  tier3Improved++;
                }
              }
            } catch (err) {
              logger.warn(`Tier 3 failed for ${candidateResult.domain}: ${err}`);
            }

            tier3Done++;
            const bar = '█'.repeat(Math.floor((tier3Done / candidates.length) * 30)) +
                        '░'.repeat(30 - Math.floor((tier3Done / candidates.length) * 30));
            process.stdout.write(
              `\r[${bar}] ${tier3Done}/${candidates.length} | improved ${tier3Improved} | ${candidateResult.domain.slice(0, 30).padEnd(30)}   `,
            );
            if (tier3Done === candidates.length) process.stdout.write('\n');
          }),
        );

        await Promise.all(tier3Promises);
        logger.info(`Tier 3 improved ${tier3Improved}/${candidates.length} domains`);
      } else {
        console.log('');
        console.log('╔══════════════════════════════════════════════════════╗');
        console.log('║         TIER 3 — GEMINI AI DATA REFINEMENT          ║');
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log('║  All results scored above quality threshold (70)    ║');
        console.log('║  No AI refinement needed.                           ║');
        console.log('╚══════════════════════════════════════════════════════╝');
        console.log('');
        logger.info('Tier 3: all results scored above quality threshold — no refinement needed');
      }
    }
    // Free memory
    htmlStore.clear();
    textStore.clear();
  }

  const totalTimeMs = Date.now() - overallStart;

  // Calculate stats
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const withPhones = results.filter((r) => r.success && r.phone_numbers.length > 0).length;
  const withSocial = results.filter((r) => r.success && Object.keys(r.social_links).length > 0).length;
  const withAddresses = results.filter((r) => r.success && r.addresses.length > 0).length;
  const withEmails = results.filter((r) => r.success && r.emails.length > 0).length;
  const withName = results.filter((r) => r.success && r.company_name).length;
  const withDescription = results.filter((r) => r.success && r.short_description).length;
  const withTech = results.filter((r) => r.success && r.technologies.length > 0).length;
  const withYear = results.filter((r) => r.success && r.year_founded).length;

  // Failure breakdown
  const dnsDead = results.filter((r) => !r.success && r.error?.includes('DNS resolution failed')).length;
  const http4xx = results.filter((r) => !r.success && r.error?.match(/HTTP 4\d\d/)).length;
  const http5xx = results.filter((r) => !r.success && r.error?.match(/HTTP 5\d\d/)).length;
  const timedOut = results.filter((r) => !r.success && (r.error?.includes('deadline exceeded') || r.error?.includes('timeout') || r.error?.includes('Timeout'))).length;
  const otherFail = failed - dnsDead - http4xx - http5xx - timedOut;

  // Total pages crawled
  const totalPages = results.reduce((sum, r) => sum + r.pages_crawled.length, 0);
  const avgCrawlMs = successful > 0 ? results.filter((r) => r.success).reduce((s, r) => s + r.crawl_time_ms, 0) / successful : 0;

  const pctOf = (n: number, total: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
  const pad = (s: string, len: number) => s.padEnd(len);
  const rpad = (s: string, len: number) => s.padStart(len);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      SCRAPE SUMMARY                        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  OVERVIEW                                                  ║');
  console.log(`║    Domains attempted    ${rpad(String(domains.length), 6)}                              ║`);
  console.log(`║    Successful           ${rpad(String(successful), 6)}  (${rpad(pctOf(successful, domains.length) + '%', 6)})                    ║`);
  console.log(`║    Failed               ${rpad(String(failed), 6)}  (${rpad(pctOf(failed, domains.length) + '%', 6)})                    ║`);
  console.log(`║    Pages crawled        ${rpad(String(totalPages), 6)}                              ║`);
  console.log(`║    Total time           ${rpad((totalTimeMs / 1000).toFixed(1) + 's', 7)}                             ║`);
  console.log(`║    Avg per domain       ${rpad((totalTimeMs / domains.length).toFixed(0) + 'ms', 7)}                             ║`);
  console.log(`║    Avg per success      ${rpad(avgCrawlMs.toFixed(0) + 'ms', 7)}                             ║`);
  if (useTier2 || usePinchTab) {
    const engine = usePinchTab ? 'PINCHTAB' : 'PLAYWRIGHT';
    console.log('║                                                              ║');
    console.log(`║  TIER 2 BROWSER FALLBACK (${engine.padEnd(10)})                     ║`);
    const retriableCount = results.filter(
      (r) => !r.success && !r.error?.includes('DNS resolution failed') && !r.error?.includes('HTTP 404'),
    ).length + tier2Recovered; // add back recovered since they're now successful
    console.log(`║    Domains retried      ${rpad(String(retriableCount), 6)}                              ║`);
    console.log(`║    Recovered            ${rpad(String(tier2Recovered), 6)}                              ║`);
  }
  if (useTier3) {
    console.log('║                                                              ║');
    console.log('║  TIER 3 AI REFINEMENT                                       ║');
    console.log(`║    Candidates scored    ${rpad(String(tier3CandidateCount), 6)}                              ║`);
    console.log(`║    Improved             ${rpad(String(tier3Improved), 6)}                              ║`);
    if (tier3TextMode > 0 || tier3HtmlMode > 0) {
      console.log(`║    Text mode (efficient)${rpad(String(tier3TextMode), 6)}                              ║`);
      console.log(`║    HTML mode (legacy)   ${rpad(String(tier3HtmlMode), 6)}                              ║`);
    }
  }
  console.log('║                                                              ║');
  console.log('║  FAILURE BREAKDOWN                                          ║');
  console.log(`║    DNS dead             ${rpad(String(dnsDead), 6)}                              ║`);
  console.log(`║    HTTP 4xx             ${rpad(String(http4xx), 6)}                              ║`);
  console.log(`║    HTTP 5xx             ${rpad(String(http5xx), 6)}                              ║`);
  console.log(`║    Timeout              ${rpad(String(timedOut), 6)}                              ║`);
  console.log(`║    Other                ${rpad(String(otherFail), 6)}                              ║`);
  console.log('║                                                              ║');
  console.log('║  DATA EXTRACTION (of successful)                            ║');
  console.log(`║    Company name         ${rpad(String(withName), 6)}  (${rpad(pctOf(withName, successful) + '%', 6)})                    ║`);
  console.log(`║    Description          ${rpad(String(withDescription), 6)}  (${rpad(pctOf(withDescription, successful) + '%', 6)})                    ║`);
  console.log(`║    Phone numbers        ${rpad(String(withPhones), 6)}  (${rpad(pctOf(withPhones, successful) + '%', 6)})                    ║`);
  console.log(`║    Emails               ${rpad(String(withEmails), 6)}  (${rpad(pctOf(withEmails, successful) + '%', 6)})                    ║`);
  console.log(`║    Social links         ${rpad(String(withSocial), 6)}  (${rpad(pctOf(withSocial, successful) + '%', 6)})                    ║`);
  console.log(`║    Addresses            ${rpad(String(withAddresses), 6)}  (${rpad(pctOf(withAddresses, successful) + '%', 6)})                    ║`);
  console.log(`║    Technologies         ${rpad(String(withTech), 6)}  (${rpad(pctOf(withTech, successful) + '%', 6)})                    ║`);
  console.log(`║    Year founded         ${rpad(String(withYear), 6)}  (${rpad(pctOf(withYear, successful) + '%', 6)})                    ║`);
  console.log('║                                                              ║');

  // List failed domains
  const failedDomains = results.filter((r) => !r.success);
  if (failedDomains.length > 0 && failedDomains.length <= 30) {
    console.log('║  FAILED DOMAINS                                            ║');
    for (const r of failedDomains) {
      const reason = (r.error || 'Unknown').substring(0, 30);
      console.log(`║    ${pad(r.domain.substring(0, 25), 26)} ${pad(reason, 31)}║`);
    }
    console.log('║                                                              ║');
  }

  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Save results
  mkdirSync('output', { recursive: true });
  writeFileSync('output/scrape-results.json', JSON.stringify(results, null, 2));
  logger.info('Results saved to output/scrape-results.json');
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  logger.error('Scraper failed:', err);
  process.exit(1);
});
