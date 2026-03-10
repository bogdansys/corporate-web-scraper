import { Router, type Request, type Response } from 'express';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../../shared/logger.js';
import { supabase } from '../../shared/supabase.js';

const router = Router();

// Track running processes
const running: Map<string, { process: ChildProcess; startedAt: number }> = new Map();

type JobName = 'scrape' | 'scrape-50' | 'pipeline' | 'analyze' | 'match-test' | 'scrape-and-import';

const COMMANDS: Record<JobName, { cmd: string; args: string[]; label: string; chain?: JobName }> = {
  scrape: { cmd: 'npx', args: ['tsx', 'src/scraper/index.ts', '--tier2', '--tier3'], label: 'Scraper' },
  'scrape-50': { cmd: 'npx', args: ['tsx', 'src/scraper/index.ts', '--tier2', '--tier3', '--limit', '50'], label: 'Scraper (50)' },
  pipeline: { cmd: 'npx', args: ['tsx', 'src/pipeline/index.ts'], label: 'Pipeline' },
  analyze: { cmd: 'npx', args: ['tsx', 'src/analysis/report.ts'], label: 'Analysis Report' },
  'match-test': { cmd: 'npx', args: ['tsx', 'src/analysis/match-test.ts'], label: 'Match Rate Test' },
  'scrape-and-import': { cmd: 'npx', args: ['tsx', 'src/scraper/index.ts', '--tier2', '--tier3'], label: 'Scrape + Import', chain: 'pipeline' },
};

function isValidJob(job: string): job is JobName {
  return job in COMMANDS;
}

/**
 * GET /api/run/:job
 * SSE endpoint — spawns the job and streams stdout/stderr as events.
 */
router.get('/run/:job', (req: Request, res: Response) => {
  const job = req.params.job as string;

  if (!isValidJob(job)) {
    res.status(400).json({ error: `Unknown job: ${job}. Valid: ${Object.keys(COMMANDS).join(', ')}` });
    return;
  }

  if (running.has(job)) {
    res.status(409).json({ error: `${COMMANDS[job].label} is already running` });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const { cmd, args, label } = COMMANDS[job];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.FORCE_COLOR = '0';

  if (job === 'match-test') {
    env.API_URL = `http://localhost:${process.env.PORT || 3000}`;
  }

  const send = (type: string, data: string) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('status', `Starting ${label}...`);
  logger.info(`[runner] Starting job: ${job}`);

  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  running.set(job, { process: child, startedAt: Date.now() });

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      send('log', line);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      send('log', line);
    }
  });

  child.on('close', (code) => {
    const elapsed = running.has(job) ? ((Date.now() - running.get(job)!.startedAt) / 1000).toFixed(1) : '?';
    running.delete(job);

    if (code === 0) {
      send('done', `${label} completed in ${elapsed}s`);
      logger.info(`[runner] Job ${job} completed in ${elapsed}s`);

      // Chain: if this job has a follow-up, spawn it automatically
      const chainJob = COMMANDS[job].chain;
      if (chainJob && COMMANDS[chainJob]) {
        const next = COMMANDS[chainJob];
        send('status', `Chaining → ${next.label}...`);
        logger.info(`[runner] Chaining ${job} → ${chainJob}`);

        const nextChild = spawn(next.cmd, next.args, {
          cwd: process.cwd(),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        });

        running.set(job, { process: nextChild, startedAt: Date.now() });

        nextChild.stdout?.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) send('log', line);
        });
        nextChild.stderr?.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) send('log', line);
        });
        nextChild.on('close', (nextCode) => {
          const nextElapsed = running.has(job) ? ((Date.now() - running.get(job)!.startedAt) / 1000).toFixed(1) : '?';
          running.delete(job);
          if (nextCode === 0) {
            send('done', `${next.label} completed in ${nextElapsed}s`);
          } else {
            send('error', `${next.label} failed with exit code ${nextCode}`);
          }
          res.write('event: close\ndata: "end"\n\n');
          res.end();
        });
        nextChild.on('error', (err) => {
          running.delete(job);
          send('error', `Failed to start ${next.label}: ${err.message}`);
          res.write('event: close\ndata: "end"\n\n');
          res.end();
        });
        return; // Don't close the SSE stream yet
      }
    } else {
      send('error', `${label} failed with exit code ${code}`);
      logger.error(`[runner] Job ${job} failed with code ${code}`);
    }

    res.write('event: close\ndata: "end"\n\n');
    res.end();
  });

  child.on('error', (err) => {
    running.delete(job);
    send('error', `Failed to start: ${err.message}`);
    res.write('event: close\ndata: "end"\n\n');
    res.end();
  });

  // If client disconnects, kill the process
  req.on('close', () => {
    if (child.exitCode === null) {
      logger.info(`[runner] Client disconnected, killing ${job}`);
      child.kill('SIGTERM');
      running.delete(job);
    }
  });
});

/**
 * GET /api/run/status
 * Returns which jobs are currently running.
 */
router.get('/run-status', (_req: Request, res: Response) => {
  const status: Record<string, { running: boolean; elapsed_s?: number }> = {};
  for (const job of Object.keys(COMMANDS)) {
    const r = running.get(job);
    status[job] = r
      ? { running: true, elapsed_s: Math.round((Date.now() - r.startedAt) / 1000) }
      : { running: false };
  }
  res.json(status);
});

/**
 * POST /api/run/:job/stop
 * Kill a running job.
 */
router.post('/run/:job/stop', (req: Request, res: Response) => {
  const job = req.params.job as string;
  const r = running.get(job);

  if (!r) {
    res.status(404).json({ error: `${job} is not running` });
    return;
  }

  r.process.kill('SIGTERM');
  running.delete(job);
  logger.info(`[runner] Killed job: ${job}`);
  res.json({ message: `${job} stopped` });
});

/**
 * POST /api/clear-db
 * Truncate all Supabase tables (companies, data_provenance, crawl_runs).
 */
router.post('/clear-db', async (_req: Request, res: Response) => {
  logger.info('[runner] Clearing all Supabase tables...');

  const tables = ['data_provenance', 'crawl_runs', 'companies'] as const;
  const results: Record<string, string> = {};

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    results[table] = error ? `error: ${error.message}` : 'cleared';
    if (error) {
      logger.error(`[runner] Failed to clear ${table}:`, error.message);
    }
  }

  // Clear local output files (resolve from cwd to handle any working directory)
  const outputDir = resolve(process.cwd(), 'output');
  const outputFiles = [
    'scrape-results.json',
    'merged-profiles.json',
    'normalized-profiles.json',
    'crawl-report.json',
  ];
  for (const name of outputFiles) {
    const filePath = resolve(outputDir, name);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
        results[name] = 'deleted';
      } catch {
        results[name] = 'failed to delete';
      }
    }
  }

  logger.info('[runner] Database + outputs cleared:', results);
  res.json({ message: 'Database and outputs cleared', results });
});

export default router;
