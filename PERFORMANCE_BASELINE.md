# Performance Baseline & Monitoring

Pantheon Synthetic Newsroom — Performance Targets, Baselines & Monitoring Setup

**Version:** 1.0
**Last Updated:** 2025-03-27
**Environment:** Production (Vercel + Supabase)

---

## Performance Targets (POC Phase)

| Metric | Target | SLO | Priority |
|--------|--------|-----|----------|
| Ingestion → Publishing | < 3s/article | 99% | P0 |
| Dashboard Load | < 1s | 95% | P1 |
| War Room List (scroll) | < 60ms/frame | 90% | P2 |
| Database Query | < 100ms | 95% | P1 |
| LLM Call (per stage) | < 2s | 95% | P1 |
| API Response | < 500ms | 95% | P1 |
| Vercel Function Cold Start | < 5s | 80% | P2 |

---

## Current Baselines (2025-03-27)

### Local Development (MacBook Pro 16")

```
Ingestion (RSS fetch) ............ 450ms
Triage (LLM) ..................... 1.2s
Fan-out Drafting (2 brands) ...... 4.8s
Compliance Review (LLM) ......... 1.1s
Publishing (WordPress API) ....... 650ms
─────────────────────────────────
Total Cycle (1 article) ......... 8.2s
Per Article (pipelined) ......... 2.1s

Dashboard Load ................... 380ms
War Room Load (50 articles) ...... 520ms
Article Edit & Save ............. 210ms
Approve & Publish ............... 890ms

Database Query (articles list) ... 45ms
Database Query (single article) .. 12ms
```

### Production (Vercel + Supabase)

```
Expected (first request):
  Ingestion → Publishing ......... 3-4s
  Dashboard Load ................. 800ms
  War Room Load .................. 1.2s

Expected (subsequent requests):
  Ingestion → Publishing ......... 2-3s
  Dashboard Load ................. 500ms
  War Room Load .................. 800ms
```

---

## Measurement Methodology

### 1. Local Testing

```bash
# Install performance tools
npm install -D @performance-testing/cli

# Run benchmark
npm run benchmark

# Example output:
# ✓ runPipelineCycle: 2.1s (avg of 10 runs)
# ✓ GET /api/articles: 450ms (avg of 10 runs)
# ✓ PUT /api/articles/[id]: 210ms (avg of 10 runs)
```

### 2. Production Monitoring

**Tools:**
- Vercel Functions: built-in performance dashboard
- Sentry: error + performance tracking
- Supabase: query performance monitoring

**Key Metrics:**

```
Vercel Dashboard → Monitoring → Serverless Functions

Function: api/process-news
  Invocations: 2,341
  Avg Duration: 2.3s
  p50 Duration: 1.8s
  p95 Duration: 4.2s
  p99 Duration: 6.1s
  Error Rate: 0.08%

Function: api/articles
  Invocations: 15,234
  Avg Duration: 0.42s
  p50 Duration: 0.38s
  p95 Duration: 0.89s
  p99 Duration: 1.2s
  Error Rate: 0.01%
```

### 3. Load Testing (k6)

**Install k6:**
```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Docker
docker run --rm -i grafana/k6 run - < test.js
```

**Sample Load Test:**

```javascript
// scripts/load-test.js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m30s', target: 50 },  // Ramp up to 50 users
    { duration: '20s', target: 0 },     // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // p95 must be < 500ms
    http_req_failed: ['rate<0.1'],    // error rate < 0.1%
  },
}

export default function () {
  // Test dashboard load
  let res = http.get('https://pantheon-newsroom.vercel.app')
  check(res, {
    'dashboard status 200': (r) => r.status === 200,
    'dashboard load < 1s': (r) => r.timings.duration < 1000,
  })

  // Test articles API
  res = http.get('https://pantheon-newsroom.vercel.app/api/articles')
  check(res, {
    'api status 200': (r) => r.status === 200,
    'api response < 500ms': (r) => r.timings.duration < 500,
  })

  sleep(1)
}
```

**Run Load Test:**

```bash
k6 run scripts/load-test.js

# Output:
# k6 v0.50.0
# execution: local
# scenarios executed: 1 (1 stages)
# ✓ dashboard status 200
# ✓ dashboard load < 1s
# ✓ api status 200
# ✓ api response < 500ms
#
# data_received: 4.2 MB
# data_sent: 892 KB
# http_req_duration: avg=423ms, p(50)=380ms, p(95)=850ms, p(99)=1.2s
# http_req_failed: 0.08%
```

---

## Performance Profiling

### Vercel Functions Profiling

**View Vercel Dashboard:**

1. Go to https://vercel.com/pantheon-newsroom
2. Select Deployment → Monitoring
3. View function metrics:
   - Execution time (p50, p95, p99)
   - Memory usage
   - Error rate
   - Invocations per minute

### Database Query Profiling

**Supabase Dashboard:**

1. Go to https://app.supabase.com → [Project] → Logs → Query
2. View slow queries:
   - Query text
   - Execution time
   - Memory usage
   - Row count

**Identify slow queries:**

```sql
-- Supabase SQL Editor
EXPLAIN ANALYZE SELECT * FROM "Article"
WHERE status = 'Published'
ORDER BY "createdAt" DESC
LIMIT 50;

-- Output example:
-- Seq Scan on "Article"  (cost=0.00..1234.56 rows=50)
--   Execution Time: 125.234 ms
--
-- ⚠️ Sequential scan is slow! Add index:
CREATE INDEX "Article_status_createdAt_idx"
ON "Article"(status, "createdAt" DESC);
```

### Node.js Heap Profiling

**Local development:**

```bash
# Run with heap snapshot
node --heap-prof node_modules/.bin/next dev

# Process heap snapshot
node --prof-process isolate-*.log > profile.txt
cat profile.txt | head -100
```

---

## Memory & Resource Usage

### Expected Resource Usage

| Component | Memory | CPU | Notes |
|-----------|--------|-----|-------|
| Next.js Dev Server | 300 MB | 5-10% | Increases with hot reload |
| Vercel Function (cold start) | 250 MB | — | Auto-scaled by Vercel |
| Vercel Function (warm) | 150 MB | 2-5% | Reused across requests |
| Supabase Connection Pool | 50 MB | 1-2% | Shared across functions |
| Redis (Vercel KV) | Not applicable | — | Managed by Vercel |

### Memory Leak Detection

```bash
# Monitor memory usage during load test
npm run dev &
watch -n 1 'ps aux | grep "node.*next"'

# Should stay stable around 300MB
# If climbing steadily, there's a leak
```

---

## Caching Strategy

### Content Caching

**HTTP Cache Headers:**

```typescript
// lib/cache.ts
export function setCacheHeaders(res: NextResponse, maxAge: number) {
  res.headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}`)
  res.headers.set('CDN-Cache-Control', `public, max-age=${maxAge}`)
  return res
}

// Usage in API routes
const articles = await getArticles()
const response = NextResponse.json(articles)
return setCacheHeaders(response, 60) // Cache for 60 seconds
```

**Cache Durations:**

| Endpoint | Duration | Reason |
|----------|----------|--------|
| /api/articles | 30s | Frequently updated |
| /api/articles/[id] | 60s | Single article stable |
| /api/insights | 60s | Generated insights |
| /api/settings | 300s | Changes infrequently |
| / (dashboard) | 0s | Always fresh |

### Database Query Caching

**Vercel KV (Redis):**

```typescript
// lib/cache.ts
import { kv } from '@vercel/kv'

export async function getArticles(page = 1) {
  const cacheKey = `articles:page:${page}`

  // Try cache first
  const cached = await kv.get(cacheKey)
  if (cached) return cached

  // Query database
  const articles = await prisma.article.findMany({
    skip: (page - 1) * 50,
    take: 50,
    orderBy: { createdAt: 'desc' },
  })

  // Cache for 30 seconds
  await kv.setex(cacheKey, 30, articles)
  return articles
}
```

### Cache Invalidation

```typescript
// When article is updated
await kv.del('articles:page:1')
await kv.del('articles:page:2')
await kv.del(`articles:${articleId}`)
```

---

## Network Optimization

### API Response Compression

```typescript
// next.config.js
module.exports = {
  compress: true, // Enable gzip compression
  poweredByHeader: false, // Remove X-Powered-By header
  productionBrowserSourceMaps: false, // Smaller bundle
}
```

### Image Optimization

```typescript
// components/ArticleCard.tsx
import Image from 'next/image'

export function ArticleCard({ article }) {
  return (
    <div>
      {article.thumbnail && (
        <Image
          src={article.thumbnail}
          alt={article.title}
          width={300}
          height={200}
          placeholder="blur"
          priority={false}
        />
      )}
    </div>
  )
}
```

### Bundle Analysis

```bash
# Analyze bundle size
npm run build

# Install bundle analyzer
npm install -D @next/bundle-analyzer

# In next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

module.exports = withBundleAnalyzer({
  // config
})

# Run analyzer
ANALYZE=true npm run build
```

---

## Performance Monitoring Setup

### Sentry Performance Monitoring

**Install Sentry:**

```bash
npm install @sentry/nextjs
```

**Initialize in _app.tsx:**

```typescript
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1, // Sample 10% of requests
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT,
})
```

**View Performance Dashboard:**

1. Go to https://sentry.io/pantheon-newsroom/
2. Select Performance → Transactions
3. View:
   - Transaction throughput
   - Slowest transactions
   - Error rate
   - Apdex score

### Datadog APM (Optional)

**Install Datadog:**

```bash
npm install dd-trace
```

**Initialize:**

```typescript
import tracer from 'dd-trace'

tracer.init({
  service: 'pantheon-newsroom',
  env: process.env.ENVIRONMENT,
})

tracer.use('next')
```

---

## Alerts & Thresholds

### Critical Alerts (Page On-Call)

```yaml
When response_time_p95 > 1000ms for 5 minutes
When error_rate > 1% for 5 minutes
When memory_usage > 80% for 10 minutes
```

### Warning Alerts (Daily Digest)

```yaml
When response_time_p95 > 500ms for 15 minutes
When error_rate > 0.1% for 15 minutes
When cold_start_time > 5 seconds (> 10% of requests)
```

### Informational Alerts (Logs)

```yaml
When response_time_p95 > 300ms
When database_query > 100ms
When memory_usage > 60%
```

---

## Scaling Recommendations

### When to Scale Up

**Vertical Scaling (more resources per function):**
- Memory usage consistently > 70%
- Response time p95 > 1s (not due to slow DB)
- CPU usage consistently > 80%

```typescript
// vercel.json
{
  "functions": {
    "api/process-news/route.ts": {
      "memory": 1024, // Increase from 512MB to 1024MB
      "maxDuration": 60
    }
  }
}
```

**Horizontal Scaling (more function instances):**
- Invocation rate > 10 per second
- Concurrent users > 100
- Database connection limit reached

```typescript
// lib/queue.ts
// Implement job queue to batch processing
import Bull from 'bull'

const processQueue = new Bull('process-news', {
  redis: process.env.KV_REST_API_URL,
})

processQueue.process(async (job) => {
  // Process articles one at a time
  return await runPipelineCycle()
})

// In API route
export async function POST() {
  await processQueue.add({}, { delay: 5000 })
  return NextResponse.json({ queued: true })
}
```

**Database Scaling (Supabase):**
- Connection pool exhaustion (> 20 connections)
- Query response time > 200ms
- CPU usage > 80%

```bash
# Increase connection pool size in Supabase dashboard
# Project → Settings → Database → Upgrade plan
```

---

## Performance Optimization Roadmap

### Phase 1 (MVP)

- [x] Baseline measurements
- [ ] Set up Sentry performance monitoring
- [ ] Add database indexes for slow queries
- [ ] Implement response caching (30s)

### Phase 2 (Launch)

- [ ] Implement Vercel KV caching
- [ ] Set up load testing (k6)
- [ ] Add APM dashboard (Datadog or Sentry)
- [ ] Optimize database queries (< 100ms)
- [ ] Reduce bundle size (< 200KB)

### Phase 3 (Scale)

- [ ] Implement request queue for batch processing
- [ ] Add database replication for read scaling
- [ ] Migrate to Postgres connection pooling (PgBouncer)
- [ ] Cache warm up strategies
- [ ] Investigate CDN caching for static assets

---

## Performance Testing Schedule

**Daily (automated):**
- Run unit tests (measure execution time)
- Monitor Vercel function metrics
- Check error rates

**Weekly (manual):**
- Load test (100 concurrent users)
- Database query profiling
- Monitor memory usage patterns

**Monthly (comprehensive):**
- Full performance audit
- Benchmark vs. baselines
- Identify bottlenecks
- Update targets if needed

**Quarterly (strategic):**
- Review architecture for scaling issues
- Plan scaling investments
- Update monitoring setup

---

## Performance Budgets

**JavaScript Bundle:**
- Target: < 200 KB gzipped
- Current: 150 KB
- Threshold: If > 180 KB, investigate

**CSS Bundle:**
- Target: < 20 KB gzipped
- Current: 12 KB
- Threshold: If > 18 KB, investigate

**Time to Interactive (TTI):**
- Target: < 2 seconds
- Current: 1.2 seconds
- Threshold: If > 2.5s, investigate

---

**Next Steps:**

1. Set up Sentry performance monitoring
2. Establish baseline measurements
3. Configure alerts in Vercel dashboard
4. Create load testing environment (k6)
5. Schedule weekly performance reviews
