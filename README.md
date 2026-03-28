# Pantheon Synthetic Newsroom

A semi-autonomous AI newsroom running on localhost.  RSS feeds are ingested, triaged by Claude, drafted in two brand voices in parallel, reviewed for compliance, and optionally published to a WordPress endpoint.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in your API key
cp .env.local.example .env.local
# Edit .env.local and set ANTHROPIC_API_KEY

# 3. Push the database schema (creates data/pantheon.db automatically)
npm run db:push

# 4. Start the development server
npm run dev

# 5. Open the newsroom
open http://localhost:3000
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (required) | — |
| `WP_URL` | WordPress REST API base URL | `http://localhost:3000/api/mock-wordpress` |
| `WP_USERNAME` | WordPress admin username | `admin` |
| `WP_APP_PASSWORD` | WordPress Application Password | `mock_password` |
| `DATABASE_URL` | SQLite database path (Prisma format) | `file:./data/pantheon.db` |

Create a `.env.local.example` in the project root with these keys and empty values so other developers know what to fill in.

## Architecture: The 5-Stage Pipeline

```
[RSS Ingestion] → [Deduplication] → [LLM Triage] → [Fan-out Copywriting] → [Editor Review] → [Publisher]
```

**Stage 1 – Investigator (RSS Ingestion + Dedup)**
Fetches configured RSS feeds, hashes each article URL with SHA-256, and checks `data/seen-urls.json`.  New items pass through; already-processed URLs are silently dropped.

**Stage 2 – Router (LLM Triage)**
Each new item is sent to Claude with a YES/NO prompt: "Is this about Indonesian property?" Items marked NO are discarded; YES items continue.

**Stage 3 – Copywriters A & B (Fan-out)**
Relevant items are drafted in parallel for two brand voices:
- `gen-z-tech` — casual, Gen-Z tech blog tone
- `formal-biz` — professional business publication tone

Each call creates an `Article` row in SQLite with status `Drafting`.

**Stage 4 – Editor-in-Chief (Compliance Review)**
Each draft is sent to Claude for compliance review.  The response must be a JSON object `{ status: "PASS" | "FAIL", reason: string }`.  FAIL articles are flagged; PASS articles advance to `Pending Review`.

**Stage 5 – Publisher**
If `requireReview` is false, PASS articles are automatically submitted to the WordPress REST API.  If `requireReview` is true, a human must click "Approve & Publish" in the War Room tab.

## Usage

### Tab 1 – Operation Map
Visualises the live pipeline graph.  Each node pulses amber while active.

- **RUN NOW** — triggers a single pipeline cycle immediately
- **GO LIVE** — starts the automatic cron schedule (frequency set in Settings)
- **STOP** — cancels the active schedule
- **SSE log terminal** — streams real-time `info / success / error / warn` events from the server via Server-Sent Events at `/api/stream`

### Tab 2 – War Room
- Browse generated articles, filter by status and brand
- Select an article to edit its title and content
- **Approve & Publish** — submits the article to the WordPress endpoint
- **Editor's Insights** panel — AI-generated suggestions for improving pipeline prompts; each insight can be Approved or Dismissed

## Database

SQLite database is stored at `data/pantheon.db` (created automatically on first `npm run db:push`).

```bash
# Open Prisma Studio (visual DB browser)
npm run db:studio

# Reset schema (WARNING: destroys all data)
npm run db:push
```

**Schema tables:**
- `Article` — all generated and published articles
- `Insight` — AI suggestions from the Editor-in-Chief
- `Settings` — singleton row: scrape frequency, review mode, live flag, target niche

## Testing

```bash
# Run all unit tests
npm test

# Run with coverage report
npm test -- --coverage

# Run a single test file
npm test -- __tests__/dedup.test.ts

# Verbose output
VERBOSE_TESTS=1 npm test
```

Test files are located in `__tests__/`:

| File | What it tests |
|---|---|
| `pipeline.test.ts` | RSS fetch, dedup, triage, fan-out drafting, review, full cycle |
| `api.test.ts` | All API route contracts (articles, settings, insights, stream) |
| `dedup.test.ts` | `lib/dedup.ts` — read/write, error resilience, concurrent writes |
| `llm.test.ts` | `triageArticle`, `draftArticle`, `reviewArticle` with mocked Anthropic |

All Anthropic SDK and RSS parser calls are mocked — no live API keys or network access required to run tests.

## Mock WordPress

A mock WordPress endpoint is included at `/api/mock-wordpress`.  It accepts `POST /api/mock-wordpress/wp-json/wp/v2/posts`, returns a fake post ID, and logs the request to the console.

To use a real WordPress site, update `.env.local`:

```env
WP_URL=https://your-site.com
WP_USERNAME=your-admin-user
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

Generate an Application Password in WordPress Admin → Users → Your Profile → Application Passwords.

## RSS Feeds

Default feeds target Indonesian property news.  Feed availability depends on network access and the feed provider.  If feeds are unreachable (e.g. on a restricted network), the pipeline logs a warning and falls back to mock articles so the rest of the pipeline can still be exercised.

To change feeds, update the feed list in `app/api/process-news/route.ts`.

## Project Structure

```
pantheon-newsroom/
├── app/
│   ├── api/
│   │   ├── articles/         # GET, and [id]/ PUT + POST approve
│   │   ├── insights/         # GET, and [id]/ approve + dismiss
│   │   ├── mock-wordpress/   # Mock WP REST endpoint
│   │   ├── process-news/     # POST — triggers pipeline cycle
│   │   ├── settings/         # GET + PUT singleton
│   │   └── stream/           # GET — SSE log stream
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx              # Tab navigation shell
├── components/
│   ├── ErrorBoundary.tsx
│   ├── LoadingSpinner.tsx
│   └── EmptyState.tsx
├── lib/
│   ├── api-client.ts         # Typed fetch wrapper for front-end
│   ├── dedup.ts              # URL seen-set backed by JSON file
│   └── prisma.ts             # Shared PrismaClient singleton
├── prisma/
│   └── schema.prisma         # SQLite schema
├── types/
│   └── index.ts              # Shared TypeScript interfaces
├── __tests__/                # Jest test suite
├── data/                     # Runtime data (gitignored)
│   ├── pantheon.db
│   └── seen-urls.json
├── jest.config.ts
├── next.config.ts
├── postcss.config.js
├── tailwind.config.ts
└── tsconfig.json
```

## Frontend Architecture

See **[PANTHEON_FRONTEND_COMPLETE.md](PANTHEON_FRONTEND_COMPLETE.md)** for comprehensive frontend documentation including:

- Component breakdown (PantheonDashboard, OperationMap, WarRoom, etc.)
- Hooks & state management (usePolling, useArticles, useInsights, etc.)
- API integration layer (lib/api-client.ts)
- Real-time updates strategy (SSE vs polling)
- Styling & dark mode (Tailwind + custom CSS)
- Error handling & performance optimization
- Accessibility & keyboard navigation
- Deployment guides (Vercel, Docker, self-hosted)

## Hooks Reference

### usePolling
Generic hook for polling API endpoints at regular intervals.
```typescript
const { data, loading, error, refetch } = usePolling(() => api.getArticles(), 3_000)
```

### useArticles
Higher-level hook for article CRUD operations.
```typescript
const { articles, loading, updateArticle, approveArticle } = useArticles()
```

### useInsights
Hook for managing AI insights and recommendations.
```typescript
const { insights, approveInsight, dismissInsight } = useInsights()
```

### usePipeline
Hook for settings and pipeline control.
```typescript
const { settings, updateSettings, triggerPipeline } = usePipeline()
```

### useWebSocket (Optional)
Real-time WebSocket connection (alternative to SSE).
```typescript
const { data, isConnected, send } = useWebSocket('ws://localhost:3000/ws')
```

## Known Limitations (localhost POC)

- SQLite is not suitable for concurrent writes at production scale.  Migrate to Postgres when deploying beyond localhost.
- The cron scheduler (`node-cron`) runs inside the Next.js process.  In a serverless deployment each function invocation is stateless — use an external scheduler (Vercel Cron, GitHub Actions, etc.) and call `POST /api/process-news` instead.
- The SSE stream at `/api/stream` uses an in-memory event emitter.  Multiple browser tabs or server restarts will lose log state.
- `data/seen-urls.json` is not atomic under concurrent writes.  For production, replace with a database-backed dedup table.

## Troubleshooting

### Port Already in Use
```bash
npm run dev -- -p 3001
```

### Database Error
```bash
npm run db:push  # Re-apply migrations
npm run db:studio  # Inspect database
```

### SSE Not Connecting
Check that `/api/stream` endpoint is accessible. Falls back to polling automatically.

### Dependencies Out of Date
```bash
npm update
npm audit fix
```

For more troubleshooting, see [PANTHEON_FRONTEND_COMPLETE.md](PANTHEON_FRONTEND_COMPLETE.md#troubleshooting).
