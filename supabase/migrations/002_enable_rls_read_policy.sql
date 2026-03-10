-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_runs ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read access to companies (for dashboard)
CREATE POLICY "Allow anonymous read access" ON companies
  FOR SELECT USING (true);

-- Allow anonymous read access to crawl_runs
CREATE POLICY "Allow anonymous read access" ON crawl_runs
  FOR SELECT USING (true);

-- Restrict data_provenance to authenticated only
CREATE POLICY "Allow authenticated read access" ON data_provenance
  FOR SELECT USING (auth.role() = 'authenticated');
