import { Client } from '@elastic/elasticsearch';
import { config } from '../../../shared/config.js';
import type { CompanyProfile } from '../../../shared/types.js';

const INDEX = config.elasticsearch.index;

interface ExactMatchResult {
  company: CompanyProfile;
  field: string;
  confidence: number;
  match_source: string;
}

/**
 * Exact domain match — highest confidence.
 */
export async function exactDomainMatch(
  client: Client,
  domain: string,
): Promise<ExactMatchResult | null> {
  const result = await client.search<CompanyProfile>({
    index: INDEX,
    query: { term: { domain: { value: domain } } },
    size: 1,
  });

  const hit = result.hits.hits[0];
  if (!hit) return null;

  return {
    company: hit._source as CompanyProfile,
    field: 'website',
    confidence: 1.0,
    match_source: 'domain_exact',
  };
}

/**
 * Exact phone match.
 */
export async function exactPhoneMatch(
  client: Client,
  phone: string,
): Promise<ExactMatchResult[]> {
  const result = await client.search<CompanyProfile>({
    index: INDEX,
    query: { term: { phone_numbers: { value: phone } } },
    size: 5,
  });

  return result.hits.hits.map((hit) => ({
    company: hit._source as CompanyProfile,
    field: 'phone',
    confidence: 0.95,
    match_source: 'phone_exact',
  }));
}

/**
 * Exact Facebook ID match.
 */
export async function exactFacebookMatch(
  client: Client,
  facebookId: string,
): Promise<ExactMatchResult | null> {
  const result = await client.search<CompanyProfile>({
    index: INDEX,
    query: { term: { facebook_id: { value: facebookId } } },
    size: 1,
  });

  const hit = result.hits.hits[0];
  if (!hit) return null;

  return {
    company: hit._source as CompanyProfile,
    field: 'facebook',
    confidence: 0.90,
    match_source: 'facebook_exact',
  };
}
