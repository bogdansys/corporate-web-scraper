import { useEffect, useState } from 'react';
import {
  Clock, CheckCircle, XCircle, ChevronDown, ChevronRight,
  Loader2, BarChart3, AlertTriangle,
} from 'lucide-react';
import { supabase, fetchCrawlRuns, type CrawlRun } from '../lib/supabase';

export function CrawlHistory() {
  const [runs, setRuns] = useState<CrawlRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const loadRuns = async () => {
    try {
      const data = await fetchCrawlRuns();
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();

    // Realtime subscription on crawl_runs
    const channel = supabase
      .channel('crawl-runs-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crawl_runs' },
        () => {
          loadRuns();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const formatDuration = (ms: number | null): string => {
    if (!ms) return '—';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const successRate = (run: CrawlRun): number => {
    if (run.total_domains === 0) return 0;
    return (run.successful / run.total_domains) * 100;
  };

  if (loading) {
    return (
      <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading crawl history...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 bg-[#FBB03B] rounded-none" />
        <h3 className="text-base font-semibold text-gray-900 tracking-tight flex items-center gap-2">
          <Clock size={18} className="text-gray-600" />
          Crawl History
        </h3>
        <span className="text-xs text-gray-400">({runs.length} runs)</span>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No crawl runs yet. Run the pipeline to populate.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const rate = successRate(run);
            const isExpanded = expandedRun === run.id;

            return (
              <div key={run.id} className="bg-white border border-gray-200 rounded-none">
                {/* Run summary row */}
                <button
                  onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                    <span className="text-sm text-gray-900 font-medium shrink-0">
                      {formatDate(run.started_at)}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {formatDuration(run.total_time_ms)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Success/fail counts */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle size={12} /> {run.successful}
                      </span>
                      <span className="flex items-center gap-1 text-red-500">
                        <XCircle size={12} /> {run.failed}
                      </span>
                    </div>

                    {/* Success rate bar */}
                    <div className="w-24 h-2 bg-gray-200 rounded-none overflow-hidden shrink-0">
                      <div
                        className={`h-full rounded-none transition-all ${
                          rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-gray-500 w-10 text-right">{rate.toFixed(0)}%</span>
                  </div>
                </button>

                {/* Expanded metadata */}
                {isExpanded && (
                  <div className="border-t border-gray-200 p-3 space-y-3">
                    {/* Timing */}
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-gray-400 uppercase tracking-wide">Total Domains</span>
                        <p className="text-gray-900 font-medium mt-0.5">{run.total_domains}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase tracking-wide">Avg Crawl Time</span>
                        <p className="text-gray-900 font-medium mt-0.5">
                          {run.metadata?.avg_crawl_time_ms ? `${Math.round(run.metadata.avg_crawl_time_ms)}ms` : '—'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase tracking-wide">Pages Crawled</span>
                        <p className="text-gray-900 font-medium mt-0.5">
                          {run.metadata?.total_pages_crawled || '—'}
                        </p>
                      </div>
                    </div>

                    {/* Fill rates */}
                    {run.metadata?.fill_rates && Object.keys(run.metadata.fill_rates).length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <BarChart3 size={12} className="text-[#0000FF]" />
                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Fill Rates</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {Object.entries(run.metadata.fill_rates)
                            .sort(([, a], [, b]) => b - a)
                            .map(([field, rate]) => (
                              <div key={field} className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 capitalize w-20 truncate">{field.replace(/_/g, ' ')}</span>
                                <div className="flex-1 h-1.5 bg-gray-200 rounded-none overflow-hidden">
                                  <div
                                    className="h-full bg-[#0000FF] rounded-none"
                                    style={{ width: `${Math.round(rate * 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-mono text-gray-500 w-8 text-right">{Math.round(rate * 100)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Error breakdown */}
                    {run.metadata?.error_breakdown && Object.keys(run.metadata.error_breakdown).length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <AlertTriangle size={12} className="text-amber-500" />
                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Error Breakdown</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(run.metadata.error_breakdown)
                            .sort(([, a], [, b]) => b - a)
                            .map(([errorType, count]) => (
                              <span key={errorType} className="px-2 py-0.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded-none">
                                {errorType}: {count}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Run ID + completion timestamp */}
                    <div className="text-xs text-gray-400 flex items-center gap-3 pt-1 border-t border-gray-100">
                      <span className="font-mono">ID: {run.id.slice(0, 8)}...</span>
                      {run.completed_at && (
                        <span>Completed: {new Date(run.completed_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
