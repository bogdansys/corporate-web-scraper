import { readFileSync } from 'fs';
import { Client } from '@elastic/elasticsearch';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { CompanyProfile } from '../shared/types.js';

const INDEX_NAME = config.elasticsearch.index;

/**
 * Create ES index with custom analyzers and mappings.
 * Then bulk index all company profiles.
 */
export async function indexElasticsearch(profiles: CompanyProfile[]) {
  const client = new Client({ node: config.elasticsearch.url });

  // Delete index if exists
  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (exists) {
    await client.indices.delete({ index: INDEX_NAME });
    logger.info(`Deleted existing index: ${INDEX_NAME}`);
  }

  // Create index with custom analyzers
  await client.indices.create({
    index: INDEX_NAME,
    settings: {
      analysis: {
        analyzer: {
          company_name_analyzer: {
            type: 'custom',
            tokenizer: 'standard',
            filter: ['lowercase', 'company_suffix_strip', 'asciifolding'],
          },
          ngram_analyzer: {
            type: 'custom',
            tokenizer: 'ngram_tokenizer',
            filter: ['lowercase'],
          },
        },
        tokenizer: {
          ngram_tokenizer: {
            type: 'ngram',
            min_gram: 3,
            max_gram: 5,
            token_chars: ['letter', 'digit'],
          },
        },
        filter: {
          company_suffix_strip: {
            type: 'stop',
            stopwords: [
              'inc', 'llc', 'ltd', 'corp', 'co', 'pty', 'limited',
              'holding', 'holdings', 'company', 'services', 'service',
            ],
          },
        },
      },
      index: {
        max_ngram_diff: 2,
      },
    },
    mappings: {
      properties: {
        domain: { type: 'keyword' },
        commercial_name: {
          type: 'text',
          analyzer: 'company_name_analyzer',
          fields: {
            keyword: { type: 'keyword' },
            ngram: {
              type: 'text',
              analyzer: 'ngram_analyzer',
            },
          },
        },
        legal_name: {
          type: 'text',
          analyzer: 'company_name_analyzer',
        },
        all_names: {
          type: 'text',
          analyzer: 'company_name_analyzer',
        },
        phone_numbers: { type: 'keyword' },
        phone_numbers_raw: { type: 'keyword' },
        facebook_id: { type: 'keyword' },
        facebook_url: { type: 'keyword' },
        emails: { type: 'keyword' },
        primary_email: { type: 'keyword' },
        short_description: { type: 'text' },
        technologies: { type: 'keyword' },
        social_links: { type: 'object', enabled: false },
        addresses: { type: 'object', enabled: false },
        logo_url: { type: 'keyword' },
        industry_keywords: { type: 'keyword' },
        year_founded: { type: 'integer' },
        crawl_status: { type: 'keyword' },
      },
    },
  });

  logger.info(`Created index: ${INDEX_NAME} with custom analyzers`);

  // Bulk index
  const body = profiles.flatMap((p) => [
    { index: { _index: INDEX_NAME, _id: p.domain } },
    {
      domain: p.domain,
      commercial_name: p.commercial_name,
      legal_name: p.legal_name,
      all_names: p.all_names.join(' '),
      phone_numbers: p.phone_numbers,
      phone_numbers_raw: p.phone_numbers_raw,
      facebook_id: p.facebook_id,
      facebook_url: p.facebook_url,
      emails: p.emails,
      primary_email: p.primary_email,
      short_description: p.short_description,
      technologies: p.technologies,
      social_links: p.social_links,
      addresses: p.addresses,
      logo_url: p.logo_url,
      industry_keywords: p.industry_keywords,
      year_founded: p.year_founded,
      crawl_status: p.crawl_status,
    },
  ]);

  const bulkResult = await client.bulk({ operations: body, refresh: true });

  if (bulkResult.errors) {
    const errorItems = bulkResult.items.filter((item) => item.index?.error);
    logger.error(`Bulk index had ${errorItems.length} errors`);
    // Log first 3 errors
    for (const item of errorItems.slice(0, 3)) {
      logger.error(`  ${item.index?._id}: ${JSON.stringify(item.index?.error)}`);
    }
  }

  const count = await client.count({ index: INDEX_NAME });
  logger.info(`Indexed ${count.count} documents into ${INDEX_NAME}`);
}

// Run standalone
if (process.argv[1]?.includes('index-elasticsearch')) {
  const raw = readFileSync('output/normalized-profiles.json', 'utf-8');
  const profiles: CompanyProfile[] = JSON.parse(raw);
  indexElasticsearch(profiles).catch((err) => {
    logger.error('ES indexing failed:', err);
    process.exit(1);
  });
}
