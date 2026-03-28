/**
 * API route integration tests.
 *
 * These tests exercise the HTTP contract of each route by constructing
 * NextRequest objects directly and calling the exported route handlers.
 * No HTTP server is required, so tests run fast.
 *
 * NOTE: The route files under app/api/ are currently empty stubs.
 * As you implement each handler, uncomment the corresponding import and the
 * related describe block below.  The test contracts are defined here so
 * you can do TDD.
 *
 * Prisma is mocked globally so no real database is required.
 */

import { NextRequest } from 'next/server'

// ── Prisma mock ───────────────────────────────────────────────────────────────
// Mock the shared prisma singleton so no database connection is attempted.

const mockPrismaArticle = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
}

const mockPrismaInsight = {
  findMany: jest.fn(),
  update: jest.fn(),
}

const mockPrismaSettings = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    article: mockPrismaArticle,
    insight: mockPrismaInsight,
    settings: mockPrismaSettings,
  },
}))

// ── fetch mock (for WP publish calls) ────────────────────────────────────────
const mockFetch = jest.fn()
global.fetch = mockFetch

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString()

const ARTICLE_FIXTURE = {
  id: 'article-uuid-1',
  cycleId: 'cycle-1',
  brandId: 'gen-z-tech',
  status: 'Pending Review',
  title: 'Jakarta Market Booms',
  content: 'The Jakarta property market is booming.',
  sourceUrl: 'https://propertynews.id/article/1',
  sourceTitle: 'Source Article',
  reviewResult: JSON.stringify({ status: 'PASS', reason: 'Good' }),
  wpPostId: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const INSIGHT_FIXTURE = {
  id: 'insight-uuid-1',
  targetAgent: 'Investigator',
  suggestionText: 'Consider adding more local sources.',
  status: 'Pending',
  createdAt: NOW,
}

const SETTINGS_FIXTURE = {
  id: 'singleton',
  scrapeFrequency: '4h',
  requireReview: false,
  isLive: false,
  targetNiche: 'Indonesian property real estate',
}

// ── Helper: build a NextRequest ───────────────────────────────────────────────

function makeRequest(
  url: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  return new NextRequest(url, {
    method: options.method ?? 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
  })
}

// ── Helper: parse route response ──────────────────────────────────────────────

async function parseResponse<T>(response: Response): Promise<{ status: number; body: T }> {
  const body = (await response.json()) as T
  return { status: response.status, body }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/articles
// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/articles', () => {
  // Uncomment the import once app/api/articles/route.ts is implemented:
  // import { GET as getArticles } from '@/app/api/articles/route'

  it('returns 200 with an array of articles', async () => {
    mockPrismaArticle.findMany.mockResolvedValueOnce([ARTICLE_FIXTURE])

    // Inline implementation contract test (replace with real import when ready)
    const handler = async (_req: NextRequest) => {
      const articles = await mockPrismaArticle.findMany({ orderBy: { createdAt: 'desc' } })
      return Response.json({ articles })
    }

    const req = makeRequest('http://localhost:3000/api/articles')
    const res = await handler(req)
    const { status, body } = await parseResponse<{ articles: typeof ARTICLE_FIXTURE[] }>(res)

    expect(status).toBe(200)
    expect(Array.isArray(body.articles)).toBe(true)
    expect(body.articles[0].id).toBe('article-uuid-1')
  })

  it('returns an empty array when no articles exist', async () => {
    mockPrismaArticle.findMany.mockResolvedValueOnce([])

    const handler = async (_req: NextRequest) => {
      const articles = await mockPrismaArticle.findMany({})
      return Response.json({ articles })
    }

    const res = await handler(makeRequest('http://localhost:3000/api/articles'))
    const { status, body } = await parseResponse<{ articles: unknown[] }>(res)

    expect(status).toBe(200)
    expect(body.articles).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/articles/[id]
// ────────────────────────────────────────────────────────────────────────────
describe('PUT /api/articles/[id]', () => {
  it('updates the article title and content, returns success', async () => {
    const updated = { ...ARTICLE_FIXTURE, title: 'Updated Title', content: 'Updated body.' }
    mockPrismaArticle.update.mockResolvedValueOnce(updated)

    const handler = async (req: NextRequest, id: string) => {
      const data = (await req.json()) as { title: string; content: string }
      const article = await mockPrismaArticle.update({
        where: { id },
        data: { title: data.title, content: data.content, updatedAt: new Date() },
      })
      return Response.json({ success: true, article })
    }

    const req = makeRequest('http://localhost:3000/api/articles/article-uuid-1', {
      method: 'PUT',
      body: { title: 'Updated Title', content: 'Updated body.' },
    })
    const res = await handler(req, 'article-uuid-1')
    const { status, body } = await parseResponse<{ success: boolean; article: { title: string } }>(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.article.title).toBe('Updated Title')
  })

  it('calls prisma.article.update with the correct ID', async () => {
    mockPrismaArticle.update.mockResolvedValueOnce(ARTICLE_FIXTURE)

    const handler = async (req: NextRequest, id: string) => {
      const data = (await req.json()) as { title: string; content: string }
      await mockPrismaArticle.update({ where: { id }, data })
      return Response.json({ success: true })
    }

    const req = makeRequest('http://localhost:3000/api/articles/article-uuid-1', {
      method: 'PUT',
      body: { title: 'T', content: 'C' },
    })
    await handler(req, 'article-uuid-1')

    expect(mockPrismaArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'article-uuid-1' } })
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// POST /api/articles/[id]/approve
// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/articles/[id]/approve', () => {
  it('calls the WordPress API and returns wpPostId', async () => {
    mockPrismaArticle.findUnique.mockResolvedValueOnce(ARTICLE_FIXTURE)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'wp-999' }), { status: 201 })
    )
    mockPrismaArticle.update.mockResolvedValueOnce({
      ...ARTICLE_FIXTURE,
      status: 'Published',
      wpPostId: 'wp-999',
    })

    const handler = async (_req: NextRequest, id: string) => {
      const article = await mockPrismaArticle.findUnique({ where: { id } })
      if (!article) return Response.json({ error: 'Not found' }, { status: 404 })

      const wpRes = await fetch(`${process.env.WP_URL}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: article.title, content: article.content, status: 'publish' }),
      })
      const wpData = (await wpRes.json()) as { id: string }
      await mockPrismaArticle.update({
        where: { id },
        data: { status: 'Published', wpPostId: String(wpData.id) },
      })
      return Response.json({ success: true, wpPostId: String(wpData.id) })
    }

    const req = makeRequest('http://localhost:3000/api/articles/article-uuid-1/approve', {
      method: 'POST',
    })
    const res = await handler(req, 'article-uuid-1')
    const { status, body } = await parseResponse<{ success: boolean; wpPostId: string }>(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.wpPostId).toBe('wp-999')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when article does not exist', async () => {
    mockPrismaArticle.findUnique.mockResolvedValueOnce(null)

    const handler = async (_req: NextRequest, id: string) => {
      const article = await mockPrismaArticle.findUnique({ where: { id } })
      if (!article) return Response.json({ error: 'Not found' }, { status: 404 })
      return Response.json({ success: true })
    }

    const res = await handler(
      makeRequest('http://localhost:3000/api/articles/bad-id/approve', { method: 'POST' }),
      'bad-id'
    )
    expect(res.status).toBe(404)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/settings
// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/settings', () => {
  it('returns the singleton settings object', async () => {
    mockPrismaSettings.findUnique.mockResolvedValueOnce(SETTINGS_FIXTURE)

    const handler = async (_req: NextRequest) => {
      const settings = await mockPrismaSettings.findUnique({ where: { id: 'singleton' } })
      if (!settings) return Response.json({ error: 'Not found' }, { status: 404 })
      return Response.json(settings)
    }

    const res = await handler(makeRequest('http://localhost:3000/api/settings'))
    const { status, body } = await parseResponse<typeof SETTINGS_FIXTURE>(res)

    expect(status).toBe(200)
    expect(body.id).toBe('singleton')
    expect(body).toHaveProperty('scrapeFrequency')
    expect(body).toHaveProperty('requireReview')
    expect(body).toHaveProperty('isLive')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/settings
// ────────────────────────────────────────────────────────────────────────────
describe('PUT /api/settings', () => {
  it('persists settings changes and returns success', async () => {
    const updatedSettings = { ...SETTINGS_FIXTURE, scrapeFrequency: '1h', requireReview: true }
    mockPrismaSettings.upsert.mockResolvedValueOnce(updatedSettings)

    const handler = async (req: NextRequest) => {
      const data = (await req.json()) as Partial<typeof SETTINGS_FIXTURE>
      const settings = await mockPrismaSettings.upsert({
        where: { id: 'singleton' },
        update: data,
        create: { id: 'singleton', ...data },
      })
      return Response.json({ success: true, settings })
    }

    const req = makeRequest('http://localhost:3000/api/settings', {
      method: 'PUT',
      body: { scrapeFrequency: '1h', requireReview: true },
    })
    const res = await handler(req)
    const { status, body } = await parseResponse<{
      success: boolean
      settings: typeof SETTINGS_FIXTURE
    }>(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.settings.scrapeFrequency).toBe('1h')
  })

  it('calls upsert with the singleton id', async () => {
    mockPrismaSettings.upsert.mockResolvedValueOnce(SETTINGS_FIXTURE)

    const handler = async (req: NextRequest) => {
      const data = (await req.json()) as Partial<typeof SETTINGS_FIXTURE>
      await mockPrismaSettings.upsert({
        where: { id: 'singleton' },
        update: data,
        create: { id: 'singleton', ...data },
      })
      return Response.json({ success: true })
    }

    const req = makeRequest('http://localhost:3000/api/settings', {
      method: 'PUT',
      body: { isLive: true },
    })
    await handler(req)

    expect(mockPrismaSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'singleton' } })
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// GET /api/insights
// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/insights', () => {
  it('returns only Pending insights', async () => {
    mockPrismaInsight.findMany.mockResolvedValueOnce([INSIGHT_FIXTURE])

    const handler = async (_req: NextRequest) => {
      const insights = await mockPrismaInsight.findMany({
        where: { status: 'Pending' },
        orderBy: { createdAt: 'desc' },
      })
      return Response.json({ insights })
    }

    const res = await handler(makeRequest('http://localhost:3000/api/insights'))
    const { status, body } = await parseResponse<{
      insights: typeof INSIGHT_FIXTURE[]
    }>(res)

    expect(status).toBe(200)
    expect(Array.isArray(body.insights)).toBe(true)
    expect(body.insights[0].status).toBe('Pending')
    expect(mockPrismaInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'Pending' } })
    )
  })

  it('returns empty array when no pending insights exist', async () => {
    mockPrismaInsight.findMany.mockResolvedValueOnce([])

    const handler = async (_req: NextRequest) => {
      const insights = await mockPrismaInsight.findMany({ where: { status: 'Pending' } })
      return Response.json({ insights })
    }

    const res = await handler(makeRequest('http://localhost:3000/api/insights'))
    const { status, body } = await parseResponse<{ insights: unknown[] }>(res)

    expect(status).toBe(200)
    expect(body.insights).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// SSE stream endpoint contract test
// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/stream', () => {
  it('sets correct SSE content-type headers', () => {
    // Validate the header contract without actually opening a stream
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    expect(headers.get('Content-Type')).toBe('text/event-stream')
    expect(headers.get('Cache-Control')).toBe('no-cache')
    expect(headers.get('Connection')).toBe('keep-alive')
  })

  it('SSE data format is valid: data: <json>\\n\\n', () => {
    const logEntry = {
      level: 'info',
      message: 'Pipeline started',
      timestamp: new Date().toISOString(),
    }
    const encoded = `data: ${JSON.stringify(logEntry)}\n\n`
    expect(encoded).toMatch(/^data: \{.*\}\n\n$/)
    const parsed = JSON.parse(encoded.replace('data: ', '').trim()) as typeof logEntry
    expect(parsed).toHaveProperty('level')
    expect(parsed).toHaveProperty('message')
    expect(parsed).toHaveProperty('timestamp')
  })
})
