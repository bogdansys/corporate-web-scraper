import { config } from '../shared/config.js';

export interface FetchResult {
  html: string | null;
  url: string;
  status: number | null;
  error?: string;
  timeMs: number;
}

/**
 * Single fetch attempt with timeout.
 */
async function attemptFetch(url: string): Promise<FetchResult> {
  const start = Date.now();

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.scraper.timeout),
      headers: {
        'User-Agent': config.scraper.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        html: null,
        url,
        status: response.status,
        error: `HTTP ${response.status}`,
        timeMs: Date.now() - start,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return {
        html: null,
        url,
        status: response.status,
        error: `Non-HTML content: ${contentType}`,
        timeMs: Date.now() - start,
      };
    }

    const html = await response.text();
    return {
      html,
      url,
      status: response.status,
      timeMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      html: null,
      url,
      status: null,
      error: errorMsg,
      timeMs: Date.now() - start,
    };
  }
}

/**
 * Fetch a URL with retry support.
 * Only retries on network errors / 5xx — 4xx responses are permanent and won't change on retry.
 */
export async function fetchPage(url: string): Promise<FetchResult> {
  const maxAttempts = 1 + config.scraper.retries;
  let lastResult: FetchResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
    lastResult = await attemptFetch(url);
    if (lastResult.html) return lastResult;
    // Don't retry on 4xx — these are permanent (404, 403, etc.)
    if (lastResult.status && lastResult.status >= 400 && lastResult.status < 500) return lastResult;
  }

  return lastResult!;
}
