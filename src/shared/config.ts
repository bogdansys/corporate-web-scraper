import dotenv from 'dotenv';
dotenv.config();

export const config = {
  supabase: {
    url: process.env.VITE_SUPABASE_URL || 'https://kdqzwmtuaxkyicyquvvl.supabase.co',
    key:
      process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      process.env.SUPABASE_KEY ||
      '',
  },
  elasticsearch: {
    url: process.env.ES_URL || 'http://localhost:9200',
    index: 'companies',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  },
  scraper: {
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '50', 10),
    timeout: parseInt(process.env.SCRAPER_TIMEOUT || '7000', 10),
    retries: parseInt(process.env.SCRAPER_RETRIES || '1', 10),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    maxSubpages: 3, // Capped by 10s subpage budget — time is the real limiter
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    concurrency: parseInt(process.env.GEMINI_CONCURRENCY || '5', 10),
    qualityThreshold: parseInt(process.env.GEMINI_QUALITY_THRESHOLD || '70', 10),
  },
  pinchtab: {
    url: process.env.PINCHTAB_URL || 'http://localhost:9867',
    concurrency: parseInt(process.env.PINCHTAB_CONCURRENCY || '8', 10),
  },
};
