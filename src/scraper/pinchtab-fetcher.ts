/**
 * PinchTab-based browser fetcher for Tier 2.
 *
 * Uses PinchTab's HTTP API to control multiple isolated Chrome instances.
 * Captures clean text via /text endpoint (token-efficient, stored for Tier 3).
 *
 * Advantages over Playwright:
 * - Multi-instance: each Chrome process is isolated (crash resilience)
 * - Higher concurrency: 8+ parallel instances vs Playwright's 3 shared pages
 * - Token-efficient text extraction built-in
 */

import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

const PINCHTAB_URL = config.pinchtab?.url || 'http://localhost:9867';
const INSTANCE_POOL_SIZE = config.pinchtab?.concurrency || 8;
const HARD_TIMEOUT_MS = 18_000; // Hard timeout for entire fetch operation

interface PinchTabInstance {
  id: string;
  port: string;
  busy: boolean;
}

export interface PinchTabResult {
  text: string | null;
  title: string | null;
  url: string;
  error?: string;
  timeMs: number;
}

let instancePool: PinchTabInstance[] = [];
let serverChecked = false;

/**
 * Check if PinchTab server is running.
 */
export async function isPinchTabRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${PINCHTAB_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await resp.json() as { status: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Launch the instance pool.
 */
export async function launchPinchTabPool(): Promise<void> {
  if (!serverChecked) {
    const running = await isPinchTabRunning();
    if (!running) {
      throw new Error('PinchTab server is not running. Start it with: pinchtab');
    }
    serverChecked = true;
  }

  // Stop any leftover instances from previous runs
  try {
    const resp = await fetch(`${PINCHTAB_URL}/instances`, { signal: AbortSignal.timeout(5000) });
    const existing = await resp.json() as Array<{ id: string; status: string }>;
    for (const inst of existing) {
      if (inst.status === 'running') {
        await fetch(`${PINCHTAB_URL}/instances/${inst.id}/stop`, {
          method: 'POST',
          signal: AbortSignal.timeout(3000),
        }).catch(() => {});
      }
    }
    // Brief wait for cleanup
    if (existing.length > 0) await new Promise((r) => setTimeout(r, 1000));
  } catch {
    // ignore
  }

  // Launch fresh instances
  const toCreate = INSTANCE_POOL_SIZE;
  const launchPromises: Promise<void>[] = [];

  for (let i = 0; i < toCreate; i++) {
    launchPromises.push(
      (async () => {
        try {
          const resp = await fetch(`${PINCHTAB_URL}/instances/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `scraper-${Date.now()}-${i}`,
              mode: 'headless',
            }),
            signal: AbortSignal.timeout(10_000),
          });
          const data = await resp.json() as { id: string; port: string };
          if (data.id) {
            instancePool.push({ id: data.id, port: data.port, busy: false });
          }
        } catch (err) {
          logger.warn(`Failed to launch PinchTab instance: ${err}`);
        }
      })(),
    );
  }

  await Promise.all(launchPromises);

  // Wait for instances to be ready
  await new Promise((r) => setTimeout(r, 2000));

  logger.info(`PinchTab pool ready: ${instancePool.length} instances`);
}

/**
 * Acquire a free instance from the pool. Waits if all busy (max 30s).
 */
async function acquireInstance(): Promise<PinchTabInstance> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const free = instancePool.find((i) => !i.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for free PinchTab instance');
}

function releaseInstance(instance: PinchTabInstance): void {
  instance.busy = false;
}

/**
 * Internal: the actual fetch logic, wrapped separately so we can race it.
 */
async function fetchWithPinchTabInner(
  url: string,
  instance: PinchTabInstance,
): Promise<PinchTabResult> {
  const start = Date.now();

  // Open a new tab with the URL
  const tabResp = await fetch(`${PINCHTAB_URL}/instances/${instance.id}/tabs/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(12_000),
  });
  const tabData = await tabResp.json() as { tabId?: string; title?: string; code?: string; error?: string };

  if (!tabData.tabId) {
    const errMsg = tabData.error || 'Failed to open tab';
    return { text: null, title: null, url, error: errMsg, timeMs: Date.now() - start };
  }

  // Wait for JS rendering
  await new Promise((r) => setTimeout(r, 2000));

  // Get text extraction
  const textResp = await fetch(`${PINCHTAB_URL}/tabs/${tabData.tabId}/text`, {
    signal: AbortSignal.timeout(8_000),
  });
  const textData = await textResp.json() as { text?: string; title?: string; url?: string };

  if (!textData.text || textData.text.length < 50) {
    return {
      text: null,
      title: textData.title || null,
      url,
      error: 'Page has no meaningful content',
      timeMs: Date.now() - start,
    };
  }

  return {
    text: textData.text,
    title: textData.title || tabData.title || null,
    url: textData.url || url,
    timeMs: Date.now() - start,
  };
}

/**
 * Fetch a page using PinchTab: navigate, wait for render, extract text.
 * Wrapped in a hard timeout to prevent hanging.
 */
export async function fetchWithPinchTab(url: string): Promise<PinchTabResult> {
  const start = Date.now();
  let instance: PinchTabInstance | null = null;

  try {
    instance = await acquireInstance();

    // Race the actual fetch against a hard timeout
    const result = await Promise.race([
      fetchWithPinchTabInner(url, instance),
      new Promise<PinchTabResult>((resolve) =>
        setTimeout(() => resolve({
          text: null,
          title: null,
          url,
          error: `PinchTab hard timeout (${HARD_TIMEOUT_MS}ms)`,
          timeMs: Date.now() - start,
        }), HARD_TIMEOUT_MS),
      ),
    ]);

    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { text: null, title: null, url, error: errorMsg, timeMs: Date.now() - start };
  } finally {
    if (instance) releaseInstance(instance);
  }
}

/**
 * Clean up pool: stop all instances we created.
 */
export async function closePinchTabPool(): Promise<void> {
  const stopPromises = instancePool.map(async (inst) => {
    try {
      await fetch(`${PINCHTAB_URL}/instances/${inst.id}/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best effort
    }
  });

  await Promise.all(stopPromises);
  instancePool = [];
  serverChecked = false;
  logger.info('PinchTab pool closed');
}
