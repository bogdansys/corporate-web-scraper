import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { logger } from '../shared/logger.js';
import type { ScrapeResult } from '../shared/types.js';

/**
 * Generate a data analysis report from scrape results.
 * Outputs to console + saves JSON report.
 */
async function main() {
  const raw = readFileSync('output/scrape-results.json', 'utf-8');
  const results: ScrapeResult[] = JSON.parse(raw);

  const total = results.length;
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const crawled = successful.length;

  // Fill rates (as % of successfully crawled)
  const withPhones = successful.filter((r) => r.phone_numbers.length > 0).length;
  const withFacebook = successful.filter((r) => r.social_links.facebook).length;
  const withAnySocial = successful.filter((r) => Object.keys(r.social_links).length > 0).length;
  const withAddresses = successful.filter((r) => r.addresses.length > 0).length;
  const withEmails = successful.filter((r) => r.emails.length > 0).length;
  const withDescription = successful.filter((r) => r.short_description).length;
  const withTechnologies = successful.filter((r) => r.technologies.length > 0).length;
  const withLogoUrl = successful.filter((r) => r.logo_url).length;
  const withYearFounded = successful.filter((r) => r.year_founded !== null).length;

  // Timing
  const crawlTimes = successful.map((r) => r.crawl_time_ms);
  const avgCrawlTime = crawlTimes.reduce((a, b) => a + b, 0) / crawlTimes.length;
  const totalCrawlTime = crawlTimes.reduce((a, b) => a + b, 0);

  // Technology breakdown
  const techCounts: Record<string, number> = {};
  for (const r of successful) {
    for (const tech of r.technologies) {
      techCounts[tech] = (techCounts[tech] || 0) + 1;
    }
  }
  const topTech = Object.entries(techCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Total data points extracted
  const totalPhones = successful.reduce((sum, r) => sum + r.phone_numbers.length, 0);
  const totalSocial = successful.reduce((sum, r) => sum + Object.keys(r.social_links).length, 0);
  const totalAddresses = successful.reduce((sum, r) => sum + r.addresses.length, 0);
  const totalEmails = successful.reduce((sum, r) => sum + r.emails.length, 0);

  // Error breakdown
  const errorTypes: Record<string, number> = {};
  for (const r of failed) {
    const errorType = r.error || 'unknown';
    const key = errorType.includes('timeout') || errorType.includes('deadline exceeded')
      ? 'timeout'
      : errorType.includes('DNS resolution failed') || errorType.includes('ENOTFOUND')
        ? 'DNS failure'
        : errorType.includes('ECONNREFUSED')
          ? 'Connection refused'
          : errorType.includes('SSL') || errorType.includes('TLS') || errorType.includes('certificate')
            ? 'SSL/TLS error'
            : errorType.includes('HTTP')
              ? errorType
              : 'other';
    errorTypes[key] = (errorTypes[key] || 0) + 1;
  }

  const pct = (n: number, d: number) => ((n / d) * 100).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         VERIDION SWE CHALLENGE — CRAWL REPORT       ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Total domains          │ ${total.toString().padStart(6)}                  ║`);
  console.log(`║  Successfully crawled   │ ${crawled.toString().padStart(6)} (${pct(crawled, total).padStart(5)}%)           ║`);
  console.log(`║  Failed                 │ ${failed.length.toString().padStart(6)} (${pct(failed.length, total).padStart(5)}%)           ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  FILL RATES (% of successfully crawled)             ║');
  console.log(`║  Phone numbers          │ ${withPhones.toString().padStart(6)} (${pct(withPhones, crawled).padStart(5)}%)           ║`);
  console.log(`║  Facebook profiles      │ ${withFacebook.toString().padStart(6)} (${pct(withFacebook, crawled).padStart(5)}%)           ║`);
  console.log(`║  Any social media       │ ${withAnySocial.toString().padStart(6)} (${pct(withAnySocial, crawled).padStart(5)}%)           ║`);
  console.log(`║  Addresses              │ ${withAddresses.toString().padStart(6)} (${pct(withAddresses, crawled).padStart(5)}%)           ║`);
  console.log(`║  Emails                 │ ${withEmails.toString().padStart(6)} (${pct(withEmails, crawled).padStart(5)}%)           ║`);
  console.log(`║  Description            │ ${withDescription.toString().padStart(6)} (${pct(withDescription, crawled).padStart(5)}%)           ║`);
  console.log(`║  Technologies           │ ${withTechnologies.toString().padStart(6)} (${pct(withTechnologies, crawled).padStart(5)}%)           ║`);
  console.log(`║  Logo URL               │ ${withLogoUrl.toString().padStart(6)} (${pct(withLogoUrl, crawled).padStart(5)}%)           ║`);
  console.log(`║  Year founded           │ ${withYearFounded.toString().padStart(6)} (${pct(withYearFounded, crawled).padStart(5)}%)           ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  TOTALS                                             ║');
  console.log(`║  Total phone numbers    │ ${totalPhones.toString().padStart(6)}                  ║`);
  console.log(`║  Total social links     │ ${totalSocial.toString().padStart(6)}                  ║`);
  console.log(`║  Total addresses        │ ${totalAddresses.toString().padStart(6)}                  ║`);
  console.log(`║  Total emails           │ ${totalEmails.toString().padStart(6)}                  ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  TIMING                                             ║');
  console.log(`║  Avg crawl time/domain  │ ${avgCrawlTime.toFixed(0).padStart(6)} ms               ║`);
  console.log(`║  Total crawl time       │ ${(totalCrawlTime / 1000).toFixed(1).padStart(6)} s                ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  TOP TECHNOLOGIES                                   ║');
  for (const [tech, count] of topTech) {
    console.log(`║  ${tech.padEnd(24)}│ ${count.toString().padStart(6)}                  ║`);
  }
  if (Object.keys(errorTypes).length > 0) {
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log('║  ERROR BREAKDOWN                                    ║');
    for (const [type, count] of Object.entries(errorTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`║  ${type.padEnd(24)}│ ${count.toString().padStart(6)}                  ║`);
    }
  }
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Save report
  const report = {
    generated_at: new Date().toISOString(),
    summary: {
      total_domains: total,
      crawled: crawled,
      failed: failed.length,
      coverage_pct: parseFloat(pct(crawled, total)),
    },
    fill_rates: {
      phone_numbers: { count: withPhones, pct: parseFloat(pct(withPhones, crawled)) },
      facebook: { count: withFacebook, pct: parseFloat(pct(withFacebook, crawled)) },
      any_social: { count: withAnySocial, pct: parseFloat(pct(withAnySocial, crawled)) },
      addresses: { count: withAddresses, pct: parseFloat(pct(withAddresses, crawled)) },
      emails: { count: withEmails, pct: parseFloat(pct(withEmails, crawled)) },
      description: { count: withDescription, pct: parseFloat(pct(withDescription, crawled)) },
      technologies: { count: withTechnologies, pct: parseFloat(pct(withTechnologies, crawled)) },
      logo_url: { count: withLogoUrl, pct: parseFloat(pct(withLogoUrl, crawled)) },
      year_founded: { count: withYearFounded, pct: parseFloat(pct(withYearFounded, crawled)) },
    },
    totals: {
      phone_numbers: totalPhones,
      social_links: totalSocial,
      addresses: totalAddresses,
      emails: totalEmails,
    },
    timing: {
      avg_crawl_time_ms: Math.round(avgCrawlTime),
      total_crawl_time_s: parseFloat((totalCrawlTime / 1000).toFixed(1)),
    },
    top_technologies: topTech.map(([tech, count]) => ({ tech, count })),
    error_breakdown: errorTypes,
  };

  mkdirSync('output', { recursive: true });
  writeFileSync('output/crawl-report.json', JSON.stringify(report, null, 2));
  logger.info('Report saved to output/crawl-report.json');
}

main().catch((err) => {
  logger.error('Report generation failed:', err);
  process.exit(1);
});
