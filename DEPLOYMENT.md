# Deployment & Operational Guide

## Quick Start (Local Development)

### 1. Environment Setup

```bash
# Copy environment template
cp .env.local.example .env.local

# Edit .env.local with your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-v7-your-key-here
```

### 2. Database Initialization

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Initialize SQLite database
npm run db:init

# Optional: Open Prisma Studio for visual inspection
npm run db:studio
```

### 3. Start Development Server

```bash
npm run dev
```

Server runs on `http://localhost:3000`

### 4. Test the API

```bash
# Check system status
curl http://localhost:3000/api/pipeline-status

# Trigger a news cycle manually
curl -X POST http://localhost:3000/api/process-news

# Monitor logs in real-time
curl http://localhost:3000/api/stream
```

---

## Configuration by Environment

### Development (Local)
```env
ENVIRONMENT=development
REQUIRE_REVIEW=false
ENABLE_SCHEDULER=false
CRON_SCHEDULE=*/10 * * * *  # Every 10 minutes
DEBUG_PIPELINE=true
EXPOSE_ERRORS_IN_RESPONSE=true
```

### Staging
```env
ENVIRONMENT=staging
REQUIRE_REVIEW=true
ENABLE_SCHEDULER=true
CRON_SCHEDULE=0 */6 * * *  # Every 6 hours
DATABASE_URL=postgresql://user:pass@staging-db:5432/pantheon
```

### Production
```env
ENVIRONMENT=production
REQUIRE_REVIEW=true
ENABLE_SCHEDULER=true
CRON_SCHEDULE=0 */4 * * *  # Every 4 hours
DATABASE_URL=postgresql://user:pass@prod-db:5432/pantheon
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022  # Higher quality
KV_REST_API_TOKEN=your_vercel_kv_token
KV_REST_API_URL=https://....kv.vercel.sh
EXPOSE_ERRORS_IN_RESPONSE=false
DEBUG_PIPELINE=false
```

---

## Vercel Deployment

### Prerequisites
- GitHub repository with this code
- Vercel account
- Anthropic API key
- Supabase PostgreSQL database (optional, for production)

### Step 1: Connect Repository

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

### Step 2: Configure Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

```
ANTHROPIC_API_KEY = sk-ant-v7-...
DATABASE_URL = postgresql://...
WP_URL = https://your-wordpress.com/wp-json/wp/v2/posts
WP_USERNAME = your_username
WP_APP_PASSWORD = your_app_password
KV_REST_API_TOKEN = (from Vercel KV)
KV_REST_API_URL = (from Vercel KV)
ENVIRONMENT = production
ENABLE_SCHEDULER = true
CRON_SCHEDULE = 0 */4 * * *
```

### Step 3: Configure Cron Jobs

In `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/process-news",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

This triggers `/api/process-news` every 4 hours automatically.

### Step 4: Verify Deployment

```bash
# Check deployment logs
vercel logs --follow

# Test API endpoint
curl https://your-project.vercel.app/api/pipeline-status
```

---

## Database Migration (SQLite → PostgreSQL)

For moving from local SQLite to production PostgreSQL:

### Step 1: Export SQLite Data

```bash
# Backup current SQLite database
cp data/pantheon.db data/pantheon.db.backup

# Update DATABASE_URL to PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/pantheon
```

### Step 2: Run Migrations

```bash
# Generate new client for PostgreSQL
npx prisma generate

# Apply schema to PostgreSQL
npx prisma db push

# Optionally seed initial data
npm run db:seed
```

### Step 3: Verify Migration

```bash
# Test database connection
npm run db:studio

# Verify data integrity
curl http://localhost:3000/api/articles
```

---

## Monitoring & Observability

### Real-Time Logs

```bash
# Stream pipeline logs to terminal
curl http://localhost:3000/api/stream | jq '.'
```

### Metrics & Analytics

```bash
# Get cycle metrics
curl http://localhost:3000/api/metrics?aggregates=true

# Get specific cycle
curl http://localhost:3000/api/metrics?cycleId=UUID
```

### Health Checks

```bash
# Liveness check
curl http://localhost:3000/api/pipeline-status

# Check database connectivity
curl http://localhost:3000/api/articles?limit=1
```

### Integration with External Services

#### Datadog
```env
DATADOG_API_KEY=your_datadog_api_key
DATADOG_SERVICE_NAME=pantheon-newsroom
```

#### Sentry (Error Tracking)
```env
SENTRY_DSN=https://your@sentry.io/123456
```

---

## Troubleshooting

### Issue: "Rate limit exceeded" from Anthropic

**Cause**: Too many concurrent LLM calls

**Solution**:
1. Increase CRON_SCHEDULE interval (e.g., `0 */6 * * *` instead of `0 */4 * * *`)
2. Set `REQUIRE_REVIEW=true` to batch processing
3. Contact Anthropic for higher rate limits

### Issue: "Database connection timeout"

**Cause**: PostgreSQL connection pool exhausted

**Solution**:
```env
# Add connection limits
# Supabase: Use connection pooling mode in settings
# Self-hosted: Increase max_connections in postgresql.conf
```

### Issue: Articles not publishing to WordPress

**Cause**: Invalid WP_APP_PASSWORD or wrong WP_URL

**Solution**:
1. Verify WordPress credentials: `curl -u user:pass https://your-wp.com/wp-json/wp/v2/posts`
2. Check WordPress REST API is enabled
3. Ensure Application Password has correct permissions (Editor or higher)

### Issue: Pipeline hangs during drafting

**Cause**: LLM timeout or network issue

**Solution**:
1. Check Anthropic API status: https://status.anthropic.com/
2. Increase timeout in lib/llm.ts: `max_tokens: 1024` → `max_tokens: 2048`
3. Restart the application

### Issue: Deduplication not working

**Cause**: Vercel KV not configured or Redis connection lost

**Solution**:
```bash
# Test Vercel KV connection
redis-cli -u redis://default:@... ping

# Fallback to in-memory: Comment out KV_REST_API_TOKEN
```

---

## Performance Optimization

### For High Volume (1000+ articles/day)

1. **Increase Supabase Resources**
   ```sql
   -- Connection pooling
   ALTER SYSTEM SET max_connections = 1000;

   -- Increase work memory
   ALTER SYSTEM SET work_mem = '256MB';
   ```

2. **Enable Redis Caching**
   ```env
   KV_REST_API_TOKEN=your_vercel_kv_token
   DEDUP_TTL=604800  # 7 days
   ```

3. **Batch Processing**
   ```env
   REQUIRE_REVIEW=true  # Process in batches
   CRON_SCHEDULE=0 9 * * *  # Once daily at 9am
   ```

4. **Use Sonnet for Better Quality**
   ```env
   ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
   ```

### Cost Optimization

Current costs (Claude 3 Haiku):
- Input: $0.80 per 1M tokens
- Output: $4.00 per 1M tokens
- Average cost per article: ~$0.005 (0.5 cents)

**To reduce costs:**
- Use smaller niche (fewer articles to process)
- Increase CRON_SCHEDULE interval
- Implement `skipCache` less frequently
- Monitor `/api/metrics` for cost trends

---

## Backup & Recovery

### Automated Backups

```bash
# Daily backup script (crontab)
0 2 * * * pg_dump $DATABASE_URL > /backups/pantheon-$(date +\%Y\%m\%d).sql
```

### Manual Backup

```bash
# Backup PostgreSQL
pg_dump "$DATABASE_URL" > backup.sql

# Backup SQLite
cp data/pantheon.db data/pantheon.db.$(date +%Y%m%d).bak
```

### Restore from Backup

```bash
# Restore PostgreSQL
psql "$DATABASE_URL" < backup.sql

# Restore Prisma state
npx prisma db push --skip-generate
```

---

## Security Checklist

- [ ] Never commit .env.local to git
- [ ] Rotate Anthropic API key annually
- [ ] Use strong WordPress Application Passwords (24+ chars)
- [ ] Enable Vercel Project Passcode
- [ ] Use HTTPS for all external APIs
- [ ] Set CORS_ORIGINS to specific domains
- [ ] Enable Vercel OTP (one-time password)
- [ ] Audit database access logs monthly
- [ ] Encrypt backups at rest
- [ ] Use VPC peering for database connections (production)

---

## Scheduled Maintenance

### Weekly
- Monitor `/api/metrics` for cost anomalies
- Review error logs in Datadog/Sentry
- Test manual pipeline trigger

### Monthly
- Update dependencies: `npm update`
- Review and archive old cycles (>30 days)
- Backup production database

### Quarterly
- Audit Anthropic usage and costs
- Review system prompts and brand guidelines
- A/B test different copywriter prompts
- Update Prisma schema if needed

---

## Rollback Procedure

If a deployment causes issues:

### Option 1: Instant Rollback (Vercel)
```bash
# Via Vercel Dashboard
Project Settings → Deployments → Click previous deployment → Redeploy

# Via CLI
vercel rollback
```

### Option 2: Database Rollback
```bash
# Restore from backup
psql "$DATABASE_URL" < backups/pantheon-20260327.sql

# Reset Prisma client
npx prisma generate
```

### Option 3: Disable Scheduler
```bash
# Via API
curl -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"isLive": false}'
```

---

## Support & Resources

- **API Docs**: `./API_DOCUMENTATION.md`
- **Testing Guide**: `./TESTING.md`
- **Anthropic API**: https://docs.anthropic.com/
- **Vercel Docs**: https://vercel.com/docs
- **Prisma Docs**: https://www.prisma.io/docs/

