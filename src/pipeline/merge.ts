import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { logger } from '../shared/logger.js';
import type { ScrapeResult, CompanyNameRow, CompanyProfile, ProvenanceRecord, ExtractedDataPoint } from '../shared/types.js';

export interface MergeResult {
  profiles: CompanyProfile[];
  provenance: Map<string, ProvenanceRecord[]>;
}

/**
 * Extract provenance records from a ScrapeResult's ExtractedDataPoint fields.
 */
function extractProvenance(scrape: ScrapeResult): ProvenanceRecord[] {
  const records: ProvenanceRecord[] = [];

  const addRecords = (dataPoints: ExtractedDataPoint[], fieldName: string) => {
    for (const dp of dataPoints) {
      records.push({
        field_name: fieldName,
        field_value: dp.value,
        source_url: dp.source_url,
        source_element: dp.source_element,
        extraction_method: dp.extraction_method,
        confidence: dp.confidence,
        extracted_at: dp.extracted_at,
      });
    }
  };

  addRecords(scrape.phone_numbers, 'phone');
  addRecords(scrape.emails, 'email');
  addRecords(scrape.addresses, 'address');

  // Social links are Record<string, ExtractedDataPoint>
  for (const [platform, dp] of Object.entries(scrape.social_links)) {
    records.push({
      field_name: `social_${platform}`,
      field_value: dp.value,
      source_url: dp.source_url,
      source_element: dp.source_element,
      extraction_method: dp.extraction_method,
      confidence: dp.confidence,
      extracted_at: dp.extracted_at,
    });
  }

  // Short description
  if (scrape.short_description) {
    records.push({
      field_name: 'description',
      field_value: scrape.short_description.value,
      source_url: scrape.short_description.source_url,
      source_element: scrape.short_description.source_element,
      extraction_method: scrape.short_description.extraction_method,
      confidence: scrape.short_description.confidence,
      extracted_at: scrape.short_description.extracted_at,
    });
  }

  return records;
}

/**
 * Merge scraped data with company names CSV.
 * Join on domain. Output merged profiles + provenance records.
 */
export function mergeDatasets(): MergeResult {
  // Read scrape results
  const scrapeRaw = readFileSync('output/scrape-results.json', 'utf-8');
  const scrapeResults: ScrapeResult[] = JSON.parse(scrapeRaw);

  // Read company names CSV
  const csvContent = readFileSync('SampleData/sample-websites-company-names.csv', 'utf-8');
  const companyNames: CompanyNameRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  // Build lookup by domain
  const nameMap = new Map<string, CompanyNameRow>();
  for (const row of companyNames) {
    nameMap.set(row.domain.trim().toLowerCase(), row);
  }

  const profiles: CompanyProfile[] = [];
  const provenance = new Map<string, ProvenanceRecord[]>();
  let totalProvenance = 0;

  for (const scrape of scrapeResults) {
    const domain = scrape.domain.trim().toLowerCase();
    const names = nameMap.get(domain);

    // Parse all_names from pipe-separated string
    const allNames = names?.company_all_available_names
      ? names.company_all_available_names.split('|').map((n) => n.trim()).filter(Boolean)
      : [];

    const profile: CompanyProfile = {
      domain,
      commercial_name: names?.company_commercial_name?.trim() || null,
      legal_name: names?.company_legal_name?.trim() || null,
      all_names: allNames,
      phone_numbers: scrape.phone_numbers.map((p) => p.value),
      phone_numbers_raw: scrape.phone_numbers.map((p) => p.value),
      primary_email: scrape.emails.length > 0 ? scrape.emails[0].value : null,
      emails: scrape.emails.map((e) => e.value),
      facebook_url: scrape.social_links.facebook?.value || null,
      facebook_id: null,
      social_links: {},
      addresses: scrape.addresses.map((a) => ({ raw: a.value })),
      short_description: scrape.short_description?.value || null,
      technologies: scrape.technologies,
      logo_url: scrape.logo_url,
      industry_keywords: scrape.industry_keywords,
      year_founded: scrape.year_founded,
      crawl_status: scrape.success ? 'success' : 'failed',
      crawl_timestamp: new Date().toISOString(),
    };

    // Build social_links object
    for (const [platform, data] of Object.entries(scrape.social_links)) {
      profile.social_links[platform] = data.value;
    }

    profiles.push(profile);

    // Extract provenance from all ExtractedDataPoint fields
    if (scrape.success) {
      const records = extractProvenance(scrape);
      if (records.length > 0) {
        provenance.set(domain, records);
        totalProvenance += records.length;
      }
    }
  }

  logger.info(`Merged ${profiles.length} profiles (${scrapeResults.length} scraped, ${companyNames.length} named)`);
  logger.info(`Extracted ${totalProvenance} provenance records from ${provenance.size} domains`);

  mkdirSync('output', { recursive: true });
  writeFileSync('output/merged-profiles.json', JSON.stringify(profiles, null, 2));
  logger.info('Merged profiles saved to output/merged-profiles.json');

  return { profiles, provenance };
}

// Run standalone
if (process.argv[1]?.includes('merge')) {
  mergeDatasets();
}
