import { Client } from '@elastic/elasticsearch';
import { config } from '../../../shared/config.js';
import type { CompanyProfile } from '../../../shared/types.js';

const INDEX = config.elasticsearch.index;

interface FuzzyNameResult {
  company: CompanyProfile;
  field: string;
  confidence: number;
  match_source: string;
  es_score: number;
}

/**
 * Fuzzy name matching using ES multi_match with custom company_name_analyzer.
 * Searches commercial_name, legal_name, all_names with boosting.
 * Also includes ngram match for partial names.
 */
export async function fuzzyNameMatch(
  client: Client,
  name: string,
): Promise<FuzzyNameResult | null> {
  const result = await client.search<CompanyProfile>({
    index: INDEX,
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query: name,
              fields: ['commercial_name^3', 'legal_name^2', 'all_names^1'],
              type: 'best_fields',
              fuzziness: 'AUTO',
              prefix_length: 1,
            },
          },
          {
            match: {
              'commercial_name.ngram': {
                query: name,
                boost: 2,
              },
            },
          },
          {
            term: {
              'commercial_name.keyword': {
                value: name,
                boost: 5,
                case_insensitive: true,
              },
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
    size: 1,
  });

  const hit = result.hits.hits[0];
  if (!hit || !hit._score) return null;

  // Normalize ES score to 0-1 confidence
  // ES scores vary widely, so we use a sigmoid-like normalization
  const maxScore = hit._score;
  const confidence = Math.min(maxScore / (maxScore + 5), 0.95); // Caps at 0.95

  return {
    company: hit._source as CompanyProfile,
    field: 'name',
    confidence,
    match_source: 'elasticsearch_fuzzy',
    es_score: maxScore,
  };
}
