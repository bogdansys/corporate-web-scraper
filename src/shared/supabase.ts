import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

if (!config.supabase.url || !config.supabase.key) {
  throw new Error('Missing Supabase URL or key. Check your .env file.');
}

export const supabase = createClient(config.supabase.url, config.supabase.key);
