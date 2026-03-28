# Deployment Runbook

Pantheon Synthetic Newsroom — Step-by-Step Production Deployment Guide

**Version:** 1.0
**Last Updated:** 2025-03-27
**Audience:** DevOps Engineer, Release Manager

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Local Testing](#local-testing)
3. [Staging Deployment](#staging-deployment)
4. [Production Deployment](#production-deployment)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Rollback Procedure](#rollback-procedure)

---

## Pre-Deployment Checklist

### 48 Hours Before Deployment

- [ ] Check GitHub Issues for any critical bugs
- [ ] Review all merged PRs since last deployment
- [ ] Verify all tests are passing in `main` branch
- [ ] Announce deployment window to team (Slack, email)
- [ ] Backup production database
  ```bash
  # Supabase backup
  supabase db push --schema-only > backups/schema-$(date +%Y%m%d).sql
  ```

### 24 Hours Before

- [ ] Verify staging environment is working
- [ ] Test WordPress integration with staging instance
- [ ] Review secrets in Vercel dashboard (all set correctly)
- [ ] Check Vercel deployment capacity
- [ ] Prepare rollback plan and test it

### 1 Hour Before

- [ ] Stop scheduled cron jobs (disable in Vercel settings)
- [ ] Create maintenance banner (optional)
- [ ] Notify stakeholders deployment is starting
- [ ] Have Slack channel open for monitoring

---

## Local Testing

### 1. Install Dependencies

```bash
cd pantheon-newsroom
npm ci
```

### 2. Setup Local Database

```bash
# Create local SQLite database
npm run db:push

# Verify schema
npm run db:studio
```

### 3. Configure Environment

```bash
# Copy and fill in .env.local
cp .env.local.example .env.local

# Required values:
# ANTHROPIC_API_KEY=sk-ant-...
# DATABASE_URL=file:./data/pantheon.db
# WP_URL=http://localhost:3000/api/mock-wordpress
```

### 4. Run All Test Suites

```bash
# Unit tests
npm test -- __tests__/unit-utils.test.ts --coverage

# Integration tests
npm test -- __tests__/integration-workflow.test.ts

# Pipeline tests
npm test -- __tests__/pipeline.test.ts

# Check coverage thresholds
npm test -- --coverage --coverageThreshold='{"global": {"branches": 80, "functions": 80}}'
```

### 5. Start Dev Server

```bash
npm run dev
```

Visit http://localhost:3000 and manually test:

- [ ] Dashboard loads without errors
- [ ] RUN NOW button triggers pipeline
- [ ] War Room displays articles
- [ ] Can edit and save article
- [ ] SSE stream shows log updates

### 6. Build for Production

```bash
npm run build

# Verify build output
ls -la .next/
```

If build fails, fix issues before proceeding.

---

## Staging Deployment

### 1. Create Staging Branch

```bash
git checkout main
git pull origin main
git checkout -b staging-release-v1.0.0
```

### 2. Create Git Tag

```bash
git tag -a v1.0.0 -m "Release v1.0.0 - March 27, 2025"
git push origin v1.0.0
```

### 3. Deploy to Vercel Staging

```bash
# Option A: Automatic via GitHub
# Push to staging branch, Vercel auto-deploys to preview URL

git push origin staging-release-v1.0.0
```

```bash
# Option B: Manual via Vercel CLI
npm i -g vercel

# Deploy to staging environment
vercel --prod --token $VERCEL_TOKEN \
  --environment=staging \
  --build-env NODE_ENV=staging
```

### 4. Verify Staging Deployment

- [ ] Check Vercel dashboard for successful build
- [ ] Visit staging URL (provided by Vercel)
- [ ] Test full workflow:
  - [ ] Load dashboard
  - [ ] Run pipeline
  - [ ] Edit article in War Room
  - [ ] Publish to staging WordPress

### 5. Run Smoke Tests

```bash
# Test API endpoints
curl -X GET https://staging.pantheon-newsroom.vercel.app/api/health

# Test database connectivity
curl -X GET https://staging.pantheon-newsroom.vercel.app/api/articles

# Test Anthropic integration
curl -X POST https://staging.pantheon-newsroom.vercel.app/api/process-news \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Staging Sign-Off

- [ ] Product Manager approves staging
- [ ] QA confirms all test cases pass
- [ ] DevOps verifies logs and monitoring
- [ ] Document any issues found (create follow-up tickets)

---

## Production Deployment

### 1. Final Pre-Flight Checks

```bash
# Verify all tests pass one more time
npm test -- --coverage

# Verify build is clean
npm run build

# Check for any uncommitted changes
git status
```

### 2. Merge to Production

```bash
# Ensure you're on main branch
git checkout main
git pull origin main

# Verify staging branch is ahead
git log main..origin/staging-release-v1.0.0 --oneline

# Merge staging to main
git merge --no-ff staging-release-v1.0.0 \
  -m "Merge v1.0.0 into production"

# Push to main (this triggers CI/CD)
git push origin main
```

### 3. GitHub Actions CI/CD Runs

```bash
# Monitor CI/CD pipeline
# Go to: https://github.com/YOUR_ORG/pantheon-newsroom/actions

# Watch for:
# ✓ Code Quality checks
# ✓ Unit tests
# ✓ Integration tests
# ✓ Security scan
# ✓ Build
# ✓ Deploy to Vercel
```

Expected duration: 5-10 minutes

### 4. Vercel Production Deployment

Once CI passes, Vercel automatically deploys to production.

```bash
# Monitor deployment
# Go to: https://vercel.com/pantheon-newsroom/deployments

# Check status:
# ✓ Domain updated
# ✓ Functions deployed
# ✓ Environment variables loaded
```

### 5. Verify Production

- [ ] Visit https://pantheon-newsroom.vercel.app
- [ ] Check that page loads
- [ ] Verify error logs are clean

```bash
# Check Vercel function logs
vercel logs --tail --token $VERCEL_TOKEN
```

---

## Post-Deployment Verification

### 1. Smoke Tests (5 minutes)

```bash
# Health check
curl https://pantheon-newsroom.vercel.app/api/health

# Articles endpoint
curl https://pantheon-newsroom.vercel.app/api/articles | jq .

# Settings
curl https://pantheon-newsroom.vercel.app/api/settings | jq .
```

### 2. Dashboard Verification (10 minutes)

- [ ] Load https://pantheon-newsroom.vercel.app
- [ ] Check Operation Map loads
- [ ] Click "RUN NOW" and observe pipeline
- [ ] Verify SSE stream shows events
- [ ] Check War Room for articles
- [ ] Verify latest deployment version in footer

### 3. Database Verification

```bash
# Connect to production Supabase
psql $DATABASE_URL

# Verify recent articles
SELECT COUNT(*) FROM "Article";
SELECT MAX("createdAt") FROM "Article";

# Check for errors
SELECT COUNT(*) FROM "Article" WHERE status = 'Failed';
```

### 4. WordPress Integration Test

- [ ] Edit an article in War Room
- [ ] Click "Approve & Publish"
- [ ] Verify article appears in WordPress dashboard
- [ ] Check article URL is accessible

### 5. Monitoring & Alerting

```bash
# View real-time logs
vercel logs --tail

# Monitor error rate
# Go to: Sentry Dashboard → Pantheon Newsroom
```

**Alert if:**
- [ ] Error rate > 1%
- [ ] Response time > 2 seconds
- [ ] Database connection failures
- [ ] LLM API failures

### 6. Re-Enable Cron Jobs

```bash
# In Vercel dashboard:
# Settings → Cron Jobs → Enable "/api/process-news"

# Verify cron execution in logs
vercel logs --tail | grep "process-news"
```

### 7. Final Notification

Post to Slack:
```
✅ Production deployment complete!

Version: v1.0.0
Deployed: 2025-03-27 10:30 UTC
Changes: [link to release notes]
Status: ✓ All checks passed

Monitoring: https://sentry.io/pantheon-newsroom/
Logs: https://vercel.com/pantheon-newsroom/deployments
```

---

## Rollback Procedure

Use this if production deployment has critical issues.

### Immediate Rollback (< 5 minutes)

**Option 1: Vercel One-Click Rollback**

1. Go to https://vercel.com/pantheon-newsroom/deployments
2. Find the previous successful deployment
3. Click "..." → "Rollback to this deployment"
4. Confirm rollback

**Option 2: Git Revert**

```bash
# Find the problematic commit
git log --oneline main | head -5

# Revert it
git revert HEAD -m "Rollback v1.0.0 due to [reason]"

# Push (triggers automatic re-deployment)
git push origin main
```

### 5-Minute Verification

- [ ] Visit production URL
- [ ] Verify previous version is running
- [ ] Check logs for errors
- [ ] Confirm database integrity

### Post-Rollback

```bash
# Notify team
# Post to Slack with incident details

# Create incident ticket
# GitHub Issues → create "Incident: [description]"

# Document what went wrong
# Add root cause analysis to INCIDENT_RESPONSE.md

# Schedule post-mortem
# Review in team meeting within 24 hours
```

---

## Deployment Checklist Template

Copy and paste for each deployment:

```markdown
## Deployment: v1.0.0

### Pre-Deployment
- [ ] All tests passing
- [ ] Code review approved
- [ ] Security audit complete
- [ ] Staging verified
- [ ] Backups created

### Deployment
- [ ] Git tag created
- [ ] GitHub Actions passed
- [ ] Vercel deployment successful
- [ ] Smoke tests passed
- [ ] Monitoring verified

### Post-Deployment
- [ ] Dashboard working
- [ ] War Room functional
- [ ] Pipeline triggers correctly
- [ ] WordPress integration confirmed
- [ ] Error logs clean

### Verification
- [ ] All team members notified
- [ ] Documentation updated
- [ ] Release notes published
- [ ] No critical alerts

**Deployed By:** [Name]
**Timestamp:** [UTC]
**Status:** ✓ Complete
```

---

## Common Issues & Fixes

### Issue: Build Fails with "Module not found"

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm ci
npm run build
```

### Issue: Database Migration Fails

```bash
# Manually run migration
npx prisma db push --skip-generate --force-reset

# Note: --force-reset will DELETE all data! For production, use:
npx prisma db push
```

### Issue: Vercel Deployment Timeout (> 15 minutes)

```bash
# Check Vercel logs
vercel logs

# Verify environment variables loaded
# Redeploy with:
vercel deploy --prod --force
```

### Issue: LLM API Failing After Deploy

```bash
# Verify ANTHROPIC_API_KEY in Vercel dashboard
# Settings → Environment Variables → Check value

# Test locally
export ANTHROPIC_API_KEY=your_key
npm run dev
```

### Issue: Database Connection Errors

```bash
# Verify DATABASE_URL in Vercel
# Settings → Environment Variables

# Test connection
npx prisma db execute --stdin < <(echo "SELECT 1")

# Check Supabase dashboard for connection limits
```

---

## Rollback Decision Tree

```
Is production broken?
├─ Yes, users cannot access site
│  └─ IMMEDIATE ROLLBACK (use Option 1 above)
├─ Yes, but partial functionality (one feature broken)
│  └─ Assess: Can we fix with a quick patch?
│     ├─ Yes → Create hotfix branch, deploy
│     └─ No → Rollback
└─ No, just minor issues
   └─ Monitor, create follow-up tickets, plan next release
```

---

## Success Criteria

Deployment is **SUCCESSFUL** when:

- [ ] All tests pass (unit, integration, pipeline)
- [ ] Build completes without warnings
- [ ] Vercel deployment green (no failed functions)
- [ ] Dashboard loads within 1 second
- [ ] Pipeline executes successfully (RUN NOW)
- [ ] War Room displays articles
- [ ] SSE stream updates in real-time
- [ ] Error rate < 0.1%
- [ ] No critical Sentry alerts
- [ ] All team members notified

Deployment is **FAILED** when:

- [ ] Any test fails
- [ ] Build takes > 15 minutes
- [ ] Vercel deployment shows red errors
- [ ] Dashboard returns 5xx errors
- [ ] Database connection fails
- [ ] LLM API returns 5xx consistently
- [ ] Error rate > 1%
- [ ] Users report broken features
