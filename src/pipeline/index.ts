import { mergeDatasets } from './merge.js';
import { normalizeProfiles } from './normalize.js';
import { seedSupabase } from './seed-supabase.js';
import { indexElasticsearch } from './index-elasticsearch.js';
import { logger } from '../shared/logger.js';

/**
 * Master pipeline: merge → normalize → seed Supabase → index ES.
 */
async function main() {
  const start = Date.now();

  logger.info('=== PIPELINE START ===');

  // Step 1: Merge scraped data with company names + extract provenance
  logger.info('Step 1: Merging datasets...');
  const { profiles: merged, provenance } = mergeDatasets();

  // Step 2: Normalize all data
  logger.info('Step 2: Normalizing profiles...');
  const normalized = normalizeProfiles(merged);

  // Step 3: Seed Supabase (companies + provenance + crawl run)
  logger.info('Step 3: Seeding Supabase...');
  await seedSupabase(normalized, provenance);

  // Step 4: Index ElasticSearch
  logger.info('Step 4: Indexing ElasticSearch...');
  await indexElasticsearch(normalized);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`=== PIPELINE COMPLETE in ${elapsed}s ===`);
}

main().catch((err) => {
  logger.error('Pipeline failed:', err);
  process.exit(1);
});
