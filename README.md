# Veridion SWE Challenge — Company Data API

A full-stack solution for scraping, normalizing, indexing, and matching company data. Built with TypeScript, ElasticSearch, Supabase, and React.

**Match Rate: 100% (32/32) | Avg Confidence: 94.7% | 93 Unit Tests**

## Quick Start

```bash
npm install                    # Install dependencies
docker compose up -d           # Start ElasticSearch
npm run api                    # Start API → http://localhost:3000
cd dashboard && npm install && npm run dev  # Dashboard → http://localhost:5173
```

All other operations (scraping, pipeline, matching) can be run from the dashboard's **Command Center**.

## Architecture

The system uses a two-layer backend:

- **Express (Worker Layer)** — handles compute-heavy tasks: 3-tier web scraping, ETL pipeline, ElasticSearch indexing, and the match API. Streams live progress to the dashboard via SSE.
- **Supabase (Application Layer)** — stores company profiles, data provenance records, and crawl run history in Postgres. Provides a REST API with RLS and pushes real-time updates to the dashboard via websocket subscriptions.

```
Express (Worker)                    Supabase (App Backend)
┌─────────────────┐                ┌───────────────────────────┐
│ Scraper (3-tier) │──── seed ────▶│ Postgres                  │
│ Pipeline (ETL)   │               │  ├─ companies (997 rows)  │
│ Match API (ES)   │               │  ├─ data_provenance       │
│ Job Runner (SSE) │               │  └─ crawl_runs            │
└─────────────────┘                │ Realtime subscriptions     │
        │                          │ REST API + RLS             │
        ▼                          └────────────┬──────────────┘
  ElasticSearch                                 │ auto-refresh
  (fuzzy matching)                              ▼
                                          React Dashboard
                                   (stats, provenance, history)
```

## 3-Tier Scraping

Each domain is crawled with automatic fallback through three tiers:

1. **Tier 1 — HTTP + Regex**: Plain HTTP requests, parses HTML with regex patterns. Fast, handles ~90% of sites.
2. **Tier 2 — Browser Fallback** (Playwright or PinchTab): Launches headless browser(s) for JavaScript-rendered sites that return empty HTML to plain HTTP.
3. **Tier 3 — Gemini AI Refinement**: For low-quality results (quality score < 70), sends page content to Google Gemini to re-extract structured data with higher accuracy.

Quality scoring determines tier escalation — each result is scored on data completeness, and only domains below threshold get promoted to the next tier.

### PinchTab Integration (Tier 2 + Tier 3 Token Reduction)

[PinchTab](https://github.com/pinchtab/pinchtab) is an optional alternative browser engine for Tier 2. Pass `--pinchtab` to use it instead of Playwright.

**Why we added it:**

- **15.8x token reduction for Tier 3** — PinchTab's `/text` endpoint extracts clean, readable text from pages (~750 tokens) instead of sending raw HTML (~12,000 tokens) to Gemini. This is applied automatically to all Tier 3 candidates via the `htmlToText()` converter, even without PinchTab running.
- **Multi-instance isolation** — PinchTab runs each Chrome process as an isolated instance. If one crashes, others continue. Playwright shares a single browser process.
- **Higher Tier 2 concurrency** — Configurable pool of 4-8 parallel browser instances (default 8) vs Playwright's 3 shared pages.
- **4.8x faster wall-clock time** for Tier 2 (7.7s vs 37.1s in benchmarks) due to true parallelism.

**Trade-off:** PinchTab doesn't expose raw HTML, so Tier 2 PinchTab domains skip regex extraction and go directly to Tier 3 for structured data extraction. Playwright remains the better choice when you want Tier 2 without Tier 3.

**Setup:**
```bash
npm install -g pinchtab   # Install (12MB Go binary)
pinchtab                  # Start server on localhost:9867
```

**Usage:**
```bash
# Tier 2 with PinchTab + Tier 3 (recommended combo)
npx tsx src/scraper/index.ts --pinchtab --tier3

# Benchmark: compare Playwright vs PinchTab side-by-side
npx tsx src/scraper/benchmark.ts
```

**Configuration (env vars):**
| Variable | Default | Description |
|----------|---------|-------------|
| `PINCHTAB_URL` | `http://localhost:9867` | PinchTab server address |
| `PINCHTAB_CONCURRENCY` | `8` | Number of parallel browser instances |

## Key Features

- **3-tier scraping** with automatic quality-based fallback (HTTP → Playwright → Gemini AI)
- **Multi-strategy matching** with 5 cascading strategies and weighted confidence scoring
- **Custom ES analyzers** for company name matching (suffix stripping, ngrams, ASCII folding)
- **Data provenance tracking** — every extracted data point records its source URL, HTML element, extraction method, and confidence score
- **Supabase Realtime** — dashboard auto-refreshes when pipeline writes new data
- **Command Center** — run scraper, pipeline, and tests directly from the dashboard UI with live log streaming
- **Company detail drawer** — click any company to see all extracted data with provenance records
- **Crawl history** — view past pipeline runs with fill rates, error breakdowns, and timing
- **93 unit tests** covering all edge cases from the challenge data
- **robots.txt compliance** and ethical scraping practices
- **Swagger API docs** at `/docs` with interactive testing

## Documentation

- [**SOLUTION.md**](./SOLUTION.md) — Detailed solution explanation, architecture, results, accuracy measurement approach

## API Usage

```bash
curl -X POST http://localhost:3000/api/match \
  -H 'Content-Type: application/json' \
  -d '{"name": "SafetyChain Software", "website": "safetychain.com"}'
```

## Scripts

| Command | Description |
|---------|------------|
| `npm test` | 93 unit tests (normalizers) |
| `npm run scrape` | Scrape 997 websites (3-tier, see CLI flags below) |
| `npm run pipeline` | Full ETL pipeline |
| `npm run api` | Start Express API |
| `npm run test:match-rate` | Match rate test |
| `npm run analyze` | Crawl analysis report |

## CLI Usage (Full Workflow)

```bash
# 1. Install dependencies
npm install

# 2. Start ElasticSearch
docker compose up -d

# 3. Scrape all 997 websites
#    Tier 1 only (HTTP + regex, fastest — well under 10 min):
npx tsx src/scraper/index.ts

#    Tier 1 + 2 with Playwright (JS-rendered sites):
npx tsx src/scraper/index.ts --tier2

#    Tier 1 + 2 with PinchTab (multi-instance, requires `pinchtab` running):
npx tsx src/scraper/index.ts --pinchtab

#    All 3 tiers with Playwright (adds Gemini AI refinement, ~15 min):
npx tsx src/scraper/index.ts --tier2 --tier3

#    All 3 tiers with PinchTab (recommended — 15.8x fewer Gemini tokens):
npx tsx src/scraper/index.ts --pinchtab --tier3

# 4. Run the ETL pipeline (merge with company names → normalize → seed Supabase → index ElasticSearch)
npm run pipeline

# 5. Start the API server
npm run api                    # http://localhost:3000
                               # Swagger docs: http://localhost:3000/docs

# 6. Test match rate against the 32 API input samples
npm run test:match-rate

# 7. Generate crawl analysis report (coverage, fill rates)
npm run analyze

# 8. Run unit tests
npm test

# 9. Start the dashboard (optional)
cd dashboard && npm install && npm run dev   # http://localhost:5173
```

## Tech Stack

TypeScript, Node.js 20, Express 5, ElasticSearch 8.12, Supabase/PostgreSQL, Playwright, PinchTab, Google Gemini AI, React 19, Vite 7, Tailwind CSS v4, Recharts, Vitest, Docker
