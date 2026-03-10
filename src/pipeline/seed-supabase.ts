import { readFileSync } from 'fs';
import { supabase } from '../shared/supabase.js';
import { logger } from '../shared/logger.js';
import type { CompanyProfile, ProvenanceRecord, ScrapeResult } from '../shared/types.js';

/**
 * Seed Supabase with normalized company profiles, provenance records, and crawl run metadata.
 * Upserts companies on domain (updates if exists).
 */
export async function seedSupabase(
  profiles: CompanyProfile[],
  provenance?: Map<string, ProvenanceRecord[]>,
) {
  // ── Step 1: Upsert companies ─────────────────────────
  logger.info(`Seeding ${profiles.length} profiles into Supabase...`);

  const chunkSize = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < profiles.length; i += chunkSize) {
    const chunk = profiles.slice(i, i + chunkSize);

    const rows = chunk.map((p) => ({
      domain: p.domain,
      commercial_name: p.commercial_name,
      legal_name: p.legal_name,
      all_names: p.all_names,
      phone_numbers: p.phone_numbers,
      phone_numbers_raw: p.phone_numbers_raw,
      primary_email: p.primary_email,
      emails: p.emails,
      facebook_url: p.facebook_url,
      facebook_id: p.facebook_id,
      social_links: p.social_links,
      addresses: p.addresses,
      short_description: p.short_description,
      technologies: p.technologies,
      logo_url: p.logo_url,
      industry_keywords: p.industry_keywords,
      year_founded: p.year_founded,
      crawl_status: p.crawl_status,
      crawl_timestamp: p.crawl_timestamp,
    }));

    const { error } = await supabase
      .from('companies')
      .upsert(rows, { onConflict: 'domain' });

    if (error) {
      logger.error(`Supabase upsert error (batch ${i / chunkSize + 1}):`, error.message);
      errors += chunk.length;
    } else {
      inserted += chunk.length;
    }

    if ((i + chunkSize) % 200 === 0 || i + chunkSize >= profiles.length) {
      logger.progress(Math.min(i + chunkSize, profiles.length), profiles.length, 'Supabase upsert');
    }
  }

  logger.info(`Supabase companies: ${inserted} upserted, ${errors} errors`);

  // ── Step 2: Seed data_provenance ─────────────────────
  if (provenance && provenance.size > 0) {
    logger.info(`Seeding provenance for ${provenance.size} domains...`);

    // Get domain→UUID mapping
    const { data: companyRows, error: fetchErr } = await supabase
      .from('companies')
      .select('id, domain');

    if (fetchErr || !companyRows) {
      logger.error('Failed to fetch company IDs for provenance:', fetchErr?.message);
    } else {
      const domainToId = new Map<string, string>();
      for (const row of companyRows) {
        domainToId.set(row.domain, row.id);
      }

      // Clear existing provenance (full re-seed)
      const { error: deleteErr } = await supabase
        .from('data_provenance')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteErr) {
        logger.warn('Failed to clear old provenance:', deleteErr.message);
      }

      // Build provenance rows with resolved company_id
      const allRows: Array<ProvenanceRecord & { company_id: string }> = [];
      for (const [domain, records] of provenance) {
        const companyId = domainToId.get(domain);
        if (!companyId) continue;
        for (const rec of records) {
          allRows.push({ ...rec, company_id: companyId });
        }
      }

      // Batch insert in chunks of 100
      let provInserted = 0;
      const provChunkSize = 100;
      for (let i = 0; i < allRows.length; i += provChunkSize) {
        const chunk = allRows.slice(i, i + provChunkSize);
        const { error: insertErr } = await supabase
          .from('data_provenance')
          .insert(chunk);

        if (insertErr) {
          logger.warn(`Provenance insert error (batch ${Math.floor(i / provChunkSize) + 1}):`, insertErr.message);
        } else {
          provInserted += chunk.length;
        }
      }

      logger.info(`Provenance: ${provInserted}/${allRows.length} records seeded`);
    }
  }

  // ── Step 3: Seed crawl_runs ──────────────────────────
  try {
    const scrapeRaw = readFileSync('output/scrape-results.json', 'utf-8');
    const scrapeResults: ScrapeResult[] = JSON.parse(scrapeRaw);

    const successful = scrapeResults.filter((r) => r.success).length;
    const failed = scrapeResults.filter((r) => !r.success).length;
    const totalTimeMs = scrapeResults.reduce((sum, r) => sum + r.crawl_time_ms, 0);
    const totalPages = scrapeResults.reduce((sum, r) => sum + r.pages_crawled.length, 0);

    // Fill rates
    const successResults = scrapeResults.filter((r) => r.success);
    const sc = successResults.length || 1;
    const fillRates = {
      phone: successResults.filter((r) => r.phone_numbers.length > 0).length / sc,
      email: successResults.filter((r) => r.emails.length > 0).length / sc,
      address: successResults.filter((r) => r.addresses.length > 0).length / sc,
      social: successResults.filter((r) => Object.keys(r.social_links).length > 0).length / sc,
      description: successResults.filter((r) => r.short_description).length / sc,
      logo: successResults.filter((r) => r.logo_url).length / sc,
      year_founded: successResults.filter((r) => r.year_founded).length / sc,
    };

    // Error breakdown
    const errorBreakdown = {
      dns: scrapeResults.filter((r) => !r.success && r.error?.includes('DNS resolution failed')).length,
      http_4xx: scrapeResults.filter((r) => !r.success && r.error?.match(/HTTP 4\d\d/)).length,
      http_5xx: scrapeResults.filter((r) => !r.success && r.error?.match(/HTTP 5\d\d/)).length,
      timeout: scrapeResults.filter((r) => !r.success && (r.error?.includes('deadline') || r.error?.includes('timeout'))).length,
      other: 0,
    };
    errorBreakdown.other = failed - errorBreakdown.dns - errorBreakdown.http_4xx - errorBreakdown.http_5xx - errorBreakdown.timeout;

    // Check if an identical run already exists (same stats = same scrape data)
    const { data: existing } = await supabase
      .from('crawl_runs')
      .select('id')
      .eq('total_domains', scrapeResults.length)
      .eq('successful', successful)
      .eq('failed', failed)
      .eq('total_time_ms', totalTimeMs)
      .limit(1);

    if (existing && existing.length > 0) {
      logger.info('Crawl run already recorded with identical stats — skipping');
    } else {
      const { error: runErr } = await supabase.from('crawl_runs').insert({
        completed_at: new Date().toISOString(),
        total_domains: scrapeResults.length,
        successful,
        failed,
        total_time_ms: totalTimeMs,
        metadata: {
          fill_rates: fillRates,
          error_breakdown: errorBreakdown,
          total_pages_crawled: totalPages,
          avg_crawl_time_ms: Math.round(totalTimeMs / scrapeResults.length),
        },
      });

      if (runErr) {
        logger.warn('Failed to insert crawl_runs:', runErr.message);
      } else {
        logger.info(`Crawl run recorded: ${successful}/${scrapeResults.length} successful (${((successful / scrapeResults.length) * 100).toFixed(1)}%)`);
      }
    }
  } catch {
    logger.warn('Could not read scrape-results.json for crawl_runs — skipping');
  }
}

// Run standalone
if (process.argv[1]?.includes('seed-supabase')) {
  const raw = readFileSync('output/normalized-profiles.json', 'utf-8');
  const profiles: CompanyProfile[] = JSON.parse(raw);
  seedSupabase(profiles).catch((err) => {
    logger.error('Seed failed:', err);
    process.exit(1);
  });
}
