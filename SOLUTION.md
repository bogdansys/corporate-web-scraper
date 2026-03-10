# Solution: Veridion SWE Challenge

## Architecture Overview

```
  EXPRESS (Worker Layer)                 SUPABASE (App Layer)
  ─────────────────────                  ────────────────────
  ┌──────────────────┐                  ┌───────────────────────────┐
  │  Scraper (3-tier) │                  │  PostgreSQL               │
  │  997 domains      │──── seed ──────▶│  ├─ companies             │
  └────────┬─────────┘                  │  ├─ data_provenance       │
           │                            │  └─ crawl_runs            │
           ▼                            │                           │
  ┌──────────────────┐                  │  REST API + RLS           │
  │  Pipeline (ETL)   │──── seed ──────▶│  Realtime WS ─────────────┼──▶ Dashboard
  │  merge/normalize  │                  └───────────────────────────┘    auto-refresh
  └────────┬─────────┘
           │ index
           ▼
  ┌──────────────────┐     query     ┌──────────────────┐
  │  ElasticSearch    │◀────────────│  Match API        │
  │  (fuzzy match)    │             │  POST /api/match  │
  └──────────────────┘              │  Swagger /docs    │
                                    └──────────────────┘
```

## Architecture: Two-Layer Backend

The system separates compute from data:

- **Express (Worker Layer)** handles compute-heavy tasks — 3-tier web scraping, ETL pipeline, ElasticSearch indexing, and the match API. It's a job runner: processes data and writes results to both ES and Supabase. Streams live progress to the dashboard via SSE.
- **Supabase (Application Layer)** is the application backend — stores company profiles, data provenance records, and crawl run history in Postgres. Exposes a REST API with RLS policies and pushes real-time updates to the dashboard via websocket subscriptions.

This separation means the dashboard never depends on the Express server for data reads. When the pipeline seeds new profiles, Supabase Realtime pushes changes to all connected dashboard clients automatically — no polling, no page reload.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | TypeScript (Node.js) | Aligns with Veridion's stack; type safety for data pipelines |
| Search | ElasticSearch 8.12 | Custom analyzers (ngrams, suffix stripping), native fuzzy matching |
| App Backend | Supabase (PostgreSQL) | REST API, RLS, Realtime subscriptions — dashboard data layer |
| Worker | Express 5 | Job runner for scraping, ETL, matching; SSE streaming for live progress |
| Browser | Playwright | Tier 2 headless browser for JS-rendered sites |
| AI | Google Gemini 2 Flash | Tier 3 AI extraction for low-quality results |
| Dashboard | React 19 + Vite 7 + Tailwind v4 | Supabase Realtime for auto-refresh; Recharts for visualization |
| Testing | Vitest | Fast, TypeScript-native; 93 unit tests for normalizers |
| CI/CD | GitHub Actions | Unit tests, type-check, dashboard build |

---

## 1. Data Extraction Approach

### Three-Tier Crawling

Each domain is processed through three tiers with automatic fallback based on quality scoring:

**Tier 1 — HTTP + Regex** (all domains)
- Plain HTTP requests with a standard Chrome User-Agent
- Multi-page: homepage + contact page + about page (if allowed by robots.txt)
- Regex-based extraction for phones, emails, social links, addresses
- Handles ~90% of sites successfully

**Tier 2 — Playwright Browser** (JS-heavy sites)
- Launched automatically when Tier 1 returns empty/minimal HTML
- Headless Chromium renders JavaScript before extraction
- Same extraction logic applied to the rendered DOM
- Catches sites using React, Angular, Vue, or heavy client-side rendering

**Tier 3 — Gemini AI Refinement** (low-quality results)
- After Tiers 1+2, each result is scored on data completeness (phone, email, social, description, etc.)
- Domains scoring below threshold (quality score < 70) are promoted to Tier 3
- Sends page content to Google Gemini 2 Flash for structured re-extraction
- AI results are merged with existing data, keeping the higher-confidence value for each field

### Quality Scoring

Every scrape result starts at 100 and loses points for data quality problems:
- Missing company name? (-15)
- No emails? (-10) | No phones? (-10) | No addresses? (-10)
- No description? (-5)
- Placeholder/junk/garbled emails? (-10 to -20 each)
- Garbage addresses, URL-as-name, spam content? (-10 to -30)
- Only results scoring below 70 get promoted to the next tier

### Ethical Scraping
- **robots.txt compliance**: Every domain's robots.txt is fetched, parsed, and cached. Disallowed paths are skipped.
- **Standard User-Agent**: Uses a Chrome User-Agent string for maximum compatibility with web servers
- **Minimal footprint**: Max 3 pages per domain. No deep crawling, sitemaps, or recursive discovery
- **Public data only**: Extracts phone numbers, social media, addresses from public company pages
- **Respects bot detection**: Gracefully handles Cloudflare, reCAPTCHA — does not attempt bypass

### Extraction Methods
| Data Point | Method | Confidence |
|-----------|--------|-----------|
| Phone numbers | `tel:` links (0.95), regex + libphonenumber validation (0.80), Gemini AI (0.85) |
| Social media | Anchor tag href matching for known domains |
| Email | `mailto:` links, regex extraction |
| Address | JSON-LD structured data, `<address>` tags, US regex patterns |
| Description | `<meta name="description">`, OpenGraph |
| Technologies | 18 pattern matchers (jQuery, React, WordPress, etc.) |
| Logo | JSON-LD, OpenGraph, `<link rel="icon">` |

### Data Provenance

Every extracted data point carries provenance metadata:
- **source_url** — which page it was found on
- **source_element** — the HTML element (e.g., `a[href="tel:..."]`, `footer a[href]`)
- **extraction_method** — how it was extracted (e.g., `tel_link`, `regex_us_full`, `gemini_ai`)
- **confidence** — extraction confidence score (0.0-1.0)
- **extracted_at** — timestamp

This provenance is preserved through the pipeline and stored in the `data_provenance` table in Supabase, allowing the dashboard to show exactly where each piece of data came from.

### Crawl Results
| Metric | Value |
|--------|-------|
| Total domains | 997 |
| Successfully crawled | 647 (64.9%) |
| Phone numbers extracted | 446 (68.9% of crawled) |
| Social media links | 333 (51.5% of crawled) |
| Email addresses | 280 (43.3% of crawled) |
| Addresses | 118 (18.2% of crawled) |
| Technologies detected | 523 (80.8% of crawled) |

The 35% failure rate reflects genuinely unreachable domains — dead sites, DNS failures, sites that block all automated access. This is expected for a random sample of small business websites.

### Scaling to <10 Minutes

The scraper uses `p-limit` for controlled concurrency (default: 50 parallel requests). Current crawl time is ~15 minutes with the default settings.

**How to achieve <10 minutes:**

| Approach | Impact | Trade-off |
|----------|--------|-----------|
| Increase concurrency to 100+ | ~2x faster | More aggressive on target servers |
| Skip subpage crawling | ~3x faster | Loses ~30% of phone/address data |
| DNS prefetching + keep-alive | ~20% faster | Minor complexity |
| Reduce timeout from 5s to 3s | ~15% faster | May miss slow servers |
| Stream processing (don't buffer full HTML) | Memory savings | Complexity |

**Configurable via environment variables:**
```bash
SCRAPER_CONCURRENCY=100   # Increase parallel requests
SCRAPER_TIMEOUT=3000      # Reduce per-request timeout
```

The architecture is designed for horizontal scaling — at Veridion's scale (billions of records), you'd use:
- **Distributed job queue** (BullMQ/RabbitMQ) across multiple workers
- **DNS caching layer** to avoid redundant lookups
- **Rate limiting per domain** to be a good citizen
- **Incremental crawling** — only re-crawl sites whose content changed (ETag/Last-Modified)

---

## 2. Data Quality & Normalization

Every extracted data point passes through dedicated normalizers before storage. This is critical — raw scraped data is messy.

### Phone Normalizer
- Uses `libphonenumber-js` for E.164 format conversion
- Handles 10+ phone formats from the challenge data: `(786) 426-6492`, `207.762.9321`, `+1703-684-3590`, `(+877) 449-5079`
- Edge case: toll-free numbers like `(+877)` — detected as 10-digit US numbers and correctly normalized to `+18774495079`
- **18 unit tests** covering all challenge data formats

### URL Normalizer
- Strips double protocols (`https://https//`), www prefixes, paths, query parameters
- **Domain blacklist**: google.com, bing.com, facebook.com, youtube.com, twitter.com, instagram.com (present as noise in test data)
- **26 unit tests** including all malformed URLs from challenge data

### Facebook Normalizer
- Extracts page ID from any Facebook URL format
- Handles: with/without www, trailing slashes, page IDs in URL, dots in page names
- **15 unit tests** covering all Facebook URLs from challenge data

### Company Name Normalizer
- Strips legal suffixes: Inc, LLC, Ltd, Corp, Pty, Co, Limited, Holdings, Company
- Strips special characters: &, *, //, .., parenthetical suffixes
- **Does NOT strip "Services"** — this is a business descriptor, not a legal suffix (key edge case from challenge data)
- **34 unit tests** covering all tricky names from challenge data

---

## 3. Matching Algorithm

### Multi-Strategy Pipeline
The matching engine tries strategies in order of reliability:

```
1. Exact Domain Match     → confidence: 1.00 (most reliable)
2. Exact Phone Match      → confidence: 0.95
3. Exact Facebook Match   → confidence: 0.90
4. Composite Multi-Field  → confidence: varies (multi-signal)
5. Fuzzy Name (ES)        → confidence: varies (last resort)
```

### ElasticSearch Custom Analyzers
```json
{
  "company_name_analyzer": {
    "tokenizer": "standard",
    "filter": ["lowercase", "company_suffix_strip", "asciifolding"]
  },
  "ngram_analyzer": {
    "tokenizer": "ngram_tokenizer (3-5 grams)",
    "filter": ["lowercase"]
  }
}
```

The `company_suffix_strip` filter removes legal suffixes at index time, so "SafetyChain Software Services Pty. Ltd." becomes "SafetyChain Software Services" in the search index.

### Fuzzy Name Matching
Uses three ES query clauses:
1. **multi_match** with `fuzziness: AUTO` on commercial_name (3x boost), legal_name (2x), all_names
2. **ngram match** on `commercial_name.ngram` for partial matches (e.g., "SBS" → "SBS Transport")
3. **exact keyword match** on `commercial_name.keyword` with `case_insensitive: true` (5x boost)

### Confidence Scoring
Weighted confidence calculation:

| Signal | Weight |
|--------|--------|
| Website (domain match) | 0.40 |
| Phone (E.164 match) | 0.30 |
| Facebook (page ID match) | 0.20 |
| Name (fuzzy match) | 0.10 |

Match quality tiers:
- **VERIFIED**: >90% confidence + 2+ exact field matches
- **HIGH**: >70% confidence + 1+ exact field match
- **MEDIUM**: >50% confidence
- **LOW**: >30% confidence
- **UNCERTAIN**: <30% confidence

---

## 4. Results

### Match Rate
```
MATCH RATE: 32/32 (100.0%)
AVG CONFIDENCE (matched): 94.7%

Confidence Distribution:
  High confidence (>70%):  32
  Medium (40-70%):          0
  Low (20-40%):             0
  No match (<20%):          0

Match Type Breakdown:
  website:  11
  phone:     8
  name:      8
  facebook:  5
```

### Edge Cases Successfully Handled
- Mismatched name + website (matched on website, not name)
- Duplicate phone numbers across companies (consistent matching)
- Garbage inputs ("Inc.", "..") — normalized to null, matched via other fields
- Blacklisted domains (google.com) — correctly ignored
- Toll-free phone formats — correctly normalized
- Legal suffix stripping without over-stripping "Services"

---

## 5. Measuring Match Accuracy

### Current Approach: Match Rate
The current test measures **match rate** (did we return a result?). This tells us coverage but not correctness.

### Proposed Accuracy Measurement

**Precision & Recall Framework:**
1. **Human-labeled ground truth**: For each of the 32 API inputs, manually label the "correct" company match
2. **Confusion matrix**: True Positives (correct match), False Positives (wrong match), False Negatives (no match when one exists), True Negatives (correctly no match)
3. **Metrics**: Precision = TP/(TP+FP), Recall = TP/(TP+FN), F1 = 2PR/(P+R)

**Confidence Calibration:**
- Plot predicted confidence vs actual correctness
- A well-calibrated system has 80% confidence → 80% correct
- Use Brier score to measure calibration quality

**At Scale (Millions of Companies):**
1. **Stratified sampling**: Random sample of 1000 matches, stratified by confidence tier and match type
2. **Human review pipeline**: Internal reviewers verify matches; calculate precision per tier
3. **Active learning**: Flag borderline matches (confidence 0.3-0.5) for human review → retrain
4. **Cross-validation**: Use known company registries (OpenCorporates, SEC EDGAR) as ground truth
5. **A/B testing**: Compare match algorithm versions on the same input set

**Why This Matters:**
A 100% match rate means nothing if matches are wrong. For Veridion's customers, a false positive (returning the wrong company) is worse than no match. The confidence scoring system helps — customers can set their own threshold based on risk tolerance.

---

## 6. What I'd Build Next

Given more time, these would meaningfully improve the system:

1. **ML-Based Entity Resolution** — Train a model on confirmed match/non-match pairs to replace heuristic confidence scoring with learned weights
2. **Incremental Crawling** — Only re-crawl sites whose content changed (ETag/Last-Modified headers); reduces load 10x for re-runs
3. **Industry Classification** — Map companies to NAICS/SIC codes using description + technology signals
4. **Deduplication Pipeline** — Detect and merge duplicate company entries across data sources using probabilistic record linkage
5. **Data Freshness Scoring** — Track when each data point was last verified; decay confidence over time so stale data gets re-crawled
6. **Webhook Notifications** — Notify downstream systems when company data changes
7. **Rate Limiting & API Keys** — Production-grade API security for the match endpoint
8. **Distributed Crawling** — Fan out scraping across multiple workers with a job queue (BullMQ/RabbitMQ) for 100k+ domain scale

---

## 7. Dashboard

The React dashboard provides a full operational view of the system:

- **Stat cards** — total companies, crawl success rate, fill rates for phone/email/social/address
- **Charts** — fill rate bar chart + technology distribution
- **Command Center** — run scraper, pipeline, analysis, and match tests directly from the UI with live SSE log streaming. Includes a combined "Scrape + Import" one-click workflow.
- **Crawl History** — past pipeline runs with expandable metadata: fill rates, error breakdowns, timing stats. Updates in real-time via Supabase subscription.
- **Company Detail Drawer** — click any company row to see all extracted data with full provenance (source URL, HTML element, extraction method, confidence score). Provenance is fetched from the `data_provenance` table.
- **Match Tester** — interactive fuzzy matching against ElasticSearch

The dashboard connects directly to Supabase with Realtime subscriptions — when the pipeline runs, stats, charts, tables, and crawl history update live without refreshing.

---

## Running the Project

### Prerequisites
- Node.js 20+
- Docker Desktop (for ElasticSearch)
- Supabase account (or use the provisioned project)
- (Optional) Gemini API key for Tier 3 AI extraction

### Quick Start
```bash
# Install dependencies
npm install

# Start ElasticSearch
docker compose up -d

# Run the full pipeline
npm run scrape        # Scrape 997 websites (~15 min, 3-tier)
npm run pipeline      # Merge → Normalize → Seed Supabase → Index ES

# Start the API
npm run api           # http://localhost:3000
                      # Swagger UI: http://localhost:3000/docs

# Run match rate test
npm run test:match-rate

# Start the dashboard
cd dashboard && npm install && npm run dev  # http://localhost:5173
```

### Available Scripts
| Script | Description |
|--------|------------|
| `npm test` | Run 93 unit tests (normalizers) |
| `npm run scrape` | Scrape all 997 websites (3-tier) |
| `npm run analyze` | Generate crawl analysis report |
| `npm run pipeline` | Full ETL: merge + normalize + seed + index |
| `npm run api` | Start Express API server |
| `npm run test:match-rate` | Test all 32 API inputs against match API |
