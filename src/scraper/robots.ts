import { config } from '../shared/config.js';

interface RobotsRules {
  disallowed: string[];
  crawlDelay: number | null;
}

// Cache robots.txt per domain to avoid re-fetching
const robotsCache = new Map<string, RobotsRules>();

/**
 * Fetch and parse robots.txt for a domain.
 * Returns the disallowed paths and crawl-delay for our User-Agent (or *).
 */
export async function getRobotsRules(domain: string): Promise<RobotsRules> {
  if (robotsCache.has(domain)) {
    return robotsCache.get(domain)!;
  }

  const defaultRules: RobotsRules = { disallowed: [], crawlDelay: null };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`https://${domain}/robots.txt`, {
      signal: controller.signal,
      headers: { 'User-Agent': config.scraper.userAgent },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // No robots.txt = everything allowed
      robotsCache.set(domain, defaultRules);
      return defaultRules;
    }

    const text = await response.text();
    const rules = parseRobotsTxt(text);
    robotsCache.set(domain, rules);
    return rules;
  } catch {
    // Can't fetch robots.txt — assume everything allowed
    robotsCache.set(domain, defaultRules);
    return defaultRules;
  }
}

/**
 * Check if a specific path is allowed by robots.txt rules.
 */
export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  for (const disallowed of rules.disallowed) {
    if (disallowed === '/') return false; // Entire site disallowed
    if (path.startsWith(disallowed)) return false;
  }
  return true;
}

/**
 * Parse robots.txt content.
 * Looks for rules matching our User-Agent or the wildcard (*).
 */
function parseRobotsTxt(content: string): RobotsRules {
  const lines = content.split('\n').map((l) => l.trim());
  const rules: RobotsRules = { disallowed: [], crawlDelay: null };

  let inRelevantBlock = false;
  let foundSpecificBlock = false;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || !line) continue;

    const [directive, ...valueParts] = line.split(':');
    const key = directive.trim().toLowerCase();
    const value = valueParts.join(':').trim();

    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      if (agent === '*' || agent.includes('veridion')) {
        inRelevantBlock = true;
        if (agent.includes('veridion')) foundSpecificBlock = true;
      } else {
        // If we already found a relevant block, stop at next user-agent
        if (inRelevantBlock && foundSpecificBlock) break;
        inRelevantBlock = false;
      }
    } else if (inRelevantBlock) {
      if (key === 'disallow' && value) {
        rules.disallowed.push(value);
      } else if (key === 'crawl-delay') {
        const delay = parseFloat(value);
        if (!isNaN(delay) && delay > 0) {
          rules.crawlDelay = delay;
        }
      }
    }
  }

  return rules;
}
