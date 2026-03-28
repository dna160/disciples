# Incident Response Playbook

Pantheon Synthetic Newsroom — Common Failure Scenarios & Recovery Procedures

**Version:** 1.0
**Last Updated:** 2025-03-27
**On-Call:** [Slack Channel]

---

## Incident Severity Levels

| Level | Response Time | Impact | Example |
|-------|----------------|--------|---------|
| **P1 (Critical)** | 5 minutes | Users cannot access site | Database down, Auth failure |
| **P2 (High)** | 15 minutes | Core feature broken | LLM API failure, Pipeline stuck |
| **P3 (Medium)** | 1 hour | Partial degradation | One brand not drafting |
| **P4 (Low)** | Next business day | Minor issues | UI bug, slow dashboard |

---

## Incident Response Flow

```
1. DETECT (monitoring, user report)
   ↓
2. ACKNOWLEDGE (page on-call, start incident in Slack)
   ↓
3. INVESTIGATE (check logs, identify root cause)
   ↓
4. MITIGATE (apply fix or rollback)
   ↓
5. VERIFY (confirm service restored)
   ↓
6. COMMUNICATE (post-mortem, document)
```

---

## P1: Database Connection Lost

**Impact:** All API endpoints fail, data cannot be read/written

### Detection

- Sentry error: `Error: connect ECONNREFUSED`
- Vercel logs show repeated `PrismaClientRustPanicError`
- Dashboard shows error modal

### Immediate Action (0-5 minutes)

```bash
# 1. Check Supabase status
curl https://status.supabase.com/

# 2. Verify DATABASE_URL in Vercel
vercel env ls --token $VERCEL_TOKEN | grep DATABASE_URL

# 3. Test connection
psql $DATABASE_URL -c "SELECT 1"

# 4. If Supabase is up, restart Vercel function
vercel redeploy --token $VERCEL_TOKEN
```

### Investigation

**Check Supabase Dashboard:**
1. Go to https://app.supabase.com → [Project] → Infrastructure
2. Look for "Disk usage" and "Connections"
3. If connections > 25, you have a connection pool exhaustion

**Check Vercel Logs:**
```bash
vercel logs --tail --token $VERCEL_TOKEN | grep -i "error\|connection"
```

**Check Recent Deployments:**
```bash
git log --oneline main | head -3
```

### Recovery

**Option A: Connection Pool Exhaustion**
```bash
# Scale up connection pool (in Vercel environment)
vercel env set DATABASE_CONNECTION_POOL_SIZE 20 --token $VERCEL_TOKEN

# Restart functions
vercel redeploy --token $VERCEL_TOKEN
```

**Option B: Supabase Issues**
```bash
# If Supabase is down:
# 1. Failover to backup database (if configured)
# 2. Or rollback to previous known-good deployment

git revert HEAD -m "Revert due to DB issues"
git push origin main
```

**Option C: Test Database is Corrupt**
```bash
# Check schema integrity
npx prisma db execute --stdin < scripts/validate-schema.sql

# If corrupt, reset (production: don't do this!)
# Only for staging/test:
# npx prisma db push --force-reset
```

### Verification (5-10 minutes)

```bash
# Test API endpoint
curl https://pantheon-newsroom.vercel.app/api/articles

# Check Sentry for new errors
# If no new connection errors in 2 minutes, you're good

# Verify Vercel function logs clean
vercel logs --token $VERCEL_TOKEN | tail -20
```

### Communication

**Slack Channel (🚨 incident channel):**
```
🚨 [P1] Database Connection Lost
Status: RESOLVED
Root Cause: Connection pool exhaustion after deployment
Fix: Scaled pool size from 10 to 20 connections
Duration: 4 minutes
Impact: API unavailable for 4 minutes
Follow-up: Monitor connection usage, add alerts

/cc @on-call @engineering-leads
```

---

## P2: LLM API Failing (Anthropic)

**Impact:** Pipeline cannot triage/draft articles, stuck in "Drafting" status

### Detection

- Articles stuck in "Drafting" status
- Sentry error: `APIError 500` or `RateLimitError`
- Vercel logs show `Error calling Anthropic API`
- Users report articles not progressing

### Immediate Action (0-15 minutes)

```bash
# 1. Check Anthropic Status
curl https://status.anthropic.com/

# 2. Verify API key is valid
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"test"}]}' \
  | jq .

# 3. Check rate limits
# Look at response headers: x-ratelimit-remaining-requests
```

### Investigation

**Check Vercel Logs:**
```bash
vercel logs --tail | grep -A5 "anthropic\|claude"
```

**Is it a Rate Limit?**
- Error message contains "429" or "rate limit"
- Solution: Implement exponential backoff + queue

**Is it an Auth Error?**
- Error message contains "401" or "Unauthorized"
- Solution: Verify ANTHROPIC_API_KEY in Vercel dashboard

**Is it a Model Unavailability?**
- Error message contains "Model not found" or "overloaded"
- Solution: Fallback to different model or skip articles

### Recovery

**Option A: Rate Limit - Implement Backoff**

Edit `lib/llm.ts`:
```typescript
async function callAnthropicWithRetry(prompt: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      })
    } catch (error: any) {
      if (error.status === 429 && i < maxRetries - 1) {
        const delayMs = Math.pow(2, i) * 1000 // 1s, 2s, 4s
        console.log(`Rate limited, retrying in ${delayMs}ms`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else {
        throw error
      }
    }
  }
}
```

Then deploy:
```bash
git add lib/llm.ts
git commit -m "Add exponential backoff for Anthropic rate limiting"
git push origin main
```

**Option B: Auth Error - Rotate API Key**

1. Go to https://console.anthropic.com/account/keys
2. Generate new API key
3. Update in Vercel:
   ```bash
   vercel env set ANTHROPIC_API_KEY "sk-ant-new-key" --token $VERCEL_TOKEN
   ```
4. Redeploy:
   ```bash
   vercel redeploy --token $VERCEL_TOKEN
   ```

**Option C: Model Unavailable - Fallback to Different Model**

Edit `lib/llm.ts`:
```typescript
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307'
// Add fallback
const FALLBACK_MODEL = 'claude-3-sonnet-20240229' // slower but more reliable
```

Or skip articles temporarily:
```typescript
if (isAnthropicDown()) {
  article.status = 'Failed'
  article.reviewResult = JSON.stringify({
    status: 'FAIL',
    reason: 'LLM service temporarily unavailable'
  })
  await db.article.update({...})
}
```

### Verification (15-30 minutes)

```bash
# Test LLM endpoint
curl -X POST https://pantheon-newsroom.vercel.app/api/process-news \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\n%{http_code}"

# Should return 202 (accepted)
# Check logs for pipeline progress
vercel logs --tail | grep "triageArticle\|draftArticle"
```

### Communication

```
⚠️ [P2] LLM API Rate Limiting
Status: MITIGATED
Root Cause: High traffic caused rate limit hits
Fix: Implemented exponential backoff (max 3 retries)
Duration: 12 minutes
Impact: ~15 articles queued, now processing
Follow-up: Monitor retry patterns, consider upgrading Anthropic plan

/cc @on-call
```

---

## P2: WordPress API Failing

**Impact:** Cannot publish articles, stuck in "Pending Review"

### Detection

- Articles stay in "Pending Review" despite approval
- Sentry error: `Error: WordPress API returned 401/403/5xx`
- Vercel logs: `POST /wp-json/wp/v2/posts failed`

### Immediate Action (0-15 minutes)

```bash
# 1. Test WordPress REST API
curl -X POST https://your-site.com/wp-json/wp/v2/posts \
  -u "username:app_password" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","status":"draft"}' \
  -w "\n%{http_code}"

# 2. Check WordPress site status
curl https://your-site.com/wp-admin/ -w "\n%{http_code}"

# 3. Verify credentials in Vercel
vercel env ls | grep WP_
```

### Investigation

**401 Unauthorized:**
- Invalid username or app password
- App password may have been revoked

**403 Forbidden:**
- User doesn't have "create_posts" capability
- User role might be restricted

**5xx Server Error:**
- WordPress plugin conflict
- Server resource exhaustion

### Recovery

**Option A: Invalid Credentials**

1. In WordPress Admin: Users → Your Profile → Application Passwords
2. Generate new app password
3. Update Vercel:
   ```bash
   vercel env set WP_APP_PASSWORD "new_password" --token $VERCEL_TOKEN
   ```
4. Redeploy and retry publishing

**Option B: Permission Error**

1. In WordPress Admin: Users → [User] → Role
2. Ensure role is "Editor" or "Administrator"
3. Manually publish pending articles:
   ```sql
   UPDATE "Article" SET status = 'Published', wpPostId = 'wp-123' WHERE status = 'Pending Review' LIMIT 5;
   ```

**Option C: WordPress Plugin Conflict**

1. Disable recently activated plugins
2. Test REST API again
3. Re-enable plugins one by one

### Verification

```bash
# Retry publishing
curl -X POST https://pantheon-newsroom.vercel.app/api/articles/[id]/approve \
  -H "Content-Type: application/json" \
  -d '{"approve":true}'

# Should return 200 with updated status
```

### Communication

```
⚠️ [P2] WordPress API Authentication Failed
Status: RESOLVED
Root Cause: App password was revoked in WordPress
Fix: Regenerated new app password, updated Vercel secrets
Duration: 8 minutes
Impact: 12 articles failed to publish, now queued for retry
Follow-up: Set calendar reminder to rotate app passwords quarterly

/cc @on-call @wordpress-admin
```

---

## P3: One Brand Not Drafting

**Impact:** One of two brands (gen-z-tech OR formal-biz) missing from War Room

### Detection

- War Room shows only articles with one brand
- Pipeline logs show `draftArticle` called once instead of twice
- Sentry error: `error in Copywriter-B`

### Investigation

```bash
# Check articles in database
psql $DATABASE_URL

SELECT DISTINCT "brandId", COUNT(*) FROM "Article"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY "brandId";

# If one brand has 0 articles, check logs
vercel logs --tail | grep "draftArticle\|formal-biz\|gen-z-tech"
```

### Recovery

**Option A: Prompt Error for One Brand**

Edit `lib/prompts.ts` and add brand-specific handling:
```typescript
export function generateDraftPrompt(title: string, content: string, brand: string) {
  if (brand === 'formal-biz') {
    return `[formal business tone prompt]`
  } else if (brand === 'gen-z-tech') {
    return `[gen-z tech tone prompt]`
  } else {
    throw new Error(`Unknown brand: ${brand}`)
  }
}
```

**Option B: Fan-out Logic Broken**

Check `lib/pipeline.ts`:
```typescript
async function fanOutDrafting(article: Article) {
  const results = await Promise.allSettled([
    draftArticle(article, 'gen-z-tech'),
    draftArticle(article, 'formal-biz'),
  ])

  // One might have failed
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Brand ${i} failed: ${result.reason}`)
    }
  })
}
```

Fix: Don't fail the entire pipeline, log the issue:
```typescript
const brand = i === 0 ? 'gen-z-tech' : 'formal-biz'
await db.article.create({
  data: {
    status: 'Failed',
    brandId: brand,
    reason: result.reason,
  }
})
```

### Verification

```bash
# Trigger new pipeline run
curl -X POST https://pantheon-newsroom.vercel.app/api/process-news

# Check both brands created articles
psql $DATABASE_URL
SELECT "brandId", COUNT(*) FROM "Article"
WHERE "createdAt" > NOW() - INTERVAL '2 minutes'
GROUP BY "brandId";
# Should show 2 rows: gen-z-tech: 1, formal-biz: 1
```

---

## P3: Dashboard Slow (> 2 seconds load)

**Impact:** Users report sluggish dashboard, Operation Map slow to render

### Detection

- Sentry Performance: Page Load > 2000ms
- User reports: Dashboard takes 5+ seconds
- Vercel Logs: Slow query times

### Investigation

```bash
# Check Vercel function response times
vercel logs --token $VERCEL_TOKEN | grep "GET /api/articles"

# If response > 500ms, likely database slow
# Check database query performance
psql $DATABASE_URL
EXPLAIN ANALYZE SELECT * FROM "Article" ORDER BY "createdAt" DESC LIMIT 100;

# Look for sequential scans or missing indexes
```

### Recovery

**Option A: Add Database Index**

```sql
-- Add index for common queries
CREATE INDEX "Article_createdAt_idx" ON "Article"("createdAt" DESC);
CREATE INDEX "Article_status_idx" ON "Article"("status");
```

Then update `prisma/schema.prisma`:
```prisma
model Article {
  ...
  @@index([createdAt])
  @@index([status])
}
```

**Option B: Paginate Results**

Edit `app/api/articles/route.ts`:
```typescript
const limit = 50
const skip = (page - 1) * limit

const articles = await prisma.article.findMany({
  skip,
  take: limit,
  orderBy: { createdAt: 'desc' }
})

return NextResponse.json({ articles, total, page })
```

**Option C: Cache Results**

Use Vercel KV:
```typescript
import { kv } from '@vercel/kv'

async function getArticles() {
  const cached = await kv.get('articles:list')
  if (cached) return cached

  const articles = await prisma.article.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' }
  })

  // Cache for 30 seconds
  await kv.setex('articles:list', 30, articles)
  return articles
}
```

### Verification

```bash
# Measure page load
time curl https://pantheon-newsroom.vercel.app/api/articles > /dev/null

# Should be < 500ms
```

---

## P4: UI Bug (Article Title Not Saving)

**Impact:** Users can edit but changes don't persist, annoyance but not critical

### Detection

- User reports: Edit title, click save, title reverts
- Sentry error: `PUT /api/articles/[id] returned 500`

### Investigation

```bash
# Check recent errors in Sentry
# Look for PUT /api/articles in Vercel logs

vercel logs --tail | grep "PUT /api/articles"
```

### Recovery

**Check API Route:**

`app/api/articles/[id]/route.ts`:
```typescript
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json()

  if (!body.title || body.title.length === 0) {
    return NextResponse.json(
      { error: 'Title required' },
      { status: 400 }
    )
  }

  const article = await prisma.article.update({
    where: { id: params.id },
    data: { title: body.title }
  })

  return NextResponse.json(article)
}
```

**Check Frontend:**

`components/ArticleEditor.tsx`:
```typescript
const handleSave = async () => {
  try {
    const res = await fetch(`/api/articles/${article.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editedTitle })
    })

    if (!res.ok) throw new Error('Save failed')

    // Re-fetch article
    const updated = await res.json()
    setArticle(updated)
    setEditedTitle('')
  } catch (err) {
    setError(err.message)
  }
}
```

---

## Post-Incident Process

### Immediate (within 1 hour)

1. **Document in Slack:**
   - Start time, duration
   - Root cause
   - Steps taken to resolve
   - Impact (affected users/data)

2. **Create Incident Ticket:**
   ```bash
   # In GitHub Issues
   Title: "Incident: [Service] failed on [Date] for [Duration]"
   Labels: incident, post-mortem
   Description:
   - What happened?
   - Why did it happen?
   - How long was it down?
   - What was the impact?
   - What did we do to fix it?
   - What will we do to prevent it?
   ```

### Within 24 Hours

1. **Post-Mortem Meeting:**
   - Engineering lead, on-call, affected stakeholders
   - 30-minute session
   - Discussion: What went well? What didn't? What's next?

2. **Action Items:**
   - Create follow-up tickets for prevention
   - Assign owners and deadlines
   - Example: "Add alerts for LLM rate limits by Friday"

3. **Update Documentation:**
   - Add lessons learned to this playbook
   - Update runbooks if process changed

---

## On-Call Escalation

**If you can't resolve in 15 minutes:**

1. Slack: `@engineering-lead` with incident details
2. Phone: Call on-call manager (number in Slack profile)
3. Do NOT wait more than 20 minutes

**Escalation Chain:**
1. Backend on-call → 2. Engineering Lead → 3. CTO

---

## Monitoring & Alerting

Make sure these are configured in Sentry/Datadog:

```yaml
Alerts:
  - Error rate > 1% → Page on-call
  - Response time (p95) > 2s → Notify #alerts
  - Database connections > 20 → Notify #alerts
  - LLM API errors > 5 in 5min → Notify #alerts
  - Disk usage > 80% → Daily summary
```

---

## Incident Severity Examples

**P1 (5 min response):**
- "Cannot load dashboard" (all users)
- "Database down"
- "All articles failing to publish"

**P2 (15 min response):**
- "One brand not drafting"
- "LLM rate limited"
- "WordPress API returning 500s"

**P3 (1 hour response):**
- "Dashboard loading slow (2-3s)"
- "One article failing to save"
- "Insights not updating"

**P4 (next day):**
- "Minor UI styling issue"
- "Occasional typo in SSE log"
- "Button text misleading"

---

## Playbook Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-03-27 | Initial playbook with 5 common incidents |
| 1.1 | TBD | Add new incidents as they occur |

**Last Updated:** 2025-03-27
**Next Review:** 2025-06-27
