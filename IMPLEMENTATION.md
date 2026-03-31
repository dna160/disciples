# DISCIPLES — Synthetic Newsroom · Implementation Log

> Project codename: **Pantheon Newsroom**  
> Stack: Next.js 14 · TypeScript · Prisma · SQLite · Anthropic Claude (Haiku)  
> Repo: `d:\Claude Home\Popshck\pantheon-newsroom`

---

## Release History

---

### v1.9.0 — Pipeline Router Franchise Fix & Dedup Safety Fallback
**Date:** 2026-03-31
**Branch:** `master`

#### Summary
Fixes a critical bug where the pipeline router dropped **all** items to 0 after franchise deduplication. Root cause: the `generateDistributedTopics` quota loop prompt did not ask the LLM to output a `franchise` field, causing `deduplicateByFranchise` to receive items with no franchise identity and silently discard the entire batch. Two coordinated fixes applied.

---

#### Fix 1: `franchise` Field Added to Quota Prompt Output (`lib/seo-strategist.ts`)

**Problem:** The `generateDistributedTopics` per-slot prompt returned `{ title, focus_keyword, reasoning }` — no `franchise`. The router's `deduplicateByFranchise` LLM call could not group articles by IP and dropped everything.

**Fix:** Added `franchise` to:
- `DistributedTopic` interface (new required field `franchise: string`)
- The per-slot LLM prompt JSON schema — the LLM is now explicitly instructed to name the IP (e.g. `"Jujutsu Kaisen"`, `"Gundam"`, `"Hololive"`) or `"General"` if no specific IP applies
- The `parsed` type cast (`franchise?: string`)
- The `generatedTopics.push()` — with in-code fallback `parsed.franchise || parsed.focus_keyword || 'general'` so the field is never empty even if the LLM omits it

**Files changed:** `lib/seo-strategist.ts`

---

#### Fix 2: Router Safety Fallback (`lib/pipeline.ts`)

**Problem:** If `deduplicateByFranchise` (LLM-based) returned 0 `keepIds` for any reason (LLM JSON failure, missing franchise field, unexpected output), the entire batch of valid items was silently discarded — pipeline produced 0 articles.

**Fix:** After the `deduplicateByFranchise` call, a guard checks `keepIds.length === 0 && relevantItems.length > 0`. When triggered:
1. Logs a `[WARN]` identifying the franchise-dedup failure.
2. Runs a lightweight **client-side title-based dedup** (normalized 60-char title prefix, no LLM required) as the fallback.
3. Pipeline continues with those items rather than producing zero output.

The final log line was also updated to `[INFO ][ROUTER] N unique-franchise items proceeding to copywriters` to match the format referenced in the user's monitoring setup.

**Files changed:** `lib/pipeline.ts` (franchise dedup block, lines ~1283–1317)

---

### v1.8.0 — Google Trends Real-Time Integration
**Date:** 2026-03-31
**Branch:** `master`

#### Summary
Injects live Google Trends data into the SEO Strategist discovery pipeline, eliminating stale-news hallucination for short-tail directives. The Trends feed is fetched once per pipeline cycle via Google's RSS endpoint and rendered directly into the strategist's context window alongside the existing dedup and avoid-topic blocks.

---

#### Feature: `getRealTimeTrends()` — Google Trends RSS Fetcher (`lib/seo-strategist.ts`)

**Problem:** The SEO Strategist relied solely on the LLM's internal training knowledge to identify "trending" short-tail topics, which caused it to hallucinate dated events (e.g. 2023 anime season finales) as if they were current.

**Fix:** Added `getRealTimeTrends(countryCode, limit)` using the `rss-parser` package (already a project dependency). It fetches `https://trends.google.com/trending/rss?geo={countryCode}` and extracts the `<ht:approx_traffic>` custom XML field from each item.

**Limit is dynamic:** The `limit` parameter is computed as `Math.max(5, totalExpected)` where `totalExpected = (shortTailPerBrand + evergreenPerBrand) × 5`. This ensures the number of trend signals scales with the pipeline's configured directive quota — e.g. a `2+1` config fetches 15 signals; a `1+1` config fetches 10.

**New exports from `lib/seo-strategist.ts`:**

| Symbol | Kind | Description |
|---|---|---|
| `TrendingTopic` | interface | `{ keyword: string, traffic: string, newsList: string }` |
| `getRealTimeTrends(countryCode?, limit?)` | async function | Fetch live trending topics from Google Trends RSS |

**Prompt injection:** `buildStrategistPrompt()` renders a numbered `📈 REAL-TIME GOOGLE TRENDS` block. Each entry shows rank, keyword, estimated traffic, and a 120-char news context snippet.

**Stale-news guardrail:** Added a `⚠️ NO STALE NEWS RULE` paragraph at the top of the strategist system prompt, explicitly forbidding topics about past-year events.

**Failure mode:** `getRealTimeTrends()` returns `[]` on any network error — the pipeline never hard-fails on a failed Trends fetch. The `📈` block is omitted from the prompt when the array is empty.

**Files changed:** `lib/seo-strategist.ts`

---

### v1.7.0 — Featured Image Binary Upload & Markdown Safety-Net
**Date:** 2026-03-31
**Branch:** `master`

#### Summary
Replaced the non-functional `jetpack_featured_media_url` shortcut with a proper two-step featured-image flow for self-hosted WordPress. Added `marked` as a code-level Markdown-to-HTML safety net for all outgoing article content. Both changes target `lib/wordpress.ts` only; no other files are affected.

---

#### Fix: Featured Image — Binary Upload to `/wp-json/wp/v2/media` (`lib/wordpress.ts`)

**Problem:** The `selfhosted` backend was passing `jetpack_featured_media_url` in the post payload. The standard WP REST API v2 ignores this field — it requires a numeric `featured_media` ID sourced from the Media Library. Published posts therefore always had no featured image.

**Fix:** Added `uploadImageBinaryToWordPress()`:
1. Fetches the image binary from the external source URL.
2. Derives filename and `Content-Type` from the blob.
3. POSTs raw bytes to `/wp-json/wp/v2/media` with the correct `Content-Disposition` header.
4. Returns the `id` from the API response and attaches it as `featured_media` in the post payload.

Also added `extractFirstImageUrl()` — scans both Markdown `![](url)` syntax and HTML `<img src="...">` tags — so a featured image is set even if the caller does not supply `featuredImageUrl` explicitly.

**New functions added to `lib/wordpress.ts`:**

| Function | Role |
|---|---|
| `uploadImageBinaryToWordPress(imageUrl, wpBaseUrl, authHeader)` | Fetch + upload image binary, return WP Media ID |
| `extractFirstImageUrl(content)` | Find first image URL from Markdown or HTML content |

**Files changed:** `lib/wordpress.ts`

---

#### Feature: Markdown → HTML Safety-Net via `marked` (`lib/wordpress.ts`)

**Problem:** Despite strict HTML-only prompts, the LLM occasionally emits Markdown formatting (bold `**text**`, headers `## heading`, etc.) which renders as raw text in WordPress Classic Editor / Gutenberg HTML mode.

**Fix:** Added `sanitizeToHtml()` using the `marked` library, called on `article.content` before the payload is assembled. `marked.parse()` converts any residual Markdown to well-formed HTML and passes through content that is already fully HTML without modification.

**Dependency added:** `marked` + `@types/marked` (npm install)

```typescript
import { marked } from 'marked'

function sanitizeToHtml(content: string): string {
  return marked.parse(content) as string
}

// Applied before building the WP post payload:
const htmlContent = sanitizeToHtml(article.content)
```

**Files changed:** `package.json` (added `marked`), `lib/wordpress.ts`

---

### v1.6.0 — WordPress Migration, Brand Categories & Developer Docs
**Date:** 2026-03-31
**Branch:** `master`
**Commit:** `abaa6dd`

#### Summary
Migrated the publish target from WordPress.com (`aryamedia1.wordpress.com`) to a self-hosted Hostinger instance. Added automatic WordPress category assignment keyed to each brand. Created `SYNTAX_INDEX.md` — a comprehensive developer reference — and embedded a quick-reference section in `IMPLEMENTATION.md`.

---

#### Change: WordPress Target — Hostinger Self-Hosted (`lib/wordpress.ts`, `.env.local`)

**Previous target:** `https://aryamedia1.wordpress.com` (WordPress.com, OAuth2 Bearer)
**New target:** `https://hotpink-dogfish-392833.hostingersite.com` (self-hosted, Basic Auth)

`getWPCredentials()` automatically detects the backend from `WP_URL`:
- Contains `wordpress.com` → **wpcom** path (REST v1.1 + `WPCOM_ACCESS_TOKEN`)
- Contains `/api/mock-wordpress` → **mock** path (local dev)
- Everything else → **selfhosted** path (`WP_USERNAME` + `WP_APP_PASSWORD`, Basic Auth, `wp/v2` REST API)

**Connection test result (2026-03-31):**
```
✅ Auth — GET /wp-json/wp/v2/users/me → logged in as "johnson leonardi" (ID 6)
✅ Publish — POST /wp-json/wp/v2/posts → Post ID 645 created (draft)
```

**Files changed:** `.env.local`, `lib/wordpress.ts`

---

#### Feature: Brand Category Auto-Assignment (`lib/wordpress.ts`)

Every article published by the pipeline is now automatically filed under the correct WordPress category for its brand. Category IDs were fetched live from the site and hardcoded as two constants:

| Constant | Used by | Format |
|---|---|---|
| `BRAND_CATEGORY_ID` | `selfhosted` backend (`wp/v2`) | `Record<string, number>` → passed as `categories: [id]` |
| `BRAND_CATEGORY_SLUG` | `wpcom` backend (v1.1 API) | `Record<string, string>` → passed as `categories: 'slug'` |

**Category map (verified 2026-03-31):**

| Brand ID | Category Name | WP Category ID |
|---|---|---|
| `anime` | Anime | `11` |
| `toys` | Toys | `12` |
| `infotainment` | Infotainment | `10` |
| `game` | Game | `13` |
| `comic` | Comic | `14` |
| `event` | Event | `17` |

Falls back to `Uncategorized` (ID `1`) for any unknown `brandId`.

**Pipeline log output per publish:**
```
[WordPress] Publishing to category: anime (ID 11) for brand "anime"
```

**Test result:** Draft post ID `646` confirmed assigned to category `11` (Anime) via `GET /wp-json/wp/v2/posts/646`.

**Files changed:** `lib/wordpress.ts` (lines 53–72, 143–168)

> ⚠️ If a new WordPress category is added, update both `BRAND_CATEGORY_ID` and `BRAND_CATEGORY_SLUG` in `lib/wordpress.ts`. To refresh IDs from the live site:
> ```
> GET /wp-json/wp/v2/categories?per_page=50
> ```

---

#### Docs: SYNTAX_INDEX & Developer Reference

- Created [`SYNTAX_INDEX.md`](./SYNTAX_INDEX.md) — 650+ line developer reference covering every constant, type, function, component, hook, API endpoint, and naming rule in the codebase.
- Added **Developer Reference** section to this file (`IMPLEMENTATION.md`) with brand map, type quick-reference, core function surface tables, frontend API client usage, and the 5 production rules.

**Files added/changed:** `SYNTAX_INDEX.md` (new), `IMPLEMENTATION.md`

---

### v1.5.0 — Pipeline Fidelity, Image Magic-Bytes & LLM Quality  
**Date:** 2026-03-30  
**Branch:** `master`  
**Staged files:** 19 changed · +1,205 / −751 lines

#### Summary
This release addresses three distinct reliability issues discovered during live pipeline runs: LLM-truncated articles due to insufficient token budget, Claude Vision API 400 errors caused by incorrect MIME-type detection, and hallucination bleed-through in revision cycles. It also fixes a class of false-positive agent error state surfacing in the UI and adds destination endpoint node types to the type system.

---

#### Fix: LLM Token Budget (`lib/llm.ts`)

**Problem:** `draftArticle()` and `reviseArticle()` both had `max_tokens: 1024`. For medium-length news articles (800–1200 words) this cap silently truncated the JSON response body, causing `JSON.parse` failures or articles that ended mid-sentence.

**Fix:** Raised `max_tokens` to `2048` for both functions. Revision temperature also reduced from `0.5` → `0.2` to reduce creative drift during the fix-only revision pass.

**Files changed:** `lib/llm.ts` (lines 154, 576)

---

#### Fix: Image Media-Type via Magic Bytes (`lib/llm.ts`)

**Problem:** `fetchImageAsBase64()` inferred image MIME type from the HTTP `Content-Type` response header. Many CDNs serve images with a generic `application/octet-stream` or no `Content-Type` header, causing Claude Vision to receive incorrectly typed base64 data and return HTTP 400 errors. This silently dropped all images for affected articles.

**Fix:** Replaced header-based MIME detection with **magic-bytes inspection** of the raw buffer. The first 4–12 bytes of the downloaded image are checked against well-known signatures:

| Magic Bytes | MIME Type |
|---|---|
| `FF D8` | `image/jpeg` |
| `89 50 4E 47` | `image/png` |
| `47 49 46` | `image/gif` |
| `52 49 46 46 … 57 45 42 50` | `image/webp` |

Falls back to the `Content-Type` header only if no signature matches.

**Files changed:** `lib/llm.ts` (lines 276–302)

---

#### Fix: Hallucination Bleed-Through in Revisions (`lib/llm.ts`)

**Problem:** When the editor flagged hallucinated facts, names, or statistics, the revision prompt did not explicitly forbid the copywriter from rephrasing the hallucinated material instead of removing it. This allowed incorrect information to survive through multiple revision cycles with different wording.

**Fix:** Added a `CRITICAL INSTRUCTION` block to the revision system prompt:

```
CRITICAL INSTRUCTION: If the editor tells you to remove a fact, name, quote, or
statistic because it is hallucinated or not in the source, YOU MUST REMOVE IT
COMPLETELY. Do not rephrase it or make up a replacement.
```

**Files changed:** `lib/llm.ts` (lines 582–583)

---

#### Fix: False-Positive Agent Error States (`lib/pipeline.ts`)

**Problem:** The editor loop marked agent tasks as `'failed'` for business-logic outcomes (skipping irrelevant content, replacing insufficient sources, routing items to no brand). This caused the pipeline UI to display alarming red error indicators for completely normal editorial decisions.

**Fix:** Audited every `updateAgentTask(id, taskId, 'failed')` call and reclassified editorial outcomes:

| Location | Old Status | New Status | Rationale |
|---|---|---|---|
| Router — item triage miss | `'failed'` | `'done'` | Skipping irrelevant content is correct behaviour |
| Router — SEO replacement log | `'failed'` | `'done'` | Logging a directive is not a failure |
| Editor — replacement queued | `'failed'` | `'done'` | Replacement strategy succeeded |
| Editor — unknown brand | `'failed'` | `'done'` | Graceful skip — not a system error |

**Files changed:** `lib/pipeline.ts` (multiple sites)

---

#### Fix: Image Quota Miss Handling (`lib/pipeline.ts`)

**Problem:** `runImageReview()` could return with zero valid images found but the article would still be marked `PASS` and queued for WordPress publish, resulting in imageless published articles.

**Fix:** `runImageReview()` now returns a boolean `imageQuotaMet`. The editor loop checks this return value: if false, the article is set to `Pending Review` with a diagnostics reason (`SYSTEM ERROR: 0 valid images found`) but the agent task is still marked `'done'` (not `'failed'`). This surfaces the issue for human triage without alarming the pipeline health indicators.

**Files changed:** `lib/pipeline.ts` (editor loop, image review integration)

---

#### Fix: MAX_REVISIONS Reason Tagging (`lib/pipeline.ts`)

**Problem:** When an article hit the maximum revision limit, the `reviewResult` stored in the database had the same schema as a normal rejection, making it hard to distinguish timeout exhaustion from legitimate quality failures during triage.

**Fix:** The final stored review reason is now prefixed with `[MAX REVISIONS REACHED]` before writing to the database.

**Files changed:** `lib/pipeline.ts` (editor loop, !passed block)

---

#### Feature: Destination Endpoint Node Types (`types/index.ts`)

Added three new `NodeId` union members representing pipeline output destinations:

```typescript
| 'website'
| 'social-media'
| 'video'
```

These match the OperationMap terminal nodes and allow typed state tracking for each destination channel.

**Files changed:** `types/index.ts` (lines 99–101)

---

#### Feature: Zigzag-Fan Layout & Z-Index Stacking (`components/OperationMap.tsx`, `app/globals.css`)

Full responsive pipeline diagram overhaul:
- Copywriter nodes A–E rendered in a staggered zigzag-fan arc for visual depth
- `.node-wrapper:hover { z-index: 999 }` CSS rule prevents expanded flip-card task overlays from being occluded by sibling nodes
- Sticky-footer pattern for `MasterControls` utilising full viewport height

---

#### Feature: Sandbox Test Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `scripts/test-brand-voice.ts` | End-to-end brand voice → LLM prompt → output verification |
| `scripts/test-editor-loop.ts` | Editor loop flow simulation |
| `scripts/test-image-review.ts` | Image review pipeline smoke test |

Runner config: `tsconfig.scripts.json` (CJS module target) decoupled from Next.js ESM config.

---

### v1.4.0 — Brand Voice Persistence & Pipeline Fidelity  
**Date:** 2026-03-30  
**Branch:** `master`

#### Summary
Fixed a critical silent data-loss bug where user-configured brand voice and tone instructions were being ignored by the pipeline background worker, causing every article to be written using hardcoded fallback guidelines instead of the user's custom instructions.

#### Bug Fix: `getSettings()` Silent Extended-Field Drop (Critical)

**Root cause:** `lib/pipeline.ts → getSettings()` used `prisma.settings.findUnique()` to read the `Settings` table. Prisma's generated client only returns columns declared in `schema.prisma`. The extended columns (`toneA–E`, `nicheA–E`, `rssSourcesA–E`, `imageCountA–E`) were added via raw SQL migrations and are **invisible to the Prisma ORM client**. The spread `{ ...defaults, ...row }` therefore always produced an object where the extended fields were `undefined`, falling back silently to the hardcoded defaults.

**Fix:** Added a supplementary `$queryRawUnsafe` SQL query inside `getSettings()` that explicitly selects all extended fields. The final settings object is built in three layers of priority:
```
{ ...defaults, ...prismaRow, ...rawSqlExtendedFields }
```

**Files changed:** `lib/pipeline.ts` (lines 254–307)

#### Feature: Brand Voice Sandbox Test (`scripts/test-brand-voice.ts`)

Verified results (2026-03-30T14:24 UTC+7):

| Copywriter | Brand | Tone Source | LLM Output |
|---|---|---|---|
| A | Anime | 🟢 User-configured | "Konvensi Anime Internasional Pecahkan Rekor..." (Bahasa Indonesia, otaku slang) |
| B | Toys | 🟢 User-configured | "...Peluang Emas untuk Kolektor..." (collector voice) |

**Run:** `npm run test:brand-voice`

---

### v1.3.0 — Dashboard UI Overhaul  
**Date:** 2026-03-30  
**Branch:** `master`

#### Summary
Comprehensive visual and UX overhaul of the Pantheon dashboard — pipeline diagram layout, flip-card node interactivity, real-time status bars, and settings persistence.

#### Feature: Zigzag-Fan Pipeline Layout (`components/OperationMap.tsx`)

Restructured the copywriter section from a flat column to a staggered zigzag-fan arc. Five copywriter nodes (A–E) offset vertically in an alternating pattern. The diagram uses the full viewport height via a sticky-footer pattern for `MasterControls`.

#### Fix: Flip-Card Node Z-Index Stacking

Added `.node-wrapper:hover { z-index: 999; position: relative; }` to prevent expanded task overlays being occluded by sibling nodes.

#### Feature: Dynamic Niche Status Bars (`components/SystemStatusBar.tsx`, `components/MasterControls.tsx`)

Replaced hardcoded niche labels with a live 5-column grid reading `settings.nicheA–E` at render time. Each pill displays brand icon, configured niche string, and brand-specific accent color.

#### Fix: Settings Save Race Condition (`components/PantheonDashboard.tsx`)

Added a `settingsOverride` state atom. After save, the API PUT response is immediately applied to `settingsOverride`. All components reading settings prefer `settingsOverride` over the polling result, eliminating the 0–10 second revert window.

---

### v1.2.0 — AI Pipeline UI Stabilization  
**Date:** 2026-03-30  
**Branch:** `master`

#### Summary
Bound `OperationMap` frontend nodes directly to real-time agent task data. Eliminated false-positive error states. Implemented high-frequency polling (1000ms) during active pipeline cycles.

#### Key Changes
- `components/FlipPipelineNode.tsx` — Refactored to accept live task arrays as props, replacing static mock data
- `components/PipelineNode.tsx` — Added granular status-based styling (idle / in-progress / done / failed)
- `lib/pipeline.ts` — Separated `EDITORIAL_REJECTION` from `SYSTEM_ERROR` states
- `components/TerminalLog.tsx` — Enhanced SSE stream integration with connection-status indicator

---

### v1.1.0 — Multi-Page Scraping & Editor Loop  
**Date:** 2026-03-29  
**Commit:** `1d1a593`

- Multi-page scraping support for RSS sources
- Incomplete-info editorial rejection tag surfaced in the pipeline UI
- Re-investigation loop: editor can request additional research before revision

---

### v1.0.1 — LLM Retry & Rate Limit  
**Date:** 2026-03-29  
**Commit:** `fc4d0c7` / `315ab49`

- Retry LLM call on JSON parse error (previously only re-parsed the same malformed text)
- Rate limit retry with exponential backoff
- Brand exclusivity filter
- Article count cap per pipeline cycle
- WordPress publish retry on transient failures

---

### v1.0.0 — Initial Release  
**Date:** 2026-03-28  
**Commit:** `c698e19`

Initial commit: Disciples AI Pipeline Dashboard.

- SEO Strategist → Investigator → Router → 5× Copywriter → 3× Editor pipeline
- WordPress REST API publish integration
- Prisma + SQLite persistence layer
- Next.js 14 dashboard with SSE real-time log stream
- Anthropic Claude integration (`claude-haiku-4-5-20251001`)

---

## Architecture Reference

### Pipeline Flow
```
RSS Sources
    │
    ▼
SEO Strategist ──── Keyword clustering, dedup, topic scoring
    │
    ▼
Investigator ──────── Multi-page scrape, source enrichment
    │
    ▼
Router ─────────────── Brand relevance scoring (A–E)
    │
    ├──▶ Copywriter A (Anime)
    ├──▶ Copywriter B (Toys)
    ├──▶ Copywriter C (Infotainment)
    ├──▶ Copywriter D (Game)
    └──▶ Copywriter E (Comic)
              │
              ▼
    ┌─────────────────┐
    │  Editor Pool    │  (A / B / C — round-robin with semaphore)
    │  QA & Review    │
    └────────┬────────┘
             │
    ┌────────┴──────────────┐
    ▼          ▼            ▼
Website    Social Media   Video
(WP REST)
```

### Settings Schema (Extended Fields)
The `Settings` table has columns managed outside Prisma's schema via raw SQL migrations. Always read these with `$queryRawUnsafe`:

| Column | Type | Description |
|---|---|---|
| `nicheA–E` | TEXT | Brand-specific niche override |
| `toneA–E` | TEXT | Full brand voice / system prompt for LLM |
| `rssSourcesA–E` | TEXT | Comma-separated RSS URLs per brand |
| `imageCountA–E` | INTEGER | Max images per article per brand |

### Key Files

| File | Role |
|---|---|
| `lib/pipeline.ts` | Core pipeline orchestration, `getSettings()`, agent task store |
| `lib/llm.ts` | LLM call wrappers: `draftArticle`, `reviseArticle`, `reviewArticle`, `fetchImageAsBase64` |
| `app/api/settings/route.ts` | Settings CRUD API — always uses raw SQL for extended fields |
| `components/PantheonDashboard.tsx` | Root dashboard, polling, `settingsOverride` state |
| `components/OperationMap.tsx` | Pipeline diagram SVG/DOM layout |
| `components/FlipPipelineNode.tsx` | Animated flip-card node with live task list |
| `scripts/test-brand-voice.ts` | Brand voice end-to-end LLM validation |
| `scripts/test-editor-loop.ts` | Editor loop simulation |
| `scripts/test-image-review.ts` | Image pipeline smoke test |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `SERPER_API_KEY` | ✅ | Google search via Serper for investigator |
| `WP_URL` | ✅ | WordPress site URL for article publishing |
| `WP_USER` | ✅ | WordPress username |
| `WP_APP_PASSWORD` | ✅ | WordPress application password |
| `DATABASE_URL` | ✅ | SQLite path (default: `./db/pantheon.db`) |

---

## Developer Reference

> 📖 **Full Syntax Index:** [`SYNTAX_INDEX.md`](./SYNTAX_INDEX.md) — every variable, type, function, and constant with usage notes.  
> This section is the quick-reference extract. When in doubt, check `SYNTAX_INDEX.md` first.

---

### Brand Identity Map

Five brands run in parallel. Every brand has a fixed ID, a settings key pair, a copywriter agent, and an LLM guidelines constant. **Never hardcode these strings — use the constants below.**

| Brand ID | Display Name | Niche Key | Tone Key | RSS Key | Image Count Key | Copywriter Agent |
|---|---|---|---|---|---|---|
| `anime` | Anime & Manga | `nicheA` | `toneA` | `rssSourcesA` | `imageCountA` | `Copywriter-A` |
| `toys` | Toys & Collectibles | `nicheB` | `toneB` | `rssSourcesB` | `imageCountB` | `Copywriter-B` |
| `infotainment` | Infotainment & Celebrity | `nicheC` | `toneC` | `rssSourcesC` | `imageCountC` | `Copywriter-C` |
| `game` | Gaming & Esports | `nicheD` | `toneD` | `rssSourcesD` | `imageCountD` | `Copywriter-D` |
| `comic` | Comics & Superheroes | `nicheE` | `toneE` | `rssSourcesE` | `imageCountE` | `Copywriter-E` |

**Source constants** (all in `lib/pipeline.ts`):

```typescript
BASE_BRANDS          // Array: { id, settingsNicheKey, settingsToneKey }
BRAND_AGENT_NAME     // Record<brandId, 'Copywriter-A' | ...>
BRAND_DISPLAY_NAME   // Record<brandId, human label>
BRAND_DEFAULT_NICHE  // Record<brandId, default niche string>
BRAND_TONE_KEY       // Record<brandId, keyof ExtendedSettings>
BRAND_IMAGE_COUNT_KEY // Record<brandId, keyof ExtendedSettings>
```

**LLM guideline constants** (in `lib/llm.ts`):

```typescript
BRAND_GUIDELINES     // Record<brandId, string> — system prompt per brand
// Individual: ANIME_GUIDELINES, TOYS_GUIDELINES, INFOTAINMENT_GUIDELINES,
//             GAME_GUIDELINES, COMIC_GUIDELINES
```

---

### Type Quick Reference (`types/index.ts`)

Always import shared types from `@/types`.

```typescript
// Article lifecycle
type ArticleStatus = 'Drafting' | 'Revising' | 'Pending Review' | 'Published' | 'Failed'

// Insight review states
type InsightStatus = 'Pending' | 'Approved' | 'Dismissed'

// Agents referenced by Insights
type TargetAgent = 'Investigator' | 'Copywriter-A' | 'Copywriter-B'
                 | 'Copywriter-C' | 'Copywriter-D' | 'Copywriter-E'

// UI node visual states
type NodeState = 'idle' | 'working' | 'success' | 'error'

// All pipeline node IDs (keys for OperationMap state)
type NodeId = 'seo-strategist' | 'investigator' | 'router'
            | 'copywriter-a' | 'copywriter-b' | 'copywriter-c' | 'copywriter-d' | 'copywriter-e'
            | 'editor' | 'editor-b' | 'editor-c'
            | 'publisher-a' | 'publisher-b' | 'publisher-c' | 'publisher-d' | 'publisher-e'
            | 'website' | 'social-media' | 'video'
```

**Key interfaces in brief:**

```typescript
interface Article {
  id, cycleId, brandId, status: ArticleStatus, title, content
  sourceUrl?, sourceTitle?, reviewResult?, // reviewResult is JSON string → parse before use
  wpPostId?, featuredImage?, images?,      // images is JSON string[] → parse before use
  revisionCount?, createdAt, updatedAt
}

interface Insight { id, targetAgent: TargetAgent, suggestionText, status: InsightStatus, createdAt }

interface AgentTask { id, description, status: 'queued'|'in-progress'|'done'|'failed', addedAt }

interface LogEntry { level: 'info'|'success'|'error'|'warn', message, timestamp }

interface Settings {
  id, scrapeFrequency, requireReview, isLive, targetNiche,
  nicheA–E, toneA–E, rssSourcesA–E, imageCountA–E,
  seoDedupeHours, seoShortTail, seoEvergreen,
  investigatorDedupeHours, investigatorMaxSameFranchise
}

interface TrendingTopic { keyword: string, traffic: string, newsList: string }
// Exported from lib/seo-strategist.ts — represents one Google Trends RSS item
```

---

### Core Function Surface

#### Pipeline Control (`lib/pipeline.ts`)

| Function | Signature | When to use |
|---|---|---|
| `runPipelineCycle` | `(isManual?: boolean) => Promise<string>` | Called by `/api/process-news` POST |
| `abortPipelineCycle` | `() => void` | Called by `/api/process-news/abort` POST |
| `getPipelineRunning` | `() => boolean` | Check if cycle is active |
| `getSettings` | `() => Promise<ExtendedSettings>` | **Always use this** — never `prisma.settings.findUnique()` alone |
| `addAgentTask` | `(agentId, description) => taskId` | Log work items visible in UI |
| `updateAgentTask` | `(agentId, taskId, status) => void` | Update task status (**see rule below**) |
| `getAllAgentTasks` | `() => Record<string, AgentTask[]>` | Called by `/api/agent-tasks` |
| `clearAllAgentTasks` | `() => void` | Called at the start of each cycle |
| `makeSemaphore` | `(concurrency) => runFn` | Limit parallel editor/publisher workers |
| `runImageReview` | `(articleId, title, source, count) => Promise<boolean>` | Shared by all editor workers |

#### LLM Calls (`lib/llm.ts`)

| Function | What it does |
|---|---|
| `triageArticle` | Is this headline relevant to the niche? → `boolean` |
| `draftArticle` | Generate article from raw text → `{ title, content }` |
| `reviewArticle` | QA check draft vs source → `{ status, reason, incompleteInfo }` |
| `reviseArticle` | Rewrite draft based on editor notes → `{ title, content }` |
| `reviewImage` | Claude Vision: is this image appropriate? → `{ status, reason }` |
| `fetchImageAsBase64` | Download image → base64 for Vision API (uses magic-byte MIME) |
| `filterDirectivesAgainstPublished` | Remove SEO keywords that duplicate published articles |
| `deduplicateByFranchise` | Limit same-IP/franchise articles per cycle |
| `detectTopicConcentration` | Detect over-concentration of a single topic in directives |
| `generateCopywriterFeedback` | Generate agent insight for Insights panel |
| `generateInvestigatorFeedback` | Generate investigator insight for Insights panel |
| `withRetry` | Wrap any LLM call with exponential backoff retry |

#### Data & Utilities

| Function | File | What it does |
|---|---|---|
| `fetchAllFeeds` | `lib/rss-fetcher.ts` | Fetch RSS items for a niche + custom feeds |
| `fetchFeedsForTopic` | `lib/rss-fetcher.ts` | Fetch feeds matching a specific topic keyword |
| `scrapeArticleContent` | `lib/article-scraper.ts` | Multi-page web scrape → text |
| `resolveItemImages` | `lib/image-resolver.ts` | Get image URLs for a feed item |
| `searchReplacementImage` | `lib/image-resolver.ts` | Find replacement when original image fails |
| `searchNews` | `lib/searcher.ts` | Serper news search |
| `searchMultiple` | `lib/searcher.ts` | Parallel multi-query news search |
| `hasBeenSeen` | `lib/dedup.ts` | Check if URL was already processed |
| `markAsSeen` | `lib/dedup.ts` | Mark URL as processed |
| `clearStore` | `lib/dedup.ts` | Wipe dedup cache |
| `publishToWordPress` | `lib/wordpress.ts` | Create WP post |
| `updateWordPressPost` | `lib/wordpress.ts` | Update existing WP post |
| `generateSeoDirectives` | `lib/seo-strategist.ts` | Generate `InvestigatorDirective[]` for cycle |
| `getRealTimeTrends` | `lib/seo-strategist.ts` | Fetch live trending topics from Google Trends RSS → `TrendingTopic[]` |
| `generateReplacementDirective` | `lib/seo-strategist.ts` | Replace one directive when topic over-concentrates |
| `startScheduler` / `stopScheduler` | `lib/scheduler.ts` | Cron auto-run control |
| `log` | `lib/logger.ts` | Emit log to SSE stream + terminal UI |
| `getMetricsStore` | `lib/metrics.ts` | Access singleton `CycleMetricsStore` |

#### Frontend API Client (`lib/api-client.ts`)

Use inside React components — **never import server-only libs in components**.

```typescript
api.getArticles()           // GET /api/articles
api.approveArticle(id)      // POST /api/articles/:id/approve → publishes to WP
api.updateLiveArticle(id)   // POST /api/articles/:id/update-live → syncs edits to WP
api.getInsights()           // GET /api/insights
api.approveInsight(id)      // POST /api/insights/:id/approve
api.dismissInsight(id)      // POST /api/insights/:id/dismiss
api.getAgentTasks()         // GET /api/agent-tasks → live task store
api.triggerPipeline()       // POST /api/process-news
api.abortPipeline()         // POST /api/process-news/abort
api.getSettings()           // GET /api/settings
api.updateSettings(data)    // PUT /api/settings
```

---

### 5 Rules Every Developer Must Know

> Breaking these rules has caused bugs in production. Commit them to memory.

**Rule 1 — Settings always use `getSettings()`**  
`prisma.settings.findUnique()` silently drops `nicheA–E`, `toneA–E`, `rssSourcesA–E`, `imageCountA–E` because they were added via raw SQL and are invisible to the Prisma client. Always call `getSettings()` from `lib/pipeline.ts`, which performs a supplementary `$queryRawUnsafe` and merges results.

**Rule 2 — `'failed'` tasks are system errors only**  
`updateAgentTask(id, taskId, 'failed')` turns the pipeline node red in the UI. Only use it for genuine exceptions. Editorial decisions (skipping irrelevant content, routing miss, franchise dedup) must use `'done'`.

**Rule 3 — No server libs in React components**  
`lib/pipeline.ts`, `lib/llm.ts`, `lib/wordpress.ts`, etc. are server-only. Import them only in `app/api/` route handlers. Use `lib/api-client.ts` (`api.*`) in components.

**Rule 4 — `reviewResult` and `images` are JSON strings**  
The DB columns are `String?`. Always `JSON.parse()` before accessing fields:
```typescript
const review = article.reviewResult ? JSON.parse(article.reviewResult) : null
const imgs   = article.images       ? JSON.parse(article.images) as string[] : []
```

**Rule 5 — All logs go through `log()`**  
`log('info', '[STAGE] message')` from `lib/logger.ts` is the only way a server-side message reaches the real-time terminal in the UI. `console.log` works in the server process but is invisible to the operator dashboard.

---

## Developer Commands

```bash
# Start dashboard
npm run dev                    # localhost:3000
npm run dev -- -p 3001        # localhost:3001

# Database
npm run db:push               # Push Prisma schema changes
npm run db:studio             # Open Prisma Studio

# Testing
npm run test:brand-voice      # Verify brand voice reaches LLM
npm run test                  # Jest unit tests
npm run test:coverage         # Coverage report
```
