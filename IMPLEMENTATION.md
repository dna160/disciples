# Disciples — AI Pipeline Dashboard
## Implementation Documentation

---

## Overview

Disciples is a semi-autonomous AI newsroom pipeline built on Next.js 14. It ingests news from the web, runs each story through a multi-stage AI editorial pipeline, and publishes to WordPress — with a real-time dashboard for monitoring, configuration, and human-in-the-loop review.

The system operates as a 6-stage pipeline where each stage is a specialized AI agent with a defined role, configurable behavior, and awareness of what every other agent has already done.

---

## Architecture

### Pipeline Stages

```
[Stage 0] SEO Strategist
     ↓  generates N directives (keywords + search queries)
[Stage 1] Investigator
     ↓  cross-references directives vs. War Room DB → searches Serper → diversity check → RSS fallback
[Stage 2] Router (Triage)
     ↓  per-brand niche relevance filter → franchise deduplication
[Stage 3] Copywriters A & B (parallel)
     ↓  draft articles in brand voice from source material
[Stage 4] Editor-in-Chief
     ↓  compliance review → revision loop (up to 5 passes) → auto-publish or queue
[Stage 5] Publisher
     ↓  WordPress REST API → featured image upload → extra images embedded as figure blocks
```

### Agent Roles

| Agent | Model | Role |
|---|---|---|
| SEO Strategist | Claude Haiku | Generates targeted investigator directives (short-tail + evergreen) with dedup awareness |
| Investigator | Claude Haiku | Fetches news via Serper/RSS, cross-references against published articles, detects topic concentration |
| Router | Claude Haiku | Strict niche triage per brand — only DIRECT relevance passes |
| Copywriter A | Claude Haiku | Drafts articles in Gen-Z brand voice |
| Copywriter B | Claude Haiku | Drafts articles in Formal Biz brand voice |
| Editor-in-Chief | Claude Haiku | Compliance review with iterative revision loop |
| Diversity Checker | Claude Haiku | Post-router franchise deduplication (prevents same IP/franchise running multiple times) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | SQLite via Prisma ORM |
| AI | Anthropic Claude (`claude-haiku-4-5-20251001`) |
| News Search | Serper.dev (`/news` + `/images` endpoints) |
| Image Resolution | RSS embed → og:image scrape → Serper Images → DuckDuckGo fallback |
| Publishing | WordPress.com REST API v1.1 |
| Styling | Tailwind CSS |
| Real-time Logs | Server-Sent Events (SSE) |
| Scheduling | node-cron (in-process) |

---

## Key Features

### SEO Strategist (Stage 0)
- Generates configurable mix of **short-tail** (trending) and **evergreen** (long-term) directives per cycle
- **Topic deduplication**: queries `SeoDirective` table + `Article` table within a configurable lookback window (Off / 2h / 4h / 8h / 24h / 48h / 72h / 7 days)
- Shows both exact keyword history and published article headlines to the LLM — avoids the same franchise/IP even under different keyword variations
- Configurable via clicking the SEO Strategist node in the pipeline diagram (not in the controls bar)

### Investigator (Stage 1)
- **War Room DB cross-reference**: before searching, compares directives against recently published articles — drops directives for already-covered topics
- **Serper news search**: executes each directive's suggested queries via `POST https://google.serper.dev/news`
- **Topic concentration detection**: after all searches, Haiku reviews all fetched titles grouped by directive — if the same franchise/IP dominates multiple directives, flags the duplicates and calls SEO Strategist for replacement directives
- Falls back to RSS feed ingestion when Serper key is absent

### Router / Triage (Stage 2)
- Per-brand niche relevance check (nicheA for Gen-Z, nicheB for Formal Biz)
- **Strict mode**: "DIRECTLY and primarily about the niche — if in doubt, answer NO" — prevents tangentially-related content from passing
- **Franchise deduplication**: post-triage, Haiku reads all passed article titles and removes duplicates where the same specific franchise/IP appears more than once, keeping the most informative/unique representative

### Copywriters A & B (Stage 3)
- Each brand has independently configurable: niche, tone, RSS sources, image count (1–10 images per article)
- First image = WordPress featured image (uploaded to media library)
- Extra images = embedded as `<figure class="wp-block-image">` blocks in article body
- Configurable via modal opened by clicking the copywriter node in the pipeline diagram

### Editor-in-Chief (Stage 4)
- **First pass**: auto-published to WordPress immediately if compliant
- **Revision loop** (up to 5 passes): uses `reviseArticle()` which shows the LLM its **own previous draft** alongside editorial notes — not a blind re-write from source. This ensures targeted corrections rather than the same output repeating
- Articles that fail all 5 revisions go to War Room for human review
- Revised articles that eventually pass go to War Room for manual approval

### Publisher (Stage 5)
- Uploads featured image to WordPress media library before publishing
- Extra images embedded as figure blocks appended to article content
- Same image-embedding logic applied on manual approval from War Room

---

## Database Schema

```prisma
model Article {
  id            String    // UUID
  cycleId       String    // links all articles from one pipeline run
  brandId       String    // "gen-z-tech" | "formal-biz"
  status        String    // Drafting | Pending Review | Revising | Published | Failed
  title         String
  content       String    // HTML article body
  sourceUrl     String?   // original news URL
  sourceTitle   String?   // original headline
  reviewResult  String?   // JSON: { status, reason }
  wpPostId      String?   // WordPress post ID after publish
  featuredImage String?   // primary image URL
  images        String?   // JSON: string[] of extra image URLs
  revisionCount Int       // how many editorial revisions were made
}

model Insight {
  id             String   // editor feedback per agent per cycle
  targetAgent    String   // "Copywriter-A" | "Copywriter-B" | "Investigator"
  suggestionText String
  status         String   // "Pending" | "Dismissed"
}

model SeoDirective {
  id         String
  cycleId    String @unique
  directives String  // JSON: InvestigatorDirective[]
}

model Settings {
  id              String   // singleton — always "singleton"
  scrapeFrequency String   // "1h" | "2h" | "4h" | "8h" | "12h" | "24h"
  requireReview   Boolean  // if true, all articles go to War Room before publish
  isLive          Boolean  // master live/standby switch
  targetNiche     String   // fallback niche
  nicheA          String   // Gen-Z brand niche
  nicheB          String   // Formal Biz brand niche
  toneA           String   // Gen-Z tone instructions
  toneB           String   // Formal Biz tone instructions
  rssSourcesA     String   // newline/comma-separated RSS URLs for brand A
  rssSourcesB     String   // newline/comma-separated RSS URLs for brand B
  imageCountA     Int      // images per article for brand A (1–10)
  imageCountB     Int      // images per article for brand B (1–10)
  seoDedupeHours  Int      // lookback window for SEO deduplication (0 = off)
  seoShortTail    Int      // short-tail directives per cycle
  seoEvergreen    Int      // evergreen directives per cycle
}
```

---

## API Routes

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/process-news` | Trigger a manual pipeline cycle (fire-and-forget) |
| `POST` | `/api/process-news/abort` | Send abort signal to running pipeline |
| `GET` | `/api/pipeline-status` | Returns `{ pipelineRunning, schedulerRunning }` |
| `GET` | `/api/stream` | SSE stream of real-time pipeline log events |
| `GET/PUT` | `/api/settings` | Read/write all Settings fields |
| `GET` | `/api/articles` | List articles with optional status/brand filters |
| `GET/PUT` | `/api/articles/[id]` | Get or update a single article |
| `POST` | `/api/articles/[id]/approve` | Manually publish article to WordPress |
| `POST` | `/api/articles/[id]/reject` | Reject article (sets status to Failed) |
| `GET/DELETE` | `/api/insights` | List or dismiss editor insights |
| `GET` | `/api/metrics` | Pipeline performance metrics |
| `POST` | `/api/dedup` | Check/mark URL as seen (deduplication) |

---

## Frontend Components

| Component | Purpose |
|---|---|
| `PantheonDashboard` | Root layout with tab navigation |
| `OperationMap` | Interactive pipeline diagram — click nodes to configure |
| `MasterControls` | Run Now / Kill Process / Live toggle / schedule controls |
| `WarRoom` | Article review queue with approve/reject/edit |
| `ArticleEditor` | Full article editor with live preview |
| `TerminalLog` | Real-time SSE log viewer |
| `InsightsPanel` | Editor-in-Chief feedback cards per agent |
| `CopywriterConfigModal` | Per-brand niche, tone, RSS, image count config |
| `SeoStrategistModal` | SEO cycle config (dedup window, short-tail/evergreen counts) |
| `SystemStatusBar` | Live/Standby indicator + scheduler countdown |

---

## Configuration

### Environment Variables

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Required for web search (news ingestion + image resolution)
SERPER_API_KEY=...

# Required for WordPress publishing
WP_SITE_URL=https://yoursite.wordpress.com
WP_USERNAME=your_wp_username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx

# Database
DATABASE_URL=file:./data/disciples.db
```

### Pipeline Configuration (via Dashboard)

All runtime configuration is stored in the `Settings` singleton and editable live through the UI:

- **Live / Standby**: master switch — scheduled runs are blocked in Standby
- **Scrape frequency**: 1h / 2h / 4h / 8h / 12h / 24h
- **Require review**: forces all articles to War Room before auto-publishing
- **Brand niches**: independent niche per copywriter (Gen-Z / Formal Biz)
- **Brand tones**: freeform tone instructions per brand
- **RSS sources**: comma or newline-separated feed URLs per brand
- **Images per article**: 1–10 images, configured per brand
- **SEO dedup window**: Off / 2h / 4h / 8h / 24h / 48h / 72h / 7 days
- **Short-tail topics per cycle**: 0–5
- **Evergreen topics per cycle**: 0–3

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in keys
cp .env.local.example .env.local

# 3. Push the database schema
npm run db:push

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Pipeline State & Abort

Pipeline state is stored on `globalThis.__pipelineState` (not module-level variables) so it survives Next.js HMR reloads in development. This ensures the abort route always reaches the same `AbortController` instance as the running pipeline, regardless of module re-evaluation.

```
globalThis.__pipelineState = {
  running: boolean,
  shouldAbort: boolean,
  controller: AbortController | null
}
```

---

## Intelligence Layers — Deduplication & Diversity

The system has five independent deduplication layers stacked across the pipeline:

| Layer | Where | Mechanism |
|---|---|---|
| URL dedup | Stage 1 | SQLite `seen-urls` table — never re-processes the same source URL |
| SEO keyword dedup | Stage 0 | LLM avoids keywords used in recent `SeoDirective` records |
| Published headline dedup | Stage 0 | LLM reads recent article headlines — avoids same franchise/IP even under different keywords |
| Investigator DB cross-ref | Stage 0→1 | Before searching, Haiku compares directives vs. War Room articles — drops already-covered topics |
| Topic concentration detection | Stage 1 | After all searches, Haiku checks if same franchise dominates multiple directives — calls SEO Strategist for replacements |
| Franchise dedup | Stage 2 | After router triage, Haiku groups all passed articles by franchise — keeps only 1 per specific IP |
