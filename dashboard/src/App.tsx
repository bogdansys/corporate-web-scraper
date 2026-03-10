import { useEffect, useState, useCallback, useRef } from 'react';
import { Database, Globe, Phone, Mail, Share2, BarChart3, Loader2, Radio } from 'lucide-react';
import { supabase, fetchCompanies, fetchStats, type Company } from './lib/supabase';
import { StatCard } from './components/StatCard';
import { FillRateChart } from './components/FillRateChart';
import { TechChart } from './components/TechChart';
import { MatchTester } from './components/MatchTester';
import { CompanyTable } from './components/CompanyTable';
import { RunPanel } from './components/RunPanel';
import { CrawlHistory } from './components/CrawlHistory';

type Stats = Awaited<ReturnType<typeof fetchStats>>;

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const data = await fetchCompanies();
      setCompanies(data);
      const s = await fetchStats(data);
      setStats(s);
      setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }));
    } catch (err) {
      console.error('Refresh failed:', err);
    }
  }, []);

  // Debounced refresh — pipeline upserts in batches, don't refetch on every single row
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refreshData();
    }, 2000);
  }, [refreshData]);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchCompanies();
        setCompanies(data);
        const s = await fetchStats(data);
        setStats(s);
        setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    load();

    // Subscribe to Realtime changes on the companies table
    const companiesChannel = supabase
      .channel('companies-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies' },
        () => {
          debouncedRefresh();
        },
      )
      .subscribe((status) => {
        setRealtimeActive(status === 'SUBSCRIBED');
      });

    // Subscribe to crawl_runs changes (CrawlHistory handles its own data,
    // but we refresh stats when a new run completes)
    const crawlRunsChannel = supabase
      .channel('crawl-runs-app')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'crawl_runs' },
        () => {
          debouncedRefresh();
        },
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(companiesChannel);
      supabase.removeChannel(crawlRunsChannel);
    };
  }, [debouncedRefresh]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 text-[#FBB03B] animate-spin" />
        <span className="ml-3 text-gray-500">Loading company data from Supabase...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="bg-red-50 border border-red-200 rounded-none p-6 max-w-md text-center">
          <p className="text-red-700 font-semibold">Error loading data</p>
          <p className="text-gray-500 text-sm mt-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-4 py-6 md:px-8">
      {/* Header — Veridion-branded */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Veridion-style logo mark — orange dash */}
            <div className="flex items-center gap-2">
              <div className="w-10 h-3 bg-[#FBB03B] rounded-sm" />
              <span className="text-xl font-bold text-gray-900 tracking-tight">veridion</span>
            </div>
            <div className="h-6 w-px bg-gray-300" />
            <span className="text-sm text-gray-500 font-medium">SWE Challenge</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">Iordache Mihai Bogdan</p>
            <p className="text-xs text-gray-400">Application for Software Engineer</p>
          </div>
        </div>
        <div className="mt-3 border-b-2 border-[#FBB03B]" />
        <div className="flex items-center justify-between mt-3">
          <p className="text-gray-500 text-sm">Company Data Intelligence Dashboard — Crawl Analytics, Match Testing & Data Explorer</p>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
            <Radio size={12} className={realtimeActive ? 'text-emerald-500' : 'text-gray-300'} />
            <span>{realtimeActive ? 'Realtime' : 'Connecting...'}</span>
            {lastSync && <span className="text-gray-300">| {lastSync}</span>}
          </div>
        </div>
      </header>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <StatCard
            title="Total Companies"
            value={stats.total}
            icon={<Database size={18} />}
            color="text-[#FBB03B]"
          />
          <StatCard
            title="Crawled"
            value={stats.crawled}
            subtitle={`${(stats.crawlRate * 100).toFixed(0)}% success`}
            icon={<Globe size={18} />}
            color="text-[#0000FF]"
          />
          <StatCard
            title="With Phone"
            value={stats.withPhone}
            subtitle={`${(stats.phoneRate * 100).toFixed(0)}% fill rate`}
            icon={<Phone size={18} />}
            color="text-[#1a1a2e]"
          />
          <StatCard
            title="With Email"
            value={stats.withEmail}
            subtitle={`${(stats.emailRate * 100).toFixed(0)}% fill rate`}
            icon={<Mail size={18} />}
            color="text-[#FBB03B]"
          />
          <StatCard
            title="With Social"
            value={stats.withSocial}
            subtitle={`${(stats.socialRate * 100).toFixed(0)}% fill rate`}
            icon={<Share2 size={18} />}
            color="text-emerald-600"
          />
          <StatCard
            title="Facebook IDs"
            value={stats.withFacebook}
            subtitle={`${(stats.facebookRate * 100).toFixed(0)}% matched`}
            icon={<BarChart3 size={18} />}
            color="text-[#0000FF]"
          />
          <StatCard
            title="Addresses"
            value={stats.withAddress}
            subtitle={`${(stats.addressRate * 100).toFixed(0)}% fill rate`}
            icon={<Globe size={18} />}
            color="text-gray-900"
          />
        </div>
      )}

      {/* Charts row */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <FillRateChart stats={stats} />
          <TechChart topTech={stats.topTech} />
        </div>
      )}

      {/* Command Center — run scraper, pipeline, tests from UI */}
      <RunPanel />
      <div className="h-4" />

      {/* Crawl history — shows past runs with metadata */}
      <CrawlHistory />
      <div className="h-4" />

      {/* Match tester */}
      <div className="mb-6">
        <MatchTester />
      </div>

      {/* Company table */}
      <CompanyTable companies={companies} />

      {/* Footer */}
      <footer className="mt-8 text-center pb-4">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-6 h-2 bg-[#FBB03B] rounded-sm" />
          <span className="text-xs font-semibold text-gray-900 tracking-tight">veridion</span>
        </div>
        <p className="text-gray-400 text-xs">
          Built by Iordache Mihai Bogdan — React + Vite + Tailwind + Supabase + ElasticSearch
        </p>
      </footer>
    </div>
  );
}

export default App;
