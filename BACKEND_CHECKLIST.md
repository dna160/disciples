# Backend Implementation Checklist

## Quick Verification Guide

Use this checklist to verify the complete backend implementation. Run from project root.

---

## File Structure Verification

### Core Library Files

```bash
# Verify all library files exist
ls -lh lib/
✓ lib/pipeline.ts          - 5-stage workflow orchestrator
✓ lib/llm.ts               - Anthropic SDK integration
✓ lib/wordpress.ts         - WordPress REST API bridge
✓ lib/rss-fetcher.ts       - RSS feed ingestion
✓ lib/dedup.ts             - URL deduplication logic
✓ lib/prisma.ts            - Prisma client setup
✓ lib/scheduler.ts         - Node-cron task scheduling
✓ lib/logger.ts            - Centralized logging
✓ lib/api-client.ts        - HTTP utilities
✓ lib/prompts.ts           - Centralized prompt templates [NEW]
✓ lib/api-types.ts         - TypeScript type definitions [NEW]
✓ lib/error-handler.ts     - Error handling utilities [NEW]
✓ lib/metrics.ts           - Observability & cost tracking [NEW]
```

### API Route Files

```bash
# Verify all API endpoints exist
ls -lh app/api/
✓ app/api/process-news/route.ts              - Cycle trigger
✓ app/api/articles/route.ts                  - List articles
✓ app/api/articles/[id]/route.ts             - Get/update article
✓ app/api/articles/[id]/approve/route.ts     - Publish article
✓ app/api/articles/[id]/update-live/route.ts - Publish to live
✓ app/api/insights/route.ts                  - List insights
✓ app/api/insights/[id]/approve/route.ts     - Approve insight
✓ app/api/insights/[id]/dismiss/route.ts     - Dismiss insight
✓ app/api/settings/route.ts                  - Settings management
✓ app/api/stream/route.ts                    - Server-Sent Events
✓ app/api/pipeline-status/route.ts           - Status check [NEW]
✓ app/api/metrics/route.ts                   - Metrics endpoint [NEW]
✓ app/api/mock-wordpress/route.ts            - Mock WP for testing
```

### Database Schema

```bash
# Verify Prisma schema
cat prisma/schema.prisma | grep -E "^model|@id|@default"
✓ Article model with all required fields
✓ Insight model with status enum
✓ Settings model with singleton pattern
✓ Proper indexes on frequent queries
```

### Documentation

```bash
# Verify documentation exists
ls -lh *.md
✓ README.md                     - Project overview
✓ TESTING.md                    - Test suite guide
✓ API_DOCUMENTATION.md          - Complete API reference [NEW]
✓ DEPLOYMENT.md                 - Deploy & operations guide [NEW]
✓ BACKEND_ARCHITECTURE.md       - Technical architecture [NEW]
✓ BACKEND_CHECKLIST.md          - This file [NEW]
```

---

## Environment Configuration

### Check Environment Variables

```bash
# Verify .env.local is set up
test -f .env.local && echo "✓ .env.local exists" || echo "✗ Missing .env.local"

# Check required keys are present
grep -c "ANTHROPIC_API_KEY" .env.local && echo "✓ Anthropic key configured"
grep -c "DATABASE_URL" .env.local && echo "✓ Database URL configured"
grep -c "WP_URL" .env.local && echo "✓ WordPress URL configured"

# List all configured variables
echo "=== Configured Environment Variables ===" && \
grep -v "^#" .env.local | grep -v "^$" | sort
```

---

## Dependencies & Build

### Verify Dependencies

```bash
# Check package.json has all required packages
npm list @anthropic-ai/sdk @prisma/client next node-cron
✓ @anthropic-ai/sdk (^0.27.0+)
✓ @prisma/client (^5.15.0+)
✓ next (^14.2.0+)
✓ node-cron (^3.0.0+)
✓ rss-parser (^3.13.0+)
✓ uuid (^10.0.0+)
```

### Build & Generate

```bash
# Generate Prisma client
npx prisma generate
✓ Prisma client generated

# Build TypeScript
npm run build
✓ Build successful (no TS errors)

# Check for type errors
npx tsc --noEmit
✓ No type errors
```

---

## Database Setup

### Initialize Database

```bash
# Create data directory
mkdir -p data

# Initialize Prisma
npx prisma generate
npx prisma db push

# Verify schema is applied
npx prisma db execute --stdin < /dev/null

# Check tables exist
npx prisma db execute --stdin <<'EOF'
.schema Article
.schema Insight
.schema Settings
EOF
✓ All tables created
```

### Verify Default Data

```bash
# Verify Settings singleton is created
npx prisma db execute --stdin <<'EOF'
SELECT * FROM "Settings" WHERE id = 'singleton';
EOF
✓ Settings singleton exists with defaults
```

---

## API Testing (Local)

### Start Server

```bash
# Terminal 1: Start development server
npm run dev
# ✓ Server running on http://localhost:3000
```

### Test Core Endpoints

```bash
# Terminal 2: Run tests

# 1. Health check
curl http://localhost:3000/api/pipeline-status | jq .
# ✓ Returns pipeline status

# 2. List articles (empty at start)
curl http://localhost:3000/api/articles | jq '.articles | length'
# ✓ Returns empty array or current articles

# 3. Get settings
curl http://localhost:3000/api/settings | jq '.settings'
# ✓ Returns settings singleton

# 4. List insights
curl http://localhost:3000/api/insights | jq '.insights'
# ✓ Returns empty array or current insights

# 5. Trigger pipeline
curl -X POST http://localhost:3000/api/process-news \
  -H "Content-Type: application/json" | jq .
# ✓ Returns 202 Accepted with cycleId

# 6. Monitor in real-time
curl http://localhost:3000/api/stream | jq -R 'fromjson?' | head -20
# ✓ Streams real-time logs
```

### Test Validation & Error Handling

```bash
# Invalid UUID
curl http://localhost:3000/api/articles/invalid-uuid | jq .
# ✓ Returns 400 validation error

# Non-existent article
curl http://localhost:3000/api/articles/550e8400-e29b-41d4-a716-446655440000 | jq .
# ✓ Returns 404 not found

# Invalid settings
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"scrapeFrequency":"invalid"}' | jq .
# ✓ Returns 400 validation error

# Concurrent pipeline trigger
curl -X POST http://localhost:3000/api/process-news &
curl -X POST http://localhost:3000/api/process-news &
wait
# ✓ Second returns 409 conflict
```

---

## Feature Completeness

### Stage 1: Investigator
- [ ] Fetches from RSS feeds (check rss-fetcher.ts)
- [ ] Hashes URLs for deduplication (check dedup.ts)
- [ ] Caches seen URLs in memory (or Vercel KV in prod)
- [ ] Returns array of new FeedItems

### Stage 2: Triage Router
- [ ] Sends items to Claude with niche prompt
- [ ] Uses temperature=0.0 for deterministic results
- [ ] Returns true/false for each item
- [ ] Marks all items as seen

### Stage 3: Drafting
- [ ] Creates Article records with Drafting status
- [ ] Fans out to all brands via Promise.all()
- [ ] Calls draftArticle() LLM function
- [ ] Updates articles with title/content
- [ ] Handles partial failures gracefully

### Stage 4: Review
- [ ] Phase A: Guardrail review with temperature=0.0
- [ ] Checks factual accuracy vs source
- [ ] Checks UUI ITE compliance
- [ ] Stores review result JSON
- [ ] Phase B: Generates strategic feedback
- [ ] Creates Insight records for agents
- [ ] Routes based on requireReview setting

### Stage 5: Publisher
- [ ] Calls publishToWordPress() for each article
- [ ] Posts to WordPress REST API
- [ ] Extracts post ID from response
- [ ] Updates article with wpPostId
- [ ] Changes status to Published
- [ ] Handles errors gracefully

---

## API Contract Verification

### Articles Endpoints

```bash
# GET /api/articles
curl "http://localhost:3000/api/articles?status=Published&limit=5" | jq '.'
# ✓ Has: articles[], pagination{}, timestamp

# GET /api/articles/:id
curl http://localhost:3000/api/articles/TEST-ID | jq '.'
# ✓ Has: article{}, timestamp OR error

# PUT /api/articles/:id
curl -X PUT http://localhost:3000/api/articles/TEST-ID \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated"}' | jq '.'
# ✓ Has: article{}, timestamp OR error

# DELETE /api/articles/:id
curl -X DELETE http://localhost:3000/api/articles/TEST-ID | jq '.'
# ✓ Has: message, id, timestamp OR error

# POST /api/articles/:id/approve
curl -X POST http://localhost:3000/api/articles/TEST-ID/approve | jq '.'
# ✓ Has: article{}, wpPostId, wpLink, timestamp OR error
```

### Insights Endpoints

```bash
# GET /api/insights
curl "http://localhost:3000/api/insights?status=Pending" | jq '.'
# ✓ Has: insights[], pagination{}, timestamp

# POST /api/insights/:id/approve
curl -X POST http://localhost:3000/api/insights/TEST-ID/approve | jq '.'
# ✓ Has: insight{}, message, timestamp OR error

# POST /api/insights/:id/dismiss
curl -X POST http://localhost:3000/api/insights/TEST-ID/dismiss | jq '.'
# ✓ Has: insight{}, message, timestamp OR error
```

### Settings & Status Endpoints

```bash
# GET /api/settings
curl http://localhost:3000/api/settings | jq '.'
# ✓ Has: settings{}, schedulerRunning, timestamp

# PUT /api/settings
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"isLive":true}' | jq '.'
# ✓ Has: success, settings{}, schedulerRunning, timestamp

# GET /api/pipeline-status
curl http://localhost:3000/api/pipeline-status | jq '.'
# ✓ Has: isRunning, uptime, lastCycleId, lastCycleStatus

# GET /api/metrics
curl http://localhost:3000/api/metrics | jq '.'
# ✓ Has: cycles[], count, timestamp

# GET /api/metrics?aggregates=true
curl http://localhost:3000/api/metrics?aggregates=true | jq '.'
# ✓ Has: summary{}, samples[]
```

---

## Code Quality Checks

### TypeScript Compilation

```bash
npx tsc --noEmit
# ✓ No errors
```

### Linting (if eslint configured)

```bash
npx eslint app/ lib/ --max-warnings 0
# ✓ No errors or warnings
```

### Test Suite

```bash
npm test
# ✓ All tests passing
npm run test:coverage
# ✓ Coverage > 70% for critical paths
```

---

## Security Verification

### Secrets & Environment

```bash
# Check no secrets in source
grep -r "sk-ant-" app/ lib/ --exclude-dir=node_modules && echo "✗ API key in source!" || echo "✓ No API keys in source"

# Check .env.local is in .gitignore
grep ".env.local" .gitignore && echo "✓ .env.local is ignored" || echo "✗ Add .env.local to .gitignore"

# Check no passwords in logs
grep -i "password" lib/logger.ts | grep -v "// " || echo "✓ No passwords logged"
```

### Input Validation

```bash
# Test invalid inputs are rejected
curl "http://localhost:3000/api/articles?status=<script>" | grep -i error && echo "✓ XSS prevented"
curl -X PUT http://localhost:3000/api/articles/x | jq '.code' | grep -i validation && echo "✓ Validation works"
```

### Error Messages

```bash
# Verify errors don't expose sensitive data
curl http://localhost:3000/api/nonexistent | jq '.error'
# ✓ Error message is generic, not exposing internal details
```

---

## Performance Verification

### Startup Time

```bash
# Measure cold start (from scratch)
time npm run dev
# ✓ Typical: 3-5 seconds
```

### API Response Time

```bash
# Measure endpoint latency
curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/articles
# ✓ List articles: < 500ms
# ✓ Get article: < 100ms
# ✓ Settings: < 50ms
```

### Database Query Performance

```bash
# Check slow queries (if using PostgreSQL)
psql -c "SELECT pg_stat_statements_reset();"
# Run some queries
# SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC;
# ✓ No queries > 1000ms
```

---

## Deployment Readiness Checklist

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] No secrets in source code
- [ ] All TypeScript types correct
- [ ] Tests passing (unit + integration)
- [ ] API responses match documentation
- [ ] Error handling comprehensive
- [ ] Logging configured
- [ ] CORS origins set correctly
- [ ] Database backups automated
- [ ] Monitoring/alerts configured
- [ ] Vercel project created
- [ ] GitHub repo connected
- [ ] Environment variables synced to Vercel
- [ ] Cron job configured in vercel.json (if using)
- [ ] Custom domain configured (optional)
- [ ] SSL certificates valid
- [ ] Rate limiting tested
- [ ] Load testing completed (for production)
- [ ] Security audit passed

---

## Troubleshooting Common Issues

### "ANTHROPIC_API_KEY not found"

```bash
# Check .env.local exists and has the key
test -f .env.local && grep ANTHROPIC_API_KEY .env.local

# Rebuild app to pick up env changes
npm run build
```

### "Database connection failed"

```bash
# Check DATABASE_URL is correct
echo $DATABASE_URL

# For SQLite, verify file exists or can be created
ls -la data/pantheon.db

# Reset database
rm data/pantheon.db
npx prisma db push
```

### "LLM calls failing with 401"

```bash
# Verify API key is active
curl https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY"

# Check key format (should start with sk-ant-v7-)
echo $ANTHROPIC_API_KEY | head -c 12
```

### "Type errors after update"

```bash
# Regenerate Prisma client
npx prisma generate

# Rebuild
npm run build

# Check for any new type issues
npx tsc --noEmit
```

---

## Quick Deployment Commands

```bash
# Local development
npm install && npm run dev

# Build for production
npm run build

# Test before deploy
npm test && npm run test:coverage

# Deploy to Vercel
vercel

# View logs
vercel logs --follow

# Rollback
vercel rollback
```

---

## References

- **API Docs**: `API_DOCUMENTATION.md`
- **Architecture**: `BACKEND_ARCHITECTURE.md`
- **Deployment**: `DEPLOYMENT.md`
- **Testing**: `TESTING.md`
- **Anthropic Docs**: https://docs.anthropic.com/
- **Prisma Docs**: https://www.prisma.io/docs/
- **Vercel Docs**: https://vercel.com/docs

