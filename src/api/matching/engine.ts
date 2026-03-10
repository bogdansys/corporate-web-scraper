import { Client } from '@elastic/elasticsearch';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';
import { normalizeMatchInput } from './normalizer.js';
import { exactDomainMatch, exactPhoneMatch, exactFacebookMatch } from './strategies/exact.js';
import { fuzzyNameMatch } from './strategies/fuzzy-name.js';
import { compositeMatch } from './strategies/composite.js';
import { getMatchQuality, calculateWeightedConfidence } from './scorer.js';
import type { MatchInput, MatchResult, CompanyProfile } from '../../shared/types.js';

let esClient: Client | null = null;

function getClient(): Client {
  if (!esClient) {
    esClient = new Client({ node: config.elasticsearch.url });
  }
  return esClient;
}

/**
 * Build a Veridion-style match response.
 */
function buildMatchResult(
  company: CompanyProfile,
  matchedFields: string[],
  fieldConfidences: Record<string, { score: number; type: string; source: string; value: string }>,
): MatchResult {
  const confidenceValues: Record<string, number> = {};
  for (const [field, data] of Object.entries(fieldConfidences)) {
    confidenceValues[field] = data.score;
  }

  const overallConfidence = calculateWeightedConfidence(confidenceValues);
  const matchQuality = getMatchQuality(overallConfidence, matchedFields);

  const attributes: MatchResult['match_details']['attributes'] = {};
  for (const [field, data] of Object.entries(fieldConfidences)) {
    attributes[field] = {
      confidence_score: data.score,
      match_type: data.type as 'Exact' | 'Approximate' | 'Fuzzy',
      match_source: data.source,
      value: data.value,
    };
  }

  return {
    company,
    match_details: {
      confidence_score: parseFloat(overallConfidence.toFixed(4)),
      match_quality: matchQuality,
      matched_on: matchedFields,
      attributes,
    },
  };
}

/**
 * Main matching engine. Orchestrates the matching pipeline:
 * 1. Normalize input
 * 2. Try exact domain match (fastest, most reliable)
 * 3. Try exact phone match
 * 4. Try exact Facebook match
 * 5. Try composite multi-field query
 * 6. Fall back to fuzzy name-only
 */
export async function matchCompany(input: MatchInput): Promise<MatchResult | null> {
  const client = getClient();
  const normalized = normalizeMatchInput(input);

  logger.debug(`Matching: ${JSON.stringify(normalized)}`);

  if (normalized.usable_fields.length === 0) {
    logger.debug('No usable fields after normalization');
    return null;
  }

  // Strategy 1: Exact domain match (highest reliability)
  if (normalized.domain) {
    const domainResult = await exactDomainMatch(client, normalized.domain);
    if (domainResult) {
      const fieldConfidences: Record<string, { score: number; type: string; source: string; value: string }> = {
        website: { score: 1.0, type: 'Exact', source: 'domain_normalized', value: normalized.domain },
      };

      // If we also have name, check if it matches
      if (normalized.name && domainResult.company.commercial_name) {
        fieldConfidences.company_name = {
          score: 0.8,
          type: 'Approximate',
          source: 'domain_co_occurrence',
          value: domainResult.company.commercial_name,
        };
      }

      return buildMatchResult(domainResult.company, ['website'], fieldConfidences);
    }
  }

  // Strategy 2: Exact phone match
  if (normalized.phone) {
    const phoneResults = await exactPhoneMatch(client, normalized.phone);
    if (phoneResults.length === 1) {
      // Single match — high confidence
      const fieldConfidences: Record<string, { score: number; type: string; source: string; value: string }> = {
        phone: { score: 0.95, type: 'Exact', source: 'phone_e164', value: normalized.phone },
      };
      return buildMatchResult(phoneResults[0].company, ['phone'], fieldConfidences);
    } else if (phoneResults.length > 1 && (normalized.name || normalized.facebook_id)) {
      // Multiple matches — need disambiguation via composite
      logger.debug(`Phone ${normalized.phone} matched ${phoneResults.length} companies, using composite for disambiguation`);
    }
  }

  // Strategy 3: Exact Facebook match
  if (normalized.facebook_id) {
    const fbResult = await exactFacebookMatch(client, normalized.facebook_id);
    if (fbResult) {
      const fieldConfidences: Record<string, { score: number; type: string; source: string; value: string }> = {
        facebook: { score: 0.90, type: 'Exact', source: 'facebook_id', value: normalized.facebook_id },
      };
      return buildMatchResult(fbResult.company, ['facebook'], fieldConfidences);
    }
  }

  // Strategy 4: Composite multi-field query (when multiple fields available)
  if (normalized.usable_fields.length >= 2) {
    const compResult = await compositeMatch(client, normalized);
    if (compResult && compResult.confidence > 0.3) {
      const fieldConfidences: Record<string, { score: number; type: string; source: string; value: string }> = {};

      for (const field of compResult.matched_fields) {
        if (field === 'website') {
          fieldConfidences.website = { score: 1.0, type: 'Exact', source: 'domain_normalized', value: normalized.domain! };
        } else if (field === 'phone') {
          fieldConfidences.phone = { score: 0.95, type: 'Exact', source: 'phone_e164', value: normalized.phone! };
        } else if (field === 'facebook') {
          fieldConfidences.facebook = { score: 0.90, type: 'Exact', source: 'facebook_id', value: normalized.facebook_id! };
        } else if (field === 'name') {
          fieldConfidences.company_name = {
            score: compResult.confidence,
            type: 'Fuzzy',
            source: 'elasticsearch_fuzzy',
            value: compResult.company.commercial_name || normalized.name!,
          };
        }
      }

      return buildMatchResult(compResult.company, compResult.matched_fields, fieldConfidences);
    }
  }

  // Strategy 5: Fuzzy name-only (last resort)
  if (normalized.name) {
    const nameResult = await fuzzyNameMatch(client, normalized.name);
    if (nameResult && nameResult.confidence > 0.2) {
      const fieldConfidences: Record<string, { score: number; type: string; source: string; value: string }> = {
        company_name: {
          score: nameResult.confidence,
          type: 'Fuzzy',
          source: 'elasticsearch_fuzzy',
          value: nameResult.company.commercial_name || normalized.name,
        },
      };
      return buildMatchResult(nameResult.company, ['name'], fieldConfidences);
    }
  }

  return null;
}
