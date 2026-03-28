# Pantheon Synthetic Newsroom — Backend API Documentation

## Overview

This document describes all available API endpoints for the Pantheon Synthetic Newsroom backend. The system implements a 5-stage agentic workflow for semi-autonomous news production with human-in-the-loop editing.

## Base URL

- **Development**: `http://localhost:3000/api`
- **Production**: `https://pantheon-newsroom.vercel.app/api`

## Authentication

Currently, the system uses **Application Passwords** for WordPress integration. For future production deployment, consider adding:
- Bearer token authentication for API endpoints
- API key management in Settings
- Rate limiting per API key

## Response Format

All endpoints return JSON responses with the following structure:

### Success Response (2xx)
```json
{
  "data": { /* response payload */ },
  "timestamp": "2026-03-27T15:30:00.000Z",
  "status": "success"
}
```

### Error Response (4xx, 5xx)
```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": { /* optional details */ },
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

---

## Endpoints

### 1. News Processing

#### POST `/api/process-news`
**Manually trigger a news ingestion and processing cycle.**

**Request:**
```json
{
  "cycleId": "optional-uuid",
  "skipCache": false
}
```

**Response:** `202 Accepted`
```json
{
  "cycleId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "message": "Pipeline cycle started in background. Monitor /api/stream for real-time logs.",
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Notes:**
- Returns immediately (fire-and-forget)
- Monitor `/api/stream` for real-time progress
- Prevents concurrent cycles (409 if one is already running)

---

### 2. Articles Management

#### GET `/api/articles`
**List articles with filtering and pagination.**

**Query Parameters:**
- `status` (string): Filter by status (Drafted, Drafting, Pending Review, Published, Failed)
- `brandId` (string): Filter by brand (gen-z-tech, formal-biz)
- `cycleId` (string): Filter by cycle ID
- `limit` (number, default: 100, max: 500): Pagination limit
- `offset` (number, default: 0): Pagination offset

**Response:** `200 OK`
```json
{
  "articles": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "cycleId": "550e8400-e29b-41d4-a716-446655440001",
      "brandId": "gen-z-tech",
      "status": "Published",
      "title": "Indonesian PropTech Startup Raises $5M Series A",
      "content": "<p>In a significant move...</p>",
      "sourceUrl": "https://example.com/article",
      "sourceTitle": "Original Title",
      "wpPostId": "12345",
      "createdAt": "2026-03-27T15:30:00.000Z",
      "updatedAt": "2026-03-27T15:35:00.000Z"
    }
  ],
  "pagination": {
    "total": 245,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  },
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

---

#### GET `/api/articles/:id`
**Retrieve a single article by ID.**

**Response:** `200 OK`
```json
{
  "article": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "cycleId": "550e8400-e29b-41d4-a716-446655440001",
    "brandId": "gen-z-tech",
    "status": "Pending Review",
    "title": "Indonesian PropTech Startup Raises $5M Series A",
    "content": "<p>Article content here...</p>",
    "sourceUrl": "https://example.com/article",
    "sourceTitle": "Original Title",
    "reviewResult": "{\"status\":\"PASS\",\"reason\":\"Meets all compliance guidelines\"}",
    "createdAt": "2026-03-27T15:30:00.000Z",
    "updatedAt": "2026-03-27T15:35:00.000Z"
  },
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Article with given ID doesn't exist
- `500 Internal Server Error`: Database query failed

---

#### PUT `/api/articles/:id`
**Update an article's title, content, or status.**

**Request:**
```json
{
  "title": "Updated Title (optional)",
  "content": "<p>Updated content (optional)</p>",
  "status": "Approved"
}
```

**Response:** `200 OK`
```json
{
  "article": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Updated Title",
    "content": "<p>Updated content</p>",
    "status": "Approved",
    ...
  },
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: No fields provided
- `404 Not Found`: Article doesn't exist
- `422 Unprocessable Entity`: Invalid status value

---

#### DELETE `/api/articles/:id`
**Delete an article (drafts only, not published articles).**

**Response:** `200 OK`
```json
{
  "message": "Article deleted",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Article doesn't exist
- `422 Unprocessable Entity`: Cannot delete published articles
- `500 Internal Server Error`: Database error

---

#### POST `/api/articles/:id/approve`
**Approve and publish an article to WordPress.**

**Request:**
```json
{
  "notifySlack": true
}
```

**Response:** `200 OK`
```json
{
  "article": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "Published",
    "wpPostId": "12345"
  },
  "wpPostId": 12345,
  "wpLink": "https://wordpress.example.com/2026/03/27/article-title/",
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Article doesn't exist
- `409 Conflict`: Article already published
- `422 Unprocessable Entity`: Article failed review
- `500 Internal Server Error`: WordPress publish failed

---

### 3. Insights & Feedback

#### GET `/api/insights`
**List Editor-in-Chief insights for system improvement.**

**Query Parameters:**
- `status` (string, default: "Pending"): Pending, Approved, Dismissed, or "all"
- `targetAgent` (string): Investigator, Copywriter-A, Copywriter-B, Editor
- `limit` (number, default: 50, max: 500): Pagination limit
- `offset` (number, default: 0): Pagination offset

**Response:** `200 OK`
```json
{
  "insights": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "targetAgent": "Copywriter-A",
      "suggestionText": "Try using more conversational language and Indonesian slang to appeal to younger readers.",
      "status": "Pending",
      "createdAt": "2026-03-27T15:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 12,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

---

#### POST `/api/insights/:id/approve`
**Approve an insight to update the target agent's system prompt.**

**Response:** `200 OK`
```json
{
  "insight": {
    "id": "550e8400-e29b-41d4-a716-446655440010",
    "status": "Approved",
    "targetAgent": "Copywriter-A",
    "suggestionText": "Try using more conversational language..."
  },
  "message": "Insight approved. System prompt will be updated on next cycle.",
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Error Responses:**
- `404 Not Found`: Insight doesn't exist
- `409 Conflict`: Insight is already Approved or Dismissed

---

#### POST `/api/insights/:id/dismiss`
**Dismiss an insight without implementing it.**

**Response:** `200 OK`
```json
{
  "insight": {
    "id": "550e8400-e29b-41d4-a716-446655440010",
    "status": "Dismissed",
    "targetAgent": "Copywriter-A"
  },
  "message": "Insight dismissed.",
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

---

### 4. Pipeline & Observability

#### GET `/api/pipeline-status`
**Check real-time pipeline status and metrics.**

**Response:** `200 OK`
```json
{
  "isRunning": false,
  "uptime": 3600,
  "lastCycleId": "550e8400-e29b-41d4-a716-446655440001",
  "lastCycleStatus": "completed_success",
  "lastCycleTimestamp": "2026-03-27T15:30:00.000Z",
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

---

#### GET `/api/metrics`
**Retrieve cycle metrics, token usage, and costs.**

**Query Parameters:**
- `cycleId` (string): Get metrics for a specific cycle
- `aggregates` (boolean, default: false): Return aggregate statistics
- `limit` (number, default: 10): Number of recent cycles to return

**Response:** `200 OK`
```json
{
  "cycles": [
    {
      "cycleId": "550e8400-e29b-41d4-a716-446655440001",
      "startedAt": "2026-03-27T15:30:00.000Z",
      "completedAt": "2026-03-27T15:35:00.000Z",
      "totalDuration_ms": 300000,
      "stages": [
        {
          "stage": "Investigator",
          "status": "success",
          "duration_ms": 5000,
          "items_processed": 15,
          "items_failed": 0,
          "tokens_used": 2150,
          "cost_usd": 0.0045,
          "errors": []
        }
      ],
      "totalTokens": 12345,
      "totalCost": 0.0234,
      "articleCount": 15,
      "publishedCount": 8
    }
  ],
  "count": 1,
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**With ?aggregates=true:**
```json
{
  "summary": {
    "totalCycles": 24,
    "totalArticles": 180,
    "totalPublished": 145,
    "totalCost": 1.234,
    "avgDuration_ms": 287500,
    "avgCost": 0.0514
  },
  "samples": [
    { /* latest 10 cycles */ }
  ]
}
```

---

#### GET `/api/stream`
**Server-Sent Events (SSE) stream for real-time pipeline logs.**

**Usage:**
```javascript
const eventSource = new EventSource('/api/stream');
eventSource.onmessage = (event) => {
  const log = JSON.parse(event.data);
  console.log(log.stage, log.message);
};
```

**Event Format:**
```json
{
  "stage": "Investigator",
  "level": "info",
  "message": "Fetched 15 items from RSS feeds",
  "timestamp": "2026-03-27T15:30:00.000Z",
  "duration": 5000,
  "tokens": 2150,
  "cost": 0.0045
}
```

---

### 5. Settings & Configuration

#### GET `/api/settings`
**Retrieve system settings and scheduler state.**

**Response:** `200 OK`
```json
{
  "settings": {
    "id": "singleton",
    "scrapeFrequency": "4h",
    "requireReview": false,
    "isLive": true,
    "targetNiche": "Indonesian property real estate"
  },
  "schedulerRunning": true,
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

---

#### PUT `/api/settings`
**Update system settings.**

**Request:**
```json
{
  "scrapeFrequency": "2h",
  "requireReview": true,
  "isLive": true,
  "targetNiche": "Indonesian fintech startups"
}
```

**Valid scrapeFrequency values:**
- Demo/Test: `10s`, `30s`, `1m`, `5m`, `15m`, `30m`
- Production: `1h`, `2h`, `4h`, `6h`, `12h`, `24h`

**Response:** `200 OK`
```json
{
  "success": true,
  "settings": {
    "id": "singleton",
    "scrapeFrequency": "2h",
    "requireReview": true,
    "isLive": true,
    "targetNiche": "Indonesian fintech startups"
  },
  "schedulerRunning": true,
  "timestamp": "2026-03-27T15:30:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid frequency or empty niche
- `422 Unprocessable Entity`: Invalid settings payload

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Request conflicts with current state |
| `RATE_LIMIT` | 429 | Rate limit exceeded |
| `UNAUTHORIZED` | 401 | Authentication required |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

The system currently does not enforce strict rate limits. For production, implement:
- 100 requests/minute per IP for public endpoints
- 1000 requests/minute per API key for authenticated endpoints
- 10 requests/second per cycle for internal processing

---

## Webhooks (Future)

Planned webhook events:
- `article.published` — Article successfully published
- `cycle.completed` — Processing cycle finished
- `insight.created` — New insight generated
- `error.critical` — Critical pipeline error

---

## Examples

### Example: Trigger & Monitor a Cycle

```bash
# 1. Trigger a cycle
curl -X POST http://localhost:3000/api/process-news \
  -H "Content-Type: application/json"

# 2. Check pipeline status
curl http://localhost:3000/api/pipeline-status

# 3. Stream real-time logs
curl http://localhost:3000/api/stream

# 4. List published articles
curl "http://localhost:3000/api/articles?status=Published&limit=10"

# 5. Get metrics
curl "http://localhost:3000/api/metrics?aggregates=true"
```

### Example: Edit & Approve an Article

```bash
# 1. Fetch article
curl http://localhost:3000/api/articles/550e8400-e29b-41d4-a716-446655440000

# 2. Edit title/content
curl -X PUT http://localhost:3000/api/articles/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{"title":"New Title","content":"<p>New content</p>"}'

# 3. Approve for publishing
curl -X POST http://localhost:3000/api/articles/550e8400-e29b-41d4-a716-446655440000/approve \
  -H "Content-Type: application/json"
```

---

## Development Notes

- All timestamps are in ISO 8601 format (UTC)
- Cycle IDs are UUIDs (v4)
- Token counts are cumulative across all LLM calls in a stage
- Cost is estimated at Haiku pricing ($0.80/MTok input, $4/MTok output)

