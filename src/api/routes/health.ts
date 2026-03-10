import { Router } from 'express';
import { Client } from '@elastic/elasticsearch';
import { config } from '../../shared/config.js';
import { supabase } from '../../shared/supabase.js';

const router = Router();

router.get('/health', async (_req, res) => {
  const status: Record<string, string> = { api: 'ok' };

  // Check Elasticsearch
  try {
    const client = new Client({ node: config.elasticsearch.url });
    await client.ping();
    status.elasticsearch = 'ok';
  } catch {
    status.elasticsearch = 'unavailable';
  }

  // Check Supabase
  try {
    const { error } = await supabase
      .from('companies')
      .select('id', { count: 'exact', head: true });
    status.supabase = error ? 'unavailable' : 'ok';
  } catch {
    status.supabase = 'unavailable';
  }

  const allOk = Object.values(status).every((s) => s === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    services: status,
    timestamp: new Date().toISOString(),
  });
});

export default router;
