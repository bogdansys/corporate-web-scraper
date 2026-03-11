/**
 * Benchmark: Compare Playwright vs PinchTab for Tier 2,
 * and HTML vs Text prompt for Tier 3 token usage.
 *
 * Usage:
 *   npx tsx src/scraper/benchmark.ts
 *
 * Requires:
 *   - PinchTab server running (pinchtab)
 *   - GEMINI_API_KEY set (for Tier 3 comparison)
 */

import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fetchPage } from './fetcher.js';
import { fetchPageWithBrowser, launchBrowser, closeBrowser } from './browser-fetcher.js';
import { fetchWithPinchTab, launchPinchTabPool, closePinchTabPool, isPinchTabRunning } from './pinchtab-fetcher.js';
import { htmlToText } from './html-to-text.js';
import { extractWithGemini, extractWithGeminiFromText, isGeminiConfigured } from './gemini-extractor.js';
import type { ScrapeResult } from '../shared/types.js';

// ── Config ──
const SAMPLE_SIZE = 20; // Domains to test
const TIER3_SAMPLE = 5; // Domains for Tier 3 comparison (uses Gemini credits)

interface BenchResult {
  domain: string;
  success: boolean;
  timeMs: number;
  error?: string;
  contentLength?: number;
}

function emptyResult(domain: string): ScrapeResult {
  return {
    domain, company_name: null, success: false, phone_numbers: [], social_links: {},
    addresses: [], emails: [], short_description: null, technologies: [],
    logo_url: null, industry_keywords: [], year_founded: null, crawl_time_ms: 0, pages_crawled: [],
  };
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║            BENCHMARK: PLAYWRIGHT vs PINCHTAB                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Read domains
  const csvPath = 'SampleData/sample-websites.csv';
  const csvContent = readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true }) as { domain: string }[];
  let domains = records.map((r) => r.domain.trim()).filter(Boolean);

  // Shuffle and sample
  for (let i = domains.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [domains[i], domains[j]] = [domains[j], domains[i]];
  }
  domains = domains.slice(0, SAMPLE_SIZE);
  console.log(`Testing ${SAMPLE_SIZE} random domains...\n`);

  // ── Step 1: Tier 1 HTTP fetch (find domains that fail → need Tier 2) ──
  console.log('── Step 1: Tier 1 HTTP fetch ──');
  const tier1Results: BenchResult[] = [];
  const failedDomains: string[] = [];
  const successfulWithHtml: { domain: string; html: string }[] = [];

  for (const domain of domains) {
    const start = Date.now();
    const urls = [`https://${domain}`, `http://${domain}`, `https://www.${domain}`];
    let succeeded = false;
    let html = '';

    for (const url of urls) {
      const res = await fetchPage(url);
      if (res.html) {
        succeeded = true;
        html = res.html;
        break;
      }
    }

    const elapsed = Date.now() - start;
    tier1Results.push({ domain, success: succeeded, timeMs: elapsed, contentLength: html.length });

    if (succeeded) {
      successfulWithHtml.push({ domain, html });
    } else {
      failedDomains.push(domain);
    }
  }

  const tier1Success = tier1Results.filter((r) => r.success).length;
  const tier1AvgMs = tier1Results.reduce((s, r) => s + r.timeMs, 0) / tier1Results.length;
  console.log(`  Tier 1: ${tier1Success}/${SAMPLE_SIZE} succeeded (avg ${tier1AvgMs.toFixed(0)}ms)`);
  console.log(`  Failed domains for Tier 2 test: ${failedDomains.length}`);
  console.log('');

  // ── Step 2: Tier 2 comparison (Playwright vs PinchTab) ──
  // Use BOTH failed domains AND some successful ones for fair comparison
  const tier2TestDomains = [
    ...failedDomains,
    ...domains.filter((d) => !failedDomains.includes(d)).slice(0, Math.min(10, SAMPLE_SIZE - failedDomains.length)),
  ].slice(0, 15); // Cap at 15 to keep benchmark manageable

  console.log(`── Step 2: Tier 2 comparison (${tier2TestDomains.length} domains) ──`);

  // Playwright
  console.log('  [Playwright] Starting...');
  await launchBrowser();
  const playwrightResults: BenchResult[] = [];
  const pwStart = Date.now();

  for (const domain of tier2TestDomains) {
    const start = Date.now();
    const url = `https://${domain}`;
    const res = await fetchPageWithBrowser(url);
    playwrightResults.push({
      domain,
      success: !!res.html,
      timeMs: Date.now() - start,
      contentLength: res.html?.length || 0,
    });
  }
  await closeBrowser();
  const pwTotalMs = Date.now() - pwStart;

  const pwSuccess = playwrightResults.filter((r) => r.success).length;
  const pwAvgMs = playwrightResults.reduce((s, r) => s + r.timeMs, 0) / playwrightResults.length;
  console.log(`  [Playwright] ${pwSuccess}/${tier2TestDomains.length} succeeded | total ${(pwTotalMs / 1000).toFixed(1)}s | avg ${pwAvgMs.toFixed(0)}ms/domain`);

  // PinchTab
  const pinchTabUp = await isPinchTabRunning();
  let ptSuccess = 0;
  let ptTotalMs = 0;
  let ptAvgMs = 0;
  const pinchTabResults: BenchResult[] = [];
  const pinchTabTexts = new Map<string, string>();

  if (pinchTabUp) {
    console.log('  [PinchTab]   Starting...');
    await launchPinchTabPool();
    const ptStart = Date.now();

    // PinchTab can run in parallel!
    const ptPromises = tier2TestDomains.map(async (domain) => {
      const start = Date.now();
      const url = `https://${domain}`;
      const res = await fetchWithPinchTab(url);
      if (res.text) pinchTabTexts.set(domain, res.text);
      return {
        domain,
        success: !!res.text,
        timeMs: Date.now() - start,
        contentLength: res.text?.length || 0,
      };
    });

    const ptResults = await Promise.all(ptPromises);
    pinchTabResults.push(...ptResults);
    await closePinchTabPool();
    ptTotalMs = Date.now() - ptStart;

    ptSuccess = pinchTabResults.filter((r) => r.success).length;
    ptAvgMs = pinchTabResults.reduce((s, r) => s + r.timeMs, 0) / pinchTabResults.length;
    console.log(`  [PinchTab]   ${ptSuccess}/${tier2TestDomains.length} succeeded | total ${(ptTotalMs / 1000).toFixed(1)}s | avg ${ptAvgMs.toFixed(0)}ms/domain`);
  } else {
    console.log('  [PinchTab]   SKIPPED — server not running');
  }

  console.log('');

  // ── Step 3: Token comparison (HTML vs Text for Tier 3) ──
  console.log('── Step 3: Token estimation (HTML vs Text) ──');

  const tokenSamples = successfulWithHtml.slice(0, 10);
  let totalHtmlTokens = 0;
  let totalTextTokens = 0;

  for (const { domain, html } of tokenSamples) {
    // Strip scripts/styles like Gemini extractor does
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    const truncatedHtml = cleaned.slice(0, 60_000);
    const text = htmlToText(html);

    // Rough token estimate: ~4 chars per token for English
    const htmlTokens = Math.ceil(truncatedHtml.length / 4);
    const textTokens = Math.ceil(text.length / 4);

    totalHtmlTokens += htmlTokens;
    totalTextTokens += textTokens;

    console.log(`  ${domain.padEnd(35)} HTML: ~${htmlTokens.toLocaleString()} tokens | Text: ~${textTokens.toLocaleString()} tokens | ${(htmlTokens / Math.max(textTokens, 1)).toFixed(1)}x reduction`);
  }

  const avgHtmlTokens = totalHtmlTokens / tokenSamples.length;
  const avgTextTokens = totalTextTokens / tokenSamples.length;
  console.log(`  ─────────────────────────────────────────────────`);
  console.log(`  Average: HTML ~${avgHtmlTokens.toFixed(0)} tokens | Text ~${avgTextTokens.toFixed(0)} tokens | ${(avgHtmlTokens / Math.max(avgTextTokens, 1)).toFixed(1)}x reduction`);
  console.log('');

  // ── Step 4: Tier 3 quality comparison (if Gemini configured) ──
  if (isGeminiConfigured() && tokenSamples.length > 0) {
    const tier3Samples = tokenSamples.slice(0, TIER3_SAMPLE);
    console.log(`── Step 4: Tier 3 quality comparison (${tier3Samples.length} domains, uses Gemini credits) ──`);

    for (const { domain, html } of tier3Samples) {
      const existing = emptyResult(domain);
      existing.success = true;
      const text = htmlToText(html);

      console.log(`\n  ${domain}:`);

      // HTML-based extraction
      const htmlStart = Date.now();
      const htmlResult = await extractWithGemini(domain, html, existing);
      const htmlMs = Date.now() - htmlStart;

      // Text-based extraction
      const textStart = Date.now();
      const textResult = await extractWithGeminiFromText(domain, text, existing);
      const textMs = Date.now() - textStart;

      if (htmlResult && textResult) {
        console.log(`    HTML prompt: ${htmlMs}ms | name="${htmlResult.company_name}" | emails=${htmlResult.emails.length} | phones=${htmlResult.phone_numbers.length} | addrs=${htmlResult.addresses.length}`);
        console.log(`    Text prompt: ${textMs}ms | name="${textResult.company_name}" | emails=${textResult.emails.length} | phones=${textResult.phone_numbers.length} | addrs=${textResult.addresses.length}`);

        // Compare
        const htmlFields = (htmlResult.company_name ? 1 : 0) + htmlResult.emails.length + htmlResult.phone_numbers.length + htmlResult.addresses.length;
        const textFields = (textResult.company_name ? 1 : 0) + textResult.emails.length + textResult.phone_numbers.length + textResult.addresses.length;
        const diff = textFields - htmlFields;
        console.log(`    Data points: HTML=${htmlFields} vs Text=${textFields} (${diff >= 0 ? '+' : ''}${diff})`);
      } else {
        console.log(`    HTML: ${htmlResult ? 'OK' : 'FAILED'} (${htmlMs}ms) | Text: ${textResult ? 'OK' : 'FAILED'} (${textMs}ms)`);
      }
    }
  } else {
    console.log('── Step 4: Tier 3 quality comparison — SKIPPED (no GEMINI_API_KEY) ──');
  }

  // ── Summary ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     BENCHMARK SUMMARY                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Tier 2 Playwright   ${pwSuccess}/${tier2TestDomains.length} succeeded  ${(pwTotalMs / 1000).toFixed(1)}s total  ${pwAvgMs.toFixed(0)}ms avg  ║`);
  if (pinchTabUp) {
    console.log(`║  Tier 2 PinchTab     ${ptSuccess}/${tier2TestDomains.length} succeeded  ${(ptTotalMs / 1000).toFixed(1)}s total  ${ptAvgMs.toFixed(0)}ms avg  ║`);
    const speedup = pwTotalMs / Math.max(ptTotalMs, 1);
    console.log(`║  Speed improvement   ${speedup.toFixed(1)}x faster with PinchTab                  ║`);
  }
  console.log(`║  Token reduction     ${(avgHtmlTokens / Math.max(avgTextTokens, 1)).toFixed(1)}x fewer tokens (text vs HTML)               ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
