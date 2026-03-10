import { Router } from 'express';
import { readFileSync } from 'fs';
import { supabase } from '../../shared/supabase.js';
import { logger } from '../../shared/logger.js';

const router = Router();

router.get('/stats', async (_req, res) => {
  try {
    // Crawl stats from Supabase (latest crawl run)
    let crawlData = null;
    try {
      const { data: latestRun } = await supabase
        .from('crawl_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (latestRun) {
        crawlData = {
          summary: {
            total_domains: latestRun.total_domains,
            crawled: latestRun.successful,
            failed: latestRun.failed,
            coverage_pct: latestRun.total_domains > 0
              ? ((latestRun.successful / latestRun.total_domains) * 100).toFixed(1)
              : '0.0',
          },
          timing: {
            total_crawl_time_s: ((latestRun.total_time_ms || 0) / 1000).toFixed(1),
            avg_crawl_time_ms: latestRun.metadata?.avg_crawl_time_ms || 0,
          },
          fill_rates: latestRun.metadata?.fill_rates || {},
          error_breakdown: latestRun.metadata?.error_breakdown || {},
          total_pages_crawled: latestRun.metadata?.total_pages_crawled || 0,
          run_id: latestRun.id,
          completed_at: latestRun.completed_at,
        };
      }
    } catch {
      // No crawl runs yet
    }

    // Match results still from JSON (no dedicated table)
    let matchResults = null;
    try {
      matchResults = JSON.parse(readFileSync('output/match-results.json', 'utf-8'));
    } catch {
      // Match test not yet run
    }

    res.json({
      crawl: crawlData,
      matching: matchResults
        ? {
            total_inputs: matchResults.total,
            matched: matchResults.matched,
            match_rate: matchResults.match_rate,
            avg_confidence: matchResults.avg_confidence,
          }
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
