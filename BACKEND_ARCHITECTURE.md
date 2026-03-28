# Backend Architecture & System Design

## Overview

The Pantheon Synthetic Newsroom backend implements a 5-stage agentic workflow for semi-autonomous news production. This document describes the architecture, data flow, and design decisions.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API Gateway (Vercel)                        │
└──────────────────────────────────────────┬──────────────────────────┘
                                           │
          ┌────────────────────────────────┼────────────────────────────┐
          │                                │                            │
    ┌─────▼─────┐               ┌──────────▼──────────┐       ┌─────────▼────┐
    │ POST       │               │ GET /api/articles   │       │ POST /api/   │
    │ /process   │               │ PUT /api/articles/:id      │ insights/:id/ │
    │ -news      │               │ GET /api/settings   │       │ approve      │
    └─────┬─────┘               └────────────────────┘       └──────────────┘
          │
          │ Fire & Forget (Async)
          │
    ┌─────▼──────────────────────────────────────────────────────────┐
    │              Pipeline Orchestrator (runPipelineCycle)           │
    └─────┬──────────────────────────────────────────────────────────┘
          │
    ┌─────▼──────────────────────────────────────────────────────────┐
    │                   5-Stage Workflow Engine                       │
    │                                                                  │
    │  ┌──────────┐  ┌───────┐  ┌──────────┐  ┌──────┐  ┌─────────┐  │
    │  │ Stage 1  │  │Stage 2│  │ Stage 3  │  │Stage │  │ Stage 5 │  │
    │  │          │─▶│ Triage│─▶│ Drafting │─▶│ 4    │─▶│         │  │
    │  │Investigator    Router │  (Parallel)   │Review   │Publisher    │
    │  └──────────┘  └───────┘  └──────────┘  └──────┘  └─────────┘  │
    │                                                                  │
    │  Investigator: Fetch RSS → Dedup (KV)                           │
    │  Triage: LLM relevance check                                    │
    │  Drafting: Promise.all() 2+ copywriter prompts                  │
    │  Review: Guardrail (temp=0) + Strategic feedback                │
    │  Publisher: POST to WordPress REST API                          │
    └─────┬──────────────────────────────────────────────────────────┘
          │
    ┌─────▼──────────────────────────────────────────────────────────┐
    │                     Data Layer                                  │
    │                                                                  │
    │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
    │  │   Prisma ORM │  │   Vercel KV  │  │  External Services   │  │
    │  │   (Database) │  │   (Redis)    │  │  (WordPress, Slack)  │  │
    │  │              │  │              │  │                      │  │
    │  │ articles     │  │ url_hash →   │  │ - WordPress.com REST │  │
    │  │ insights     │  │ article_id   │  │ - Ghost CMS API      │  │
    │  │ settings     │  │              │  │ - Slack webhooks     │  │
    │  └──────────────┘  └──────────────┘  └──────────────────────┘  │
    └─────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Articles Table

```sql
CREATE TABLE "Article" (
  id            UUID PRIMARY KEY,
  cycleId       STRING NOT NULL,        -- Links to workflow cycle
  brandId       STRING NOT NULL,        -- gen-z-tech | formal-biz
  status        STRING NOT NULL,        -- See statuses below
  title         STRING NOT NULL,
  content       TEXT NOT NULL,          -- HTML or Markdown
  sourceUrl     STRING,                 -- Original news URL
  sourceTitle   STRING,                 -- Original headline
  reviewResult  JSON,                   -- Editor review output
  wpPostId      STRING,                 -- WordPress post ID
  createdAt     TIMESTAMP DEFAULT now(),
  updatedAt     TIMESTAMP DEFAULT now()
);

-- Indexes for performance
CREATE INDEX "articles_cycleId" ON "Article"("cycleId");
CREATE INDEX "articles_brandId" ON "Article"("brandId");
CREATE INDEX "articles_status" ON "Article"("status");
CREATE INDEX "articles_createdAt" ON "Article"("createdAt" DESC);
```

### Article Statuses

```
Drafted              → Draft created, initial state
Drafting            → In progress (temporary)
Pending Review      → Waiting for Editor review
Review Completed    → Editor feedback generated
Approved            → Approved for publication
Published           → Successfully published to WordPress
Failed              → Failed guardrail or publishing
```

### Insights Table

```sql
CREATE TABLE "Insight" (
  id             UUID PRIMARY KEY,
  targetAgent    STRING NOT NULL,       -- Investigator|Copywriter-A/B|Editor
  suggestionText STRING NOT NULL,       -- Actionable feedback
  status         STRING DEFAULT 'Pending', -- Pending|Approved|Dismissed
  createdAt      TIMESTAMP DEFAULT now()
);

CREATE INDEX "insights_status" ON "Insight"("status");
CREATE INDEX "insights_targetAgent" ON "Insight"("targetAgent");
```

### Settings Table

```sql
CREATE TABLE "Settings" (
  id              STRING PRIMARY KEY DEFAULT 'singleton',
  scrapeFrequency STRING,              -- "4h", "2h", etc.
  requireReview   BOOLEAN DEFAULT false,
  isLive          BOOLEAN DEFAULT false,
  targetNiche     STRING              -- "Indonesian property real estate"
);
```

---

## Stage Details

### Stage 1: Investigator (News Ingestion)

**Goal**: Fetch raw news, deduplicate, mark as seen

**Process**:
1. Fetch from configured RSS feeds
2. Hash each URL using SHA-256
3. Check Vercel KV for `hash:abc123 → article-id`
4. If found (seen before): skip
5. If not found: add to `newItems`
6. Mark all items as seen (regardless of relevance)

**Deduplication Strategy**:
- URL hashing with 7-day TTL
- Fallback to in-memory Map if KV unavailable
- Reset on server restart (acceptable for demo)

**Output**:
- Array of `FeedItem[]` (unseen items)
- Metrics: items fetched, items new, duration

### Stage 2: Triage Router (Relevance Filter)

**Goal**: Filter items by niche relevance

**Process**:
1. For each unseen item:
   - Send to Claude: "Is this relevant to [TARGET_NICHE]?"
   - Model: Claude 3 Haiku, temp=0.0 (deterministic)
   - Response: "YES" or "NO"
2. Keep "YES" items for drafting
3. Still mark all as seen (prevent reprocessing)

**LLM Call**:
```
Input tokens: ~150 per item
Output tokens: ~5
Cost per item: ~$0.0013
```

**Output**:
- Array of `FeedItem[]` (relevant items)
- Metrics: items evaluated, items passed, cost

### Stage 3: Drafting (Copywriter Fan-Out)

**Goal**: Generate multiple brand-specific drafts in parallel

**Process**:
1. For each relevant item:
   - Create DB record with status="Drafting"
   - Promise.all() for all brands simultaneously:
     - Brand A (Gen-Z): Energetic, conversational
     - Brand B (Formal): Authoritative, financial focus
   - LLM calls both in parallel
   - Update DB with drafted title/content
2. Collect all draft IDs for Stage 4

**LLM Call** (per brand):
```
Input tokens: ~200 (title + summary + brand guidelines)
Output tokens: ~300 (full article)
Cost per brand: ~$0.0016
Cost per item (2 brands): ~$0.0032
```

**Parallelization**:
- Uses `Promise.all()` — simultaneous Anthropic calls
- No rate limiting issues (calls made within same second)
- Graceful degradation: if one brand fails, others continue

**Output**:
- DB records: `status="Pending Review"` (temporary)
- Metrics: drafts created, duration, tokens

### Stage 4A: Editor Guardrail (Compliance Check)

**Goal**: Enforce factual accuracy, legal compliance, quality standards

**Process**:
1. For each drafted article:
   - Send to Claude with `temperature=0.0` (deterministic)
   - Prompt includes source material context
   - Check:
     - Factual accuracy vs. source
     - UUI ITE compliance (no defamation, hate speech)
     - Brand appropriateness
     - Professional quality
   - Response: `{ status: PASS/FAIL, reason, issues, suggestions }`
2. If FAIL: mark article as `status="Failed"`, store reason
3. If PASS: continue to Stage 4B

**UUI ITE Compliance** (Indonesian Law No. 11/2008):
- No defamation of individuals or groups
- No hate speech or incitement
- No false/misleading information
- Respect for privacy and dignity
- No obscene content

**LLM Call**:
```
Input tokens: ~500 (full article + source + guidelines)
Output tokens: ~100 (review result)
Cost per article: ~$0.0022
```

**Output**:
- Updated DB: `status="Failed"` or continue to 4B
- Stored review result JSON
- Metrics: articles passed, articles failed

### Stage 4B: Strategic Feedback (System Improvement)

**Goal**: Generate insights for continuous improvement

**Process**:
1. For each passing article, generate feedback for copywriter:
   - Best practice suggestions
   - Storytelling improvements
   - Audience connection tips
   - Market insight integration
2. For each brand, generate feedback for investigator:
   - Missing sources
   - Coverage gaps
   - Niche opportunities
3. Store insights with `status="Pending"`
4. Editors can approve (integrate into system prompt) or dismiss

**LLM Calls** (meta-feedback):
```
Low frequency, focused on improvement
Cost per cycle: ~$0.01
```

**Approved Insights Integration** (Future Enhancement):
```typescript
// If insight approved:
// const updatedPrompt = `${BRAND_GUIDELINES['gen-z-tech']}\n\nLATEST FEEDBACK:\n${insight.suggestionText}`
// Store in database for next cycle
```

### Stage 5: Publisher (WordPress Integration)

**Goal**: Publish approved articles to WordPress

**Process**:
1. If `requireReview=false`: auto-publish all passing articles
2. If `requireReview=true`: articles stay in `Pending Review` state
3. On PATCH `/api/articles/:id/approve`: publish via REST API
4. POST to `WP_URL/wp-json/wp/v2/posts` with article data
5. Extract returned `post_id` and `link`
6. Update DB: `status="Published"`, `wpPostId=123`

**WordPress API**:
```bash
POST /wp-json/wp/v2/posts HTTP/1.1
Authorization: Basic base64(user:password)
Content-Type: application/json

{
  "title": "Article Title",
  "content": "<p>HTML content</p>",
  "status": "publish",
  "meta": { "brand_id": "gen-z-tech" }
}
```

**Response**:
```json
{
  "id": 12345,
  "link": "https://site.com/2026/03/27/article-title/",
  "status": "publish"
}
```

**Error Handling**:
- WordPress API errors → Mark article as `Failed`
- Network timeout → Retry with exponential backoff
- Auth failure → Check credentials, log to Sentry

**Output**:
- Published articles with WordPress post IDs
- URLs for sharing
- Metrics: articles published, failures

---

## Request Flow Example

### Scenario: Manual Cycle Trigger

```
1. User: POST /api/process-news
   └─> Returns 202 Accepted with cycleId

2. Backend: runPipelineCycle() [async, fire-and-forget]
   ├─> Stage 1: Fetch 50 RSS items → 15 new
   ├─> Stage 2: Triage 15 items → 8 relevant
   ├─> Stage 3: Draft 8 items × 2 brands = 16 drafts
   ├─> Stage 4A: Review 16 drafts → 14 pass, 2 fail
   ├─> Stage 4B: Generate 2 insights for copywriters
   └─> Stage 5: Publish 14 articles to WordPress

3. User: GET /api/stream [SSE]
   └─> Receives real-time logs as each stage completes

4. User: GET /api/articles?status=Published
   └─> Lists 14 newly published articles

5. User: GET /api/metrics?cycleId=UUID
   └─> Views detailed metrics: 2500 tokens, $0.015 cost
```

---

## Error Handling Strategy

### By Severity

**Critical (Stop Pipeline)**:
- Database connection lost
- Anthropic API unavailable
- WordPress authentication failed

**Major (Skip Item)**:
- LLM timeout on single item
- Malformed RSS feed entry
- Invalid WordPress credentials

**Minor (Log & Continue)**:
- RSS feed unreachable (try next time)
- Slow network response (retry)
- Article already in cache

### Retry Logic

```typescript
// Exponential backoff
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    return await operation()
  } catch (err) {
    if (attempt === 3) throw err
    const delay = Math.pow(2, attempt) * 1000
    await new Promise(r => setTimeout(r, delay))
  }
}
```

---

## Performance Optimization

### Parallelization

- **Stage 3 (Drafting)**: All brands in parallel via `Promise.all()`
- **Batch Processing**: Multiple articles per cycle
- **Concurrent Requests**: Up to 10 simultaneous LLM calls

### Caching

- **URL Deduplication**: Vercel KV (Redis) with 7-day TTL
- **Article Metadata**: In-memory cache for recent cycles
- **LLM Responses**: No caching (freshness important)

### Database Optimization

- **Indexes on**: `cycleId`, `brandId`, `status`, `createdAt`
- **Pagination**: Cursor-based for large datasets
- **Batch Inserts**: Group writes when possible

---

## Security Considerations

### Data Protection

- **Secrets**: All API keys in environment variables
- **Logs**: Never log sensitive data (API keys, personal info)
- **Database**: Enforce HTTPS for connections
- **Backups**: Encrypt at rest with AES-256

### API Security

- **CORS**: Restrict to specific domains
- **Rate Limiting**: 100 requests/min per IP (configurable)
- **Input Validation**: Validate all query parameters
- **SQL Injection**: Prisma ORM prevents injection

### External Service Security

- **WordPress**: Use Application Passwords (not full passwords)
- **Anthropic**: Rate limits enforced on account level
- **Vercel KV**: TLS encryption in transit

---

## Scalability Path

### Current (Single Vercel Instance)

- Throughput: ~50 articles/cycle
- Cost: ~$0.015/cycle (~$0.36/day at 4h frequency)
- Storage: ~10MB/month

### Phase 2 (Queue-Based Workers)

```
Vercel Functions → Bull Queue (Redis) → Worker Pods
- Stage 1-2: Main worker
- Stage 3: Drafting workers (scale N)
- Stage 4: Review worker
- Stage 5: Publisher worker
```

### Phase 3 (Distributed Processing)

```
- Multi-region deployment
- Kafka/RabbitMQ for job distribution
- Dedicated GPU for embeddings (future)
- Caching layer for brand guidelines
```

---

## Testing Strategy

See `TESTING.md` for comprehensive test suite, but key areas:

- **Unit**: LLM prompts, dedup logic, validation
- **Integration**: Full 5-stage workflow with test data
- **E2E**: API endpoints with real database
- **Load**: Concurrent cycle triggers, stress test

---

## Monitoring & Alerts

### Key Metrics

- **Pipeline Duration**: Alert if > 10 minutes
- **Error Rate**: Alert if > 5% of articles fail
- **API Latency**: Alert if > 2 seconds
- **Cost**: Alert if > $1/day

### Dashboards

- Real-time pipeline progress (frontend)
- Historical metrics (Datadog)
- Error trends (Sentry)

---

## Future Enhancements

1. **Multi-Language Support**: Extend to non-Indonesian content
2. **Image Handling**: Auto-fetch, crop, optimize images for articles
3. **Social Media Cross-posting**: Share articles to Twitter, LinkedIn
4. **A/B Testing**: Experiment with different copywriter prompts
5. **Search**: Elasticsearch integration for article discovery
6. **Analytics**: Track reader engagement, optimize for SEO

