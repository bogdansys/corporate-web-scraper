# Veridion SWE Challenge — Company Data API

A full-stack solution for scraping, normalizing, indexing, and matching company data. Built with TypeScript, ElasticSearch, Supabase, and React.

**Match Rate: 100% (32/32) | Avg Confidence: 94.7% | 93 Unit Tests**

## Quick Start

```bash
npm install                    # Install dependencies
docker compose up -d           # Start ElasticSearch
npm run scrape                 # Scrape 997 websites (3-tier: HTTP → Browser → AI)
npm run pipeline               # Merge + normalize + seed Supabase + index ES
npm run api                    # Start API → http://localhost:3000
npm run test:match-rate        # Test all 32 inputs
cd dashboard && npm install && npm run dev  # Dashboard → http://localhost:5173
```

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
2. **Tier 2 — Playwright Browser**: Launches a headless browser for JavaScript-rendered sites that return empty HTML to plain HTTP.
3. **Tier 3 — Gemini AI Refinement**: For low-quality results (quality score < 70), sends page content to Google Gemini to re-extract structured data with higher accuracy.

Quality scoring determines tier escalation — each result is scored on data completeness, and only domains below threshold get promoted to the next tier.

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
| `npm run scrape` | Scrape 997 websites (3-tier) |
| `npm run pipeline` | Full ETL pipeline |
| `npm run api` | Start Express API |
| `npm run test:match-rate` | Match rate test |
| `npm run analyze` | Crawl analysis report |

## Tech Stack

TypeScript, Node.js 20, Express 5, ElasticSearch 8.12, Supabase/PostgreSQL, Playwright, Google Gemini AI, React 19, Vite 7, Tailwind CSS v4, Recharts, Vitest, Docker
