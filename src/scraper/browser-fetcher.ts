import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { FetchResult } from './fetcher.js';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Launch a shared browser instance (reused across all Tier 2 fetches).
 */
export async function launchBrowser(): Promise<void> {
  if (browser) return;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
}

/**
 * Close the shared browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  context = null;
  browser = null;
}

/**
 * Fetch a page using a headless browser. Waits for network idle
 * so JS-rendered content is available, then returns the full rendered HTML.
 */
export async function fetchPageWithBrowser(url: string): Promise<FetchResult> {
  if (!context) throw new Error('Browser not launched — call launchBrowser() first');

  const start = Date.now();
  const page = await context.newPage();

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 12_000,
    });

    // Give JS a short window to render dynamic content, but don't wait forever
    await page.waitForTimeout(2000);

    if (!response) {
      return { html: null, url, status: null, error: 'No response', timeMs: Date.now() - start };
    }

    const status = response.status();
    if (status >= 400) {
      return { html: null, url, status, error: `HTTP ${status}`, timeMs: Date.now() - start };
    }

    const html = await page.content();

    // Check if page has meaningful content (not just an empty shell)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyText = await page.evaluate(() => (globalThis as any).document.body?.innerText?.trim() || '');
    if (bodyText.length < 50) {
      return { html: null, url, status, error: 'Page has no meaningful content', timeMs: Date.now() - start };
    }

    return { html, url, status, timeMs: Date.now() - start };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { html: null, url, status: null, error: errorMsg, timeMs: Date.now() - start };
  } finally {
    await page.close().catch(() => {});
  }
}
