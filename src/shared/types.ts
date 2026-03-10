// ─── Core Data Types ──────────────────────────────────────

export interface CompanyProfile {
  id?: string;
  domain: string;
  commercial_name: string | null;
  legal_name: string | null;
  all_names: string[];
  phone_numbers: string[];
  phone_numbers_raw: string[];
  primary_email: string | null;
  emails: string[];
  facebook_url: string | null;
  facebook_id: string | null;
  social_links: SocialLinks;
  addresses: Address[];
  short_description: string | null;
  technologies: string[];
  logo_url: string | null;
  industry_keywords: string[];
  year_founded: number | null;
  crawl_status: 'success' | 'failed' | 'timeout' | 'pending';
  crawl_timestamp: string | null;
}

export interface SocialLinks {
  facebook?: string;
  twitter?: string;
  linkedin?: string;
  instagram?: string;
  youtube?: string;
  [key: string]: string | undefined;
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  raw?: string;
}

// ─── Scraper Types ────────────────────────────────────────

export interface ExtractedDataPoint {
  value: string;
  source_url: string;
  source_element: string;
  extraction_method: string;
  confidence: number;
  extracted_at: string;
}

export interface ScrapeResult {
  domain: string;
  company_name: string | null;
  success: boolean;
  phone_numbers: ExtractedDataPoint[];
  social_links: Record<string, ExtractedDataPoint>;
  addresses: ExtractedDataPoint[];
  emails: ExtractedDataPoint[];
  short_description: ExtractedDataPoint | null;
  technologies: string[];
  logo_url: string | null;
  industry_keywords: string[];
  year_founded: number | null;
  crawl_time_ms: number;
  pages_crawled: string[];
  error?: string;
}

// ─── API Types ────────────────────────────────────────────

export interface MatchInput {
  name?: string;
  website?: string;
  phone_number?: string;
  facebook_profile?: string;
}

export interface NormalizedInput {
  name: string | null;
  domain: string | null;
  phone: string | null;
  facebook_id: string | null;
  usable_fields: string[];
}

export type MatchQuality = 'VERIFIED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN';

export interface MatchResult {
  company: CompanyProfile;
  match_details: {
    confidence_score: number;
    match_quality: MatchQuality;
    matched_on: string[];
    attributes: Record<
      string,
      {
        confidence_score: number;
        match_type: 'Exact' | 'Approximate' | 'Fuzzy';
        match_source: string;
        value: string;
      }
    >;
  };
}

// ─── Data Provenance ──────────────────────────────────────

export interface ProvenanceRecord {
  company_id?: string;
  field_name: string;
  field_value: string;
  source_url: string;
  source_element: string;
  extraction_method: string;
  confidence: number;
  extracted_at: string;
}

// ─── CSV Row Types ────────────────────────────────────────

export interface CompanyNameRow {
  domain: string;
  company_commercial_name: string;
  company_legal_name: string;
  company_all_available_names: string;
}

export interface ApiInputRow {
  'input name': string;
  'input phone': string;
  'input website': string;
  input_facebook: string;
}
