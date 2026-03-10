import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kdqzwmtuaxkyicyquvvl.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { params: { eventsPerSecond: 2 } },
});

// ─── Company types ──────────────────────────────

export interface Company {
  id: string;
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
  social_links: Record<string, string>;
  addresses: Array<{ raw?: string; street?: string; city?: string; state?: string; zip?: string }>;
  short_description: string | null;
  technologies: string[];
  logo_url: string | null;
  industry_keywords: string[];
  year_founded: number | null;
  crawl_status: string;
  crawl_timestamp: string | null;
}

// ─── Provenance types ───────────────────────────

export interface ProvenanceRecord {
  id: string;
  company_id: string;
  field_name: string;
  field_value: string;
  source_url: string;
  source_element: string | null;
  extraction_method: string | null;
  confidence: number | null;
  extracted_at: string | null;
}

// ─── Crawl run types ────────────────────────────

export interface CrawlRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  total_domains: number;
  successful: number;
  failed: number;
  total_time_ms: number | null;
  metadata: {
    fill_rates?: Record<string, number>;
    error_breakdown?: Record<string, number>;
    total_pages_crawled?: number;
    avg_crawl_time_ms?: number;
  } | null;
}

// ─── Data fetchers ──────────────────────────────

export async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('domain');
  if (error) throw error;
  return data || [];
}

export async function fetchProvenance(companyId: string): Promise<ProvenanceRecord[]> {
  const { data, error } = await supabase
    .from('data_provenance')
    .select('*')
    .eq('company_id', companyId)
    .order('field_name');
  if (error) throw error;
  return data || [];
}

export async function fetchCrawlRuns(): Promise<CrawlRun[]> {
  const { data, error } = await supabase
    .from('crawl_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function fetchStats(companies: Company[]) {
  const total = companies.length;
  const crawled = companies.filter(c => c.crawl_status === 'success').length;
  const withPhone = companies.filter(c => c.phone_numbers?.length > 0).length;
  const withEmail = companies.filter(c => c.emails?.length > 0).length;
  const withSocial = companies.filter(c => Object.keys(c.social_links || {}).length > 0).length;
  const withFacebook = companies.filter(c => c.facebook_id).length;
  const withDescription = companies.filter(c => c.short_description).length;
  const withAddress = companies.filter(c => c.addresses?.length > 0).length;

  // Technology breakdown
  const techCounts: Record<string, number> = {};
  for (const c of companies) {
    for (const t of c.technologies || []) {
      techCounts[t] = (techCounts[t] || 0) + 1;
    }
  }

  const topTech = Object.entries(techCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  return {
    total,
    crawled,
    crawlRate: total > 0 ? crawled / total : 0,
    withPhone,
    phoneRate: total > 0 ? withPhone / total : 0,
    withEmail,
    emailRate: total > 0 ? withEmail / total : 0,
    withSocial,
    socialRate: total > 0 ? withSocial / total : 0,
    withFacebook,
    facebookRate: total > 0 ? withFacebook / total : 0,
    withDescription,
    descriptionRate: total > 0 ? withDescription / total : 0,
    withAddress,
    addressRate: total > 0 ? withAddress / total : 0,
    topTech,
  };
}
