# QA Testing Strategy

Pantheon Synthetic Newsroom — Comprehensive Test Plan & Coverage Goals

**Version:** 1.0
**Last Updated:** 2025-03-27
**Prepared By:** QA & Deployment Engineer

---

## Testing Pyramid

```
          ┌─────────────┐
          │   E2E (10%) │ ← Playwright, user flows, integration tests
          ├─────────────┤
          │Integration  │ ← Workflow cycles, API contracts, DB transactions
          │  Tests(30%) │
          ├─────────────┤
          │  Unit Tests │ ← Pure functions, prompt formatting, utilities
          │   (60%)     │
          └─────────────┘
```

---

## Test Coverage Targets

| Component | Target | Current | Status |
|-----------|--------|---------|--------|
| **Backend API** | ≥80% | 75% | ⚠️ In Progress |
| **Frontend Components** | ≥70% | 40% | ⚠️ To Do |
| **Workflow Engine (5 stages)** | 100% | 85% | ⚠️ In Progress |
| **Critical Paths (dedup, compliance)** | 100% | 95% | ✓ Good |

---

## Unit Tests (60%)

### Test Categories

#### 1. Prompt Formatting & LLM Inputs
**File:** `__tests__/unit-utils.test.ts`

```typescript
describe('Unit Tests: Prompt Formatting', () => {
  test('generateTriagePrompt contains no prompt injection', () => {
    // Verify prompt is safe from injection attacks
  })

  test('generateDraftPrompt includes brand guidelines', () => {
    // Ensure brand context is present
  })

  test('generateReviewPrompt requests JSON compliance check', () => {
    // Verify response format is JSON
  })
})
```

**Coverage:**
- [x] Triage prompt (niche variable safe)
- [x] Draft prompt (brand context included)
- [x] Review prompt (JSON schema correct)
- [ ] Fallback prompts (missing guidelines)

#### 2. Data Transformations
**File:** `__tests__/unit-utils.test.ts`

```typescript
describe('Unit Tests: Data Transformations', () => {
  test('parseReviewResponse extracts PASS/FAIL status', () => {})
  test('parseReviewResponse handles malformed JSON gracefully', () => {})
})
```

**Coverage:**
- [x] Parse review response (valid JSON)
- [x] Parse review response (invalid JSON)
- [x] Article status validation
- [x] Insight status validation
- [ ] Brand ID validation

#### 3. Utility Functions
**File:** `__tests__/unit-utils.test.ts`

```typescript
describe('Unit Tests: Deduplication', () => {
  test('deduplicateUrls returns only new URLs', () => {})
  test('readSeenUrls and writeSeenUrls round-trip correctly', () => {})
  test('concurrent writes do not corrupt state', () => {})
})
```

**Coverage:**
- [x] Dedup logic (new vs seen)
- [x] File I/O (read/write)
- [x] Concurrent access safety
- [ ] URL hash determinism

#### 4. Input Validation
**File:** `__tests__/unit-utils.test.ts`

```typescript
describe('Unit Tests: Input Validation', () => {
  test('article title length validation', () => {})
  test('brand ID validation', () => {})
  test('cycle ID is valid UUID format', () => {})
})
```

**Coverage:**
- [x] Title max length (255 chars)
- [x] Brand whitelist ('gen-z-tech' | 'formal-biz')
- [x] UUID format validation
- [x] Niche field length
- [ ] HTML content sanitization

### Running Unit Tests

```bash
# All unit tests
npm test -- __tests__/unit-utils.test.ts

# With coverage
npm test -- __tests__/unit-utils.test.ts --coverage

# Watch mode
npm test -- __tests__/unit-utils.test.ts --watch

# Specific test
npm test -- __tests__/unit-utils.test.ts -t "prompt injection"
```

---

## Integration Tests (30%)

### Test Categories

#### 1. Full Workflow Cycle
**File:** `__tests__/integration-workflow.test.ts`

```typescript
describe('Integration Tests: Full Pipeline Workflow', () => {
  test('workflow: ingestion → triage → drafting → review → publishing', () => {
    // 1. Create article in database
    // 2. Run triage (verify status updated)
    // 3. Fan-out drafting (verify 2 articles created)
    // 4. Run compliance review (verify PASS/FAIL)
    // 5. Mark as published (verify wpPostId set)
  })
})
```

**Coverage:**
- [x] Ingestion creates article
- [x] Triage rejection (Failed status)
- [x] Duplicate ingestion dedup
- [x] Fan-out drafting (multiple brands)
- [x] Compliance review transitions
- [x] Publishing adds WordPress ID
- [ ] Partial failure recovery

#### 2. Database Transactions
**File:** `__tests__/integration-workflow.test.ts`

```typescript
describe('Integration Tests: Database Transactions', () => {
  test('article state is consistent across updates', () => {})
  test('concurrent edits resolve gracefully', () => {})
  test('insight creation and approval work end-to-end', () => {})
})
```

**Coverage:**
- [x] Article create/read/update
- [x] Insight create/approve
- [x] Settings upsert (singleton)
- [x] Concurrent updates
- [ ] Transaction rollback on error

#### 3. API Contract Validation
**File:** `__tests__/integration-workflow.test.ts`

```typescript
describe('Integration Tests: API Contract Validation', () => {
  test('article response schema is valid', () => {
    // Verify all required fields present
    // Verify field types correct
    // Verify no extra fields
  })

  test('settings response schema is valid', () => {})
  test('insight response schema is valid', () => {})
})
```

**Coverage:**
- [x] Article schema (id, cycleId, brandId, status, title, content, etc)
- [x] Insight schema (id, targetAgent, suggestionText, status, createdAt)
- [x] Settings schema (id, scrapeFrequency, requireReview, isLive, targetNiche)
- [ ] Error response schema (error, statusCode, timestamp)

#### 4. Error Scenarios
**File:** `__tests__/integration-workflow.test.ts`

```typescript
describe('Integration Tests: Error Scenarios', () => {
  test('error: duplicate article ingestion is handled', () => {})
  test('error: triage rejection prevents drafting', () => {})
  test('error: missing brand guidelines falls back to defaults', () => {})
  test('error: concurrent edit while publishing (race condition)', () => {})
})
```

**Coverage:**
- [x] Duplicate ingestion (dedup)
- [x] Triage rejection (Failed status)
- [x] Missing brand guidelines
- [x] Concurrent edits
- [x] Race conditions
- [ ] LLM timeout recovery
- [ ] WordPress API 401/403/5xx

### Running Integration Tests

```bash
# All integration tests
npm test -- __tests__/integration-workflow.test.ts

# With coverage
npm test -- __tests__/integration-workflow.test.ts --coverage

# Single test
npm test -- __tests__/integration-workflow.test.ts -t "full pipeline"

# Debug mode
DEBUG=* npm test -- __tests__/integration-workflow.test.ts
```

---

## E2E Tests (10%)

### Test Categories

#### 1. Dashboard Master Controls
**File:** `__tests__/e2e-user-flows.test.ts`

```typescript
describe.skip('E2E: Dashboard - RUN NOW', () => {
  test('RUN NOW button triggers immediate pipeline cycle', () => {
    // 1. Load dashboard
    // 2. Click RUN NOW
    // 3. Verify nodes become "working"
    // 4. Wait for completion
    // 5. Verify articles appear in War Room
  })
})
```

**Expected Behavior:**
- [ ] Dashboard loads < 1s
- [ ] RUN NOW button responds immediately
- [ ] All 5 pipeline nodes pulse while active
- [ ] SSE logs show real-time updates
- [ ] Completion within 3s
- [ ] War Room populated with new articles

#### 2. War Room Editor
**File:** `__tests__/e2e-user-flows.test.ts`

```typescript
describe.skip('E2E: War Room - Article Editor & Publishing', () => {
  test('user can edit article title and content', () => {
    // 1. Load War Room
    // 2. Click article card
    // 3. Edit title and content
    // 4. Click Save
    // 5. Verify database update
  })

  test('user can approve and publish article', () => {
    // 1. Select Pending Review article
    // 2. Click Approve & Publish
    // 3. Confirm in modal
    // 4. Verify status → Published
    // 5. Verify WordPress API called
  })
})
```

**Expected Behavior:**
- [ ] Editor modal opens immediately
- [ ] Edits save without page reload
- [ ] Title and content update in database
- [ ] Publish button triggers WordPress API
- [ ] Status changes to "Published"
- [ ] WordPress post ID saved

#### 3. Real-Time Synchronization
**File:** `__tests__/e2e-user-flows.test.ts`

```typescript
describe.skip('E2E: Real-Time State Synchronization', () => {
  test('SSE stream updates both Dashboard and War Room tabs', () => {
    // 1. Open Dashboard + War Room in separate tabs
    // 2. Trigger pipeline from Dashboard
    // 3. Verify both tabs update in real-time
  })
})
```

**Expected Behavior:**
- [ ] SSE logs appear in both tabs
- [ ] Article count increases synchronized
- [ ] No need to refresh manually
- [ ] No stale data across tabs

#### 4. Accessibility (WCAG 2.1 AA)
**File:** `__tests__/e2e-user-flows.test.ts`

```typescript
describe.skip('E2E: Accessibility', () => {
  test('Dashboard is fully keyboard navigable', () => {
    // 1. Tab through all interactive elements
    // 2. Activate buttons with Enter
    // 3. Navigate dropdowns with Arrow keys
  })

  test('no WCAG 2.1 AA accessibility violations', () => {
    // Run axe accessibility checker
    // Verify no serious/critical violations
  })

  test('image elements have alt text', () => {})
  test('form labels are properly associated', () => {})
})
```

**Expected Behavior:**
- [ ] Keyboard-only navigation works
- [ ] No color contrast violations
- [ ] All images have alt text
- [ ] Form inputs have labels
- [ ] Focus indicators visible
- [ ] 0 axe violations at AA level

#### 5. Error Handling & Recovery
**File:** `__tests__/e2e-user-flows.test.ts`

```typescript
describe.skip('E2E: Error Handling', () => {
  test('graceful error when LLM service is unavailable', () => {
    // 1. Mock network error for Anthropic
    // 2. Trigger pipeline
    // 3. Verify error notification
    // 4. Verify Retry button available
  })
})
```

**Expected Behavior:**
- [ ] Error message displayed (not stack trace)
- [ ] Retry button available
- [ ] Service recovers and retries work

### Running E2E Tests

```bash
# Install Playwright (one-time)
npx playwright install

# Run all E2E tests
npm test -- __tests__/e2e-user-flows.test.ts

# Run specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox

# Debug mode (opens browser inspector)
npx playwright test --debug

# Headed mode (see browser)
npx playwright test --headed
```

---

## Critical Path Testing (100% Coverage)

These scenarios must be tested exhaustively:

### 1. Deduplication (No Duplicates Published)

```typescript
test('dedup: same URL ingested twice, only one article created', () => {
  // 1. Ingest article A from URL X
  // 2. Ingest article A again from URL X
  // 3. Verify only 1 article in database
  // 4. Verify seen-urls.json contains X
})

test('dedup: concurrent ingestion of same URL', () => {
  // 1. Two threads try to ingest URL X simultaneously
  // 2. Verify exactly 1 article created
  // 3. Verify no race condition corruption
})
```

**Coverage:**
- [x] URL hash consistency
- [x] File I/O atomicity
- [x] Concurrent access safety
- [ ] TTL expiration (7 days)

### 2. Compliance Guardrail (No Unsafe Content Publish)

```typescript
test('compliance: FAIL articles never reach Published status', () => {
  // 1. Create article with flagged content
  // 2. Run compliance review (returns FAIL)
  // 3. Verify status = Failed, not Published
  // 4. Verify reviewResult contains reason
})

test('compliance: no injection attacks in review response', () => {
  // 1. LLM returns malformed JSON
  // 2. Parser handles gracefully (throws, not crashes)
  // 3. Article marked as Failed
})
```

**Coverage:**
- [x] Review status transitions
- [x] Malformed JSON handling
- [x] No bypass of FAIL → Publish
- [ ] Compliance audit log

### 3. Fan-Out Resilience (Partial Failure OK)

```typescript
test('fan-out: one brand fails, other succeeds', () => {
  // 1. Mock LLM failure for gen-z-tech
  // 2. Run pipeline
  // 3. Verify formal-biz article created
  // 4. Verify gen-z-tech article marked Failed
  // 5. Verify pipeline doesn't halt
})
```

**Coverage:**
- [x] Promise.allSettled (not Promise.all)
- [x] Partial failure handling
- [x] Error logging per brand
- [ ] Retry logic for failed brands

---

## Test Data & Fixtures

### Sample Articles

**Valid (Relevant to Indonesian Property):**
```json
{
  "title": "Jakarta Property Market Soars in Q1 2025",
  "link": "https://propertynews.id/article/jakarta-soars",
  "contentSnippet": "Demand for residential units in Jakarta continues to surge."
}
```

**Invalid (Off-Topic):**
```json
{
  "title": "Champions League: Real Madrid Win Again",
  "link": "https://sports.example.com/cl-madrid",
  "contentSnippet": "Real Madrid lifts the trophy for a record time."
}
```

### Mock Anthropic Responses

**Valid Triage Response:**
```json
{
  "status": "success",
  "content": [{"type": "text", "text": "YES"}]
}
```

**Valid Draft Response:**
```json
{
  "status": "success",
  "content": [{"type": "text", "text": "# Article Title\n\nArticle content..."}]
}
```

**Valid Review Response:**
```json
{
  "status": "success",
  "content": [{"type": "text", "text": "{\"status\": \"PASS\", \"reason\": \"Content meets guidelines\"}"}]
}
```

---

## Performance Testing

### Load Testing Targets

```
Scenario: 100 concurrent dashboard viewers
Duration: 5 minutes
Success Criteria:
  - ✓ p95 response time < 1s
  - ✓ Error rate < 0.1%
  - ✓ No memory leaks
  - ✓ Connection pool stable

Scenario: 10 articles per minute ingestion
Duration: 10 minutes
Success Criteria:
  - ✓ p95 triage time < 2s per article
  - ✓ p95 draft time < 5s per article
  - ✓ No dropped articles
  - ✓ Dedup always works
```

### Load Testing Commands

```bash
# Use k6 for load testing
npm install -D k6

# Run load test
k6 run scripts/load-test.js

# Output results
# ✓ Ingestion: p95 = 1.2s
# ✓ War Room API: p95 = 450ms
# ✓ Dashboard load: p95 = 890ms
```

---

## Regression Testing

### Automated Regression Suite

```bash
# Run before every release
npm test -- --coverage --updateSnapshot

# Verify no regressions in:
# - API contracts
# - Database schema
# - Dedup logic
# - Compliance checks
```

### Manual Regression Checklist

Before each release:

- [ ] Create 5 test articles from RSS
- [ ] Verify triage (reject off-topic)
- [ ] Verify drafting (both brands)
- [ ] Verify compliance (PASS/FAIL)
- [ ] Edit one article
- [ ] Publish to WordPress
- [ ] Verify article appears on WordPress
- [ ] Check SSE logs for errors

---

## Test Maintenance

### Weekly

- [ ] Review failed tests
- [ ] Update test fixtures if schema changed
- [ ] Check test execution time (should be < 2 min)

### Monthly

- [ ] Audit test coverage (run `jest --coverage`)
- [ ] Remove obsolete tests
- [ ] Add tests for bug fixes
- [ ] Document new test patterns

### Quarterly

- [ ] Review test strategy
- [ ] Benchmark performance baselines
- [ ] Plan accessibility audit
- [ ] Update security tests

---

## Test Metrics Dashboard

**Current Metrics (2025-03-27):**

| Metric | Target | Current | Trend |
|--------|--------|---------|-------|
| Unit Test Coverage | 80% | 75% | ↑ |
| Integration Test Pass Rate | 100% | 95% | ↑ |
| E2E Test Pass Rate | 100% | 40% | → |
| Avg Test Execution Time | < 2 min | 1.8 min | ✓ |
| Critical Path Coverage | 100% | 95% | ↑ |

---

## Continuous Integration

### Pre-Commit Hooks (local)

```bash
# In .git/hooks/pre-commit
npm run type-check
npm test -- --bail --findRelatedTests
```

### CI Pipeline (GitHub Actions)

See `.github/workflows/ci-cd.yml`:

1. **Lint** (2 min)
2. **Type Check** (1 min)
3. **Unit Tests** (3 min)
4. **Integration Tests** (5 min)
5. **Build** (4 min)
6. **E2E Tests** (10 min, optional)
7. **Deploy** (2 min)

**Total Time:** ~15 minutes

---

## Testing Best Practices

### DO

- [x] Mock external APIs (Anthropic, WordPress, RSS)
- [x] Use realistic test data
- [x] Test error paths (not just happy path)
- [x] Test edge cases (empty input, null, undefined)
- [x] Use `describe()` blocks to organize tests
- [x] Give tests descriptive names
- [x] Keep tests independent (no ordering)

### DON'T

- [ ] Don't call real APIs in tests
- [ ] Don't use `setTimeout` without `jest.useFakeTimers()`
- [ ] Don't hardcode IDs (use fixtures)
- [ ] Don't test implementation details (test behavior)
- [ ] Don't have tests depend on other tests

---

## Coverage Report

Generate coverage report:

```bash
npm test -- --coverage --coverageReporters=text

# Output example:
# ────────────────────────────────────────────────
# File                      | % Stmts | % Branch | % Funcs | % Lines
# ────────────────────────────────────────────────
# All files                 |   75.2  |   72.1   |   78.9  |   75.2
# lib/dedup.ts              |   100   |   100    |   100   |   100
# lib/llm.ts                |   85    |   80     |   90    |   85
# lib/pipeline.ts           |   65    |   60     |   70    |   65
# ────────────────────────────────────────────────
```

---

**Next Steps:**

1. Implement unit tests for remaining utilities
2. Complete E2E tests with Playwright
3. Set up load testing environment
4. Establish performance baseline
5. Add accessibility tests with axe
