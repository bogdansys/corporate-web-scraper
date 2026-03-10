import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Square, Terminal, Loader2, CheckCircle, XCircle, Trash2, DatabaseZap } from 'lucide-react';

type JobName = 'scrape' | 'scrape-50' | 'pipeline' | 'analyze' | 'match-test' | 'scrape-and-import';

interface Job {
  key: JobName;
  label: string;
  description: string;
  step: number;
  accent?: boolean;
}

const JOBS: Job[] = [
  { key: 'scrape', label: 'Scrape', description: 'Crawl all 997 domains (Tier 1 HTTP + Tier 3 AI)', step: 1 },
  { key: 'pipeline', label: 'Pipeline', description: 'Merge → Normalize → Supabase → ElasticSearch', step: 2 },
  { key: 'analyze', label: 'Analyze', description: 'Generate crawl coverage & fill rate report', step: 3 },
  { key: 'match-test', label: 'Match Test', description: 'Run 32 test inputs against the match API', step: 4 },
  { key: 'scrape-and-import', label: 'Scrape + Import', description: 'Full workflow: Scrape all domains then run pipeline', step: 5, accent: true },
  { key: 'scrape-50', label: 'Quick Scrape', description: 'Demo mode — scrape 50 domains only', step: 0 },
];

interface LogEntry {
  text: string;
  type: 'log' | 'status' | 'done' | 'error';
  time: string;
}

export function RunPanel() {
  const [activeJob, setActiveJob] = useState<JobName | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [jobStatus, setJobStatus] = useState<Record<string, 'idle' | 'running' | 'done' | 'error'>>({});
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });

  const runJob = (job: JobName) => {
    if (activeJob) return;

    setActiveJob(job);
    setJobStatus((s) => ({ ...s, [job]: 'running' }));

    const jobLabel = JOBS.find((j) => j.key === job)!.label;
    setLogs((prev) => [...prev, { text: `--- ${jobLabel} started ---`, type: 'status', time: timestamp() }]);

    const es = new EventSource(`/api/run/${job}`);
    eventSourceRef.current = es;

    es.addEventListener('log', (e) => {
      const text = JSON.parse(e.data) as string;
      setLogs((prev) => [...prev, { text, type: 'log', time: timestamp() }]);
    });

    es.addEventListener('status', (e) => {
      const text = JSON.parse(e.data) as string;
      setLogs((prev) => [...prev, { text, type: 'status', time: timestamp() }]);
    });

    es.addEventListener('done', (e) => {
      const text = JSON.parse(e.data) as string;
      setLogs((prev) => [...prev, { text, type: 'done', time: timestamp() }]);
      setJobStatus((s) => ({ ...s, [job]: 'done' }));
    });

    es.addEventListener('error', (e) => {
      if (e instanceof MessageEvent) {
        const text = JSON.parse(e.data) as string;
        setLogs((prev) => [...prev, { text, type: 'error', time: timestamp() }]);
      }
      setJobStatus((s) => ({ ...s, [job]: 'error' }));
    });

    es.addEventListener('close', () => {
      es.close();
      eventSourceRef.current = null;
      setActiveJob(null);
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setActiveJob(null);
        eventSourceRef.current = null;
      }
    };
  };

  const stopJob = async () => {
    if (!activeJob) return;

    try {
      await fetch(`/api/run/${activeJob}/stop`, { method: 'POST' });
    } catch { /* ignore */ }

    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    setLogs((prev) => [...prev, { text: `--- ${activeJob} stopped by user ---`, type: 'error', time: timestamp() }]);
    setJobStatus((s) => ({ ...s, [activeJob]: 'idle' }));
    setActiveJob(null);
  };

  const clearLogs = () => setLogs([]);

  const [clearing, setClearing] = useState(false);

  const clearDatabase = async () => {
    if (activeJob || clearing) return;
    if (!window.confirm('Clear all data? This removes Supabase tables + local output files.')) return;

    setClearing(true);
    setLogs((prev) => [...prev, { text: '--- Clearing database ---', type: 'status', time: timestamp() }]);

    try {
      const res = await fetch('/api/clear-db', { method: 'POST' });
      const data = await res.json();
      setLogs((prev) => [...prev, { text: `Database cleared: ${JSON.stringify(data.results)}`, type: 'done', time: timestamp() }]);
    } catch (err) {
      setLogs((prev) => [...prev, { text: `Failed to clear database: ${err}`, type: 'error', time: timestamp() }]);
    } finally {
      setClearing(false);
    }
  };

  const statusIcon = (job: JobName) => {
    const s = jobStatus[job];
    if (s === 'running') return <Loader2 size={14} className="animate-spin text-[#FBB03B]" />;
    if (s === 'done') return <CheckCircle size={14} className="text-emerald-600" />;
    if (s === 'error') return <XCircle size={14} className="text-red-600" />;
    return <Play size={14} className="text-gray-400" />;
  };

  const logColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'done': return 'text-emerald-400';
      case 'error': return 'text-red-400';
      case 'status': return 'text-[#FBB03B]';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="bg-[#f5f5f5] border border-gray-200 rounded-none p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 bg-[#0000FF] rounded-none" />
        <h3 className="text-base font-semibold text-gray-900 tracking-tight flex items-center gap-2">
          <Terminal size={18} className="text-gray-600" />
          Command Center
        </h3>
      </div>

      {/* Job buttons */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        {JOBS.map((job) => (
          <button
            key={job.key}
            onClick={() => runJob(job.key)}
            disabled={activeJob !== null}
            className={`
              border rounded-none p-3 text-left transition-all group
              ${job.accent ? 'bg-[#FBB03B]/5' : 'bg-white'}
              ${activeJob === job.key
                ? 'border-[#FBB03B] shadow-sm'
                : activeJob
                  ? 'border-gray-200 opacity-50 cursor-not-allowed'
                  : job.accent
                    ? 'border-[#FBB03B] hover:border-[#FBB03B] hover:shadow-sm cursor-pointer'
                    : 'border-gray-300 hover:border-[#0000FF] hover:shadow-sm cursor-pointer'
              }
            `}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-mono">#{job.step}</span>
                <span className={`text-sm font-medium ${job.accent ? 'text-[#b87a00]' : 'text-gray-900'}`}>{job.label}</span>
              </div>
              {statusIcon(job.key)}
            </div>
            <p className="text-xs text-gray-500 leading-tight">{job.description}</p>
          </button>
        ))}
      </div>

      {/* Stop / Clear buttons */}
      <div className="flex items-center gap-2 mb-3">
        {activeJob && (
          <button
            onClick={stopJob}
            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-none transition-colors flex items-center gap-1"
          >
            <Square size={12} />
            Stop {JOBS.find((j) => j.key === activeJob)?.label}
          </button>
        )}
        {logs.length > 0 && !activeJob && (
          <button
            onClick={clearLogs}
            className="px-3 py-1.5 text-xs bg-white hover:bg-gray-50 text-gray-600 border border-gray-300 rounded-none transition-colors flex items-center gap-1"
          >
            <Trash2 size={12} />
            Clear Logs
          </button>
        )}
        {!activeJob && !clearing && (
          <button
            onClick={clearDatabase}
            className="px-3 py-1.5 text-xs bg-white hover:bg-red-50 text-red-600 border border-red-300 rounded-none transition-colors flex items-center gap-1"
          >
            <DatabaseZap size={12} />
            Clear Database
          </button>
        )}
        {clearing && (
          <span className="text-xs text-red-500 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            Clearing database...
          </span>
        )}
        {activeJob && (
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            {JOBS.find((j) => j.key === activeJob)?.label} running...
          </span>
        )}
      </div>

      {/* Log viewer */}
      <div className="bg-gray-900 border border-gray-700 rounded-none p-3 h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-600">Click a step above to run it. Logs will appear here.</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-gray-600 shrink-0">{log.time}</span>
              <span className={logColor(log.type)}>{log.text}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Workflow hint */}
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <span>Workflow:</span>
        {JOBS.map((job, i) => (
          <span key={job.key} className="flex items-center gap-1">
            <span className={`font-medium ${jobStatus[job.key] === 'done' ? 'text-emerald-600' : 'text-gray-500'}`}>
              {job.label}
            </span>
            {i < JOBS.length - 1 && <span className="text-gray-300">→</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
