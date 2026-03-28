# Pantheon Newsroom – Manual Testing Checklist

Run through this checklist after every significant change to verify the end-to-end flow.
Automated tests (`npm test`) cover unit and API contracts; this checklist covers integration and UX.

---

## Environment Setup

- [ ] `.env.local` exists with a valid `ANTHROPIC_API_KEY`
- [ ] Database schema is up to date: `npm run db:push`
- [ ] App starts without errors: `npm run dev`

---

## Tab 1 – Operation Map

- [ ] App loads at http://localhost:3000 without console errors
- [ ] "Operation Map" tab is active by default
- [ ] All pipeline nodes are visible (Investigator, Router, Copywriter-A, Copywriter-B, Editor, Publisher-A, Publisher-B)
- [ ] Nodes display in "idle" state (amber dim pulse) on initial load
- [ ] Settings panel is visible (Scrape Frequency, Manual Review toggle, GO LIVE / STOP buttons)

### Pipeline Trigger

- [ ] Click **RUN NOW** — button shows loading state while pipeline runs
- [ ] Pipeline nodes animate to "working" state (bright amber pulse) as each stage executes
- [ ] SSE log terminal shows timestamped `info`, `success`, and `error` entries in real time
- [ ] On completion, nodes return to "idle" or "success" state
- [ ] No unhandled errors in browser console during or after the run

### Settings Persistence

- [ ] Change **Scrape Frequency** to `1h`
- [ ] Reload the page
- [ ] Confirm the frequency is still `1h` (persisted via `PUT /api/settings`)

### Manual Review Toggle

- [ ] Enable **Manual Review** toggle
- [ ] Run the pipeline — articles should reach "Pending Review" status and not auto-publish
- [ ] Disable the toggle and re-run — articles should auto-publish (if review status is PASS)

### Scheduling

- [ ] Click **GO LIVE** — confirm a cron schedule is registered (log entry visible)
- [ ] Click **STOP** — confirm the schedule is cancelled (log entry visible)
- [ ] Reload page — `isLive` state reflects what was last saved

---

## Tab 2 – War Room

### Article List

- [ ] Switch to the "War Room" tab
- [ ] After a pipeline run, at least one article appears in the list
- [ ] Each article card shows title, brand badge (`gen-z-tech` or `formal-biz`), and status chip
- [ ] Articles are sorted newest-first

### Article Editor

- [ ] Click on an article to select it
- [ ] Title and content fields are editable
- [ ] Modify the title and click **Save** (or equivalent)
- [ ] Reload the page and confirm the edited title is preserved

### Approve & Publish

- [ ] Select an article in "Pending Review" status
- [ ] Click **Approve & Publish**
- [ ] Article status changes to "Published"
- [ ] `wpPostId` is shown on the article card
- [ ] Server logs show a successful POST to `/api/mock-wordpress`
- [ ] Clicking Approve on an already-published article is blocked or handled gracefully

### Editor's Insights Panel

- [ ] After a pipeline run, the Insights panel shows at least one suggestion
- [ ] Each insight shows the target agent and suggestion text
- [ ] Click **Approve** on an insight — it disappears from the "Pending" list
- [ ] Click **Dismiss** on an insight — it disappears from the "Pending" list
- [ ] Reload the page — approved/dismissed insights do not reappear

---

## Error & Edge Cases

- [ ] Disconnect from the internet and click **RUN NOW** — app shows a graceful error (not a white screen)
- [ ] Submit an empty `ANTHROPIC_API_KEY` in `.env.local` — app shows a meaningful error message
- [ ] Navigate to a non-existent article URL — returns 404 JSON, not an unhandled exception
- [ ] Send a `PUT /api/settings` with an invalid frequency value — returns 400 or handles gracefully

---

## API Smoke Tests (curl / Postman)

```bash
# List articles
curl http://localhost:3000/api/articles

# Get settings
curl http://localhost:3000/api/settings

# Update settings
curl -X PUT http://localhost:3000/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"scrapeFrequency":"1h"}'

# List pending insights
curl http://localhost:3000/api/insights

# Trigger pipeline
curl -X POST http://localhost:3000/api/process-news

# Stream logs (keep connection open)
curl -N http://localhost:3000/api/stream
```

---

## Automated Tests

```bash
# Full test suite
npm test

# With coverage
npm test -- --coverage

# Single file
npm test -- __tests__/dedup.test.ts
npm test -- __tests__/llm.test.ts
npm test -- __tests__/pipeline.test.ts
npm test -- __tests__/api.test.ts
```

Expected: all tests pass, zero failures.
