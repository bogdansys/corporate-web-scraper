import { Client } from '@elastic/elasticsearch';
import { config } from '../../../shared/config.js';
import type { CompanyProfile, NormalizedInput } from '../../../shared/types.js';

const INDEX = config.elasticsearch.index;

interface CompositeResult {
  company: CompanyProfile;
  matched_fields: string[];
  confidence: number;
  match_source: string;
  es_score: number;
}

/**
 * Composite matching: combine multiple field signals in a single ES bool query.
 * Handles disambiguation when same phone maps to multiple companies.
 */
export async function compositeMatch(
  client: Client,
  input: NormalizedInput,
): Promise<CompositeResult | null> {
  const shouldClauses: object[] = [];
  const matchedFields: string[] = [];

  if (input.domain) {
    shouldClauses.push({ term: { domain: { value: input.domain, boost: 10 } } });
  }

  if (input.phone) {
    shouldClauses.push({ term: { phone_numbers: { value: input.phone, boost: 8 } } });
  }

  if (input.facebook_id) {
    shouldClauses.push({ term: { facebook_id: { value: input.facebook_id, boost: 7 } } });
  }

  if (input.name) {
    shouldClauses.push({
      multi_match: {
        query: input.name,
        fields: ['commercial_name^3', 'legal_name^2', 'all_names'],
        type: 'best_fields',
        fuzziness: 'AUTO',
        boost: 5,
      },
    });
    shouldClauses.push({
      match: {
        'commercial_name.ngram': {
          query: input.name,
          boost: 2,
        },
      },
    });
  }

  if (shouldClauses.length === 0) return null;

  const result = await client.search<CompanyProfile>({
    index: INDEX,
    query: {
      bool: {
        should: shouldClauses,
        minimum_should_match: 1,
      },
    },
    size: 1,
  });

  const hit = result.hits.hits[0];
  if (!hit || !hit._score) return null;

  const company = hit._source as CompanyProfile;

  // Determine which fields actually matched
  if (input.domain && company.domain === input.domain) matchedFields.push('website');
  if (input.phone && company.phone_numbers?.includes(input.phone)) matchedFields.push('phone');
  if (input.facebook_id && company.facebook_id === input.facebook_id) matchedFields.push('facebook');
  if (input.name) matchedFields.push('name'); // Fuzzy — always "matched" if name was provided

  // Calculate confidence based on how many fields matched
  const maxScore = hit._score;
  let confidence = Math.min(maxScore / (maxScore + 5), 0.95);

  // Boost confidence for multi-field agreement
  if (matchedFields.length >= 3) confidence = Math.min(confidence + 0.15, 0.99);
  else if (matchedFields.length >= 2) confidence = Math.min(confidence + 0.10, 0.97);

  return {
    company,
    matched_fields: matchedFields,
    confidence,
    match_source: 'composite_multi_field',
    es_score: maxScore,
  };
}
