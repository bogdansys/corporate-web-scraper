-- Migration: create_companies_and_provenance
-- Applied to: kdqzwmtuaxkyicyquvvl (VERIDION project)
-- Date: 2026-03-09

-- Companies table: main company profiles
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  commercial_name TEXT,
  legal_name TEXT,
  all_names TEXT[] DEFAULT '{}',
  phone_numbers TEXT[] DEFAULT '{}',
  phone_numbers_raw TEXT[] DEFAULT '{}',
  primary_email TEXT,
  emails TEXT[] DEFAULT '{}',
  facebook_url TEXT,
  facebook_id TEXT,
  social_links JSONB DEFAULT '{}',
  addresses JSONB DEFAULT '[]',
  short_description TEXT,
  technologies TEXT[] DEFAULT '{}',
  logo_url TEXT,
  industry_keywords TEXT[] DEFAULT '{}',
  year_founded INTEGER,
  crawl_status TEXT DEFAULT 'pending',
  crawl_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Data provenance: track WHERE each data point was extracted from
CREATE TABLE IF NOT EXISTS public.data_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_element TEXT,
  extraction_method TEXT,
  confidence NUMERIC(3,2),
  extracted_at TIMESTAMPTZ DEFAULT now()
);

-- Crawl run metadata
CREATE TABLE IF NOT EXISTS public.crawl_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_domains INTEGER DEFAULT 0,
  successful INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  total_time_ms INTEGER,
  metadata JSONB DEFAULT '{}'
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_companies_domain ON public.companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_phone ON public.companies USING GIN(phone_numbers);
CREATE INDEX IF NOT EXISTS idx_companies_facebook ON public.companies(facebook_id);
CREATE INDEX IF NOT EXISTS idx_companies_commercial_name ON public.companies(commercial_name);
CREATE INDEX IF NOT EXISTS idx_provenance_company ON public.data_provenance(company_id);
CREATE INDEX IF NOT EXISTS idx_provenance_field ON public.data_provenance(field_name);

-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON public.companies USING GIN(commercial_name gin_trgm_ops);

-- Full-text search vector
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION update_company_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.commercial_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.legal_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.domain, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.short_description, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_search_vector ON public.companies;
CREATE TRIGGER trg_company_search_vector
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION update_company_search_vector();

CREATE INDEX IF NOT EXISTS idx_companies_search ON public.companies USING GIN(search_vector);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
