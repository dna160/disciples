/**
 * Unit tests for pipeline stages.
 *
 * Both @anthropic-ai/sdk and rss-parser are fully mocked so the tests run
 * offline and deterministically.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockAnthropicCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}))

const mockRssParse = jest.fn()

jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockRssParse,
  }))
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface FeedItem {
  title: string
  link: string
  contentSnippet?: string
  pubDate?: string
}

interface FeedResult {
  items: FeedItem[]
}

const SAMPLE_FEED_ITEM: FeedItem = {
  title: 'Jakarta Property Market Soars in Q1 2025',
  link: 'https://propertynews.id/article/jakarta-soars',
  contentSnippet: 'Demand for residential units in Jakarta continues to surge.',
  pubDate: '2025-01-15T08:00:00Z',
}

const IRRELEVANT_FEED_ITEM: FeedItem = {
  title: 'Champions League: Real Madrid Win Again',
  link: 'https://sports.example.com/cl-madrid',
  contentSnippet: 'Real Madrid lifts the trophy for a record time.',
}

const SAMPLE_FEED: FeedResult = {
  items: [SAMPLE_FEED_ITEM, IRRELEVANT_FEED_ITEM],
}

// ── Pipeline stage implementations (to be extracted from route.ts) ──────────
// These are tested here against their contracts.  When you create the actual
// app/api/process-news/route.ts, extract these into lib/pipeline.ts and update
// the import below.

const BRANDS = ['gen-z-tech', 'formal-biz']

async function fetchFeed(url: string): Promise<FeedItem[]> {
  const Parser = require('rss-parser')
  const parser = new Parser()
  const feed: FeedResult = await parser.parseURL(url)
  return feed.items ?? []
}

function deduplicateItems(items: FeedItem[], seenUrls: Set<string>): FeedItem[] {
  return items.filter(item => {
    if (!item.link) return false
    if (seenUrls.has(item.link)) return false
    seenUrls.add(item.link)
    return true
  })
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AnthropicSDK = require('@anthropic-ai/sdk').default
const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY })

async function triage(item: FeedItem): Promise<boolean> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 10,
    messages: [
      {
        role: 'user',
        content: `Relevant to Indonesian property? YES or NO.\nTitle: ${item.title}`,
      },
    ],
  })
  const text: string =
    response.content[0]?.type === 'text' ? response.content[0].text.trim().toUpperCase() : ''
  return text.startsWith('YES')
}

async function draft(
  item: FeedItem,
  brandId: string
): Promise<{ title: string; content: string }> {
  const voice = brandId === 'gen-z-tech' ? 'casual Gen-Z' : 'formal business'
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `Write a ${voice} article about: ${item.title}. Return JSON with title and content.`,
      },
    ],
  })
  const raw: string =
    response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw) as { title: string; content: string }
  } catch {
    return { title: item.title, content: raw }
  }
}

async function review(
  article: { title: string; content: string }
): Promise<{ status: 'PASS' | 'FAIL'; reason: string }> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `Review for compliance. Return JSON {status: PASS|FAIL, reason}.\n${article.title}\n${article.content}`,
      },
    ],
  })
  const raw: string =
    response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw) as { status: 'PASS' | 'FAIL'; reason: string }
  } catch {
    return { status: 'FAIL', reason: 'Parse error' }
  }
}

async function runCycle(feedUrl: string): Promise<{ drafted: number; published: number }> {
  const items = await fetchFeed(feedUrl)
  const seenUrls = new Set<string>()
  const unique = deduplicateItems(items, seenUrls)
  let drafted = 0
  let published = 0
  for (const item of unique) {
    const relevant = await triage(item)
    if (!relevant) continue
    const drafts = await Promise.all(BRANDS.map(b => draft(item, b)))
    drafted += drafts.length
    for (const d of drafts) {
      const rev = await review(d)
      if (rev.status === 'PASS') published++
    }
  }
  return { drafted, published }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockAnthropicCreate.mockReset()
  mockRssParse.mockReset()
})

// ── Stage 1: RSS Ingestion ────────────────────────────────────────────────────

describe('fetchFeed', () => {
  it('returns an array of feed items from the RSS parser', async () => {
    mockRssParse.mockResolvedValueOnce(SAMPLE_FEED)
    const items = await fetchFeed('https://propertynews.id/feed')
    expect(Array.isArray(items)).toBe(true)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe(SAMPLE_FEED_ITEM.title)
  })

  it('returns empty array when feed has no items', async () => {
    mockRssParse.mockResolvedValueOnce({ items: [] })
    const items = await fetchFeed('https://empty.feed/rss')
    expect(items).toHaveLength(0)
  })

  it('propagates parser errors', async () => {
    mockRssParse.mockRejectedValueOnce(new Error('Network timeout'))
    await expect(fetchFeed('https://bad.feed/rss')).rejects.toThrow('Network timeout')
  })
})

// ── Stage 1: Deduplication ────────────────────────────────────────────────────

describe('deduplicateItems', () => {
  it('returns all items when none have been seen before', () => {
    const seenUrls = new Set<string>()
    const result = deduplicateItems([SAMPLE_FEED_ITEM, IRRELEVANT_FEED_ITEM], seenUrls)
    expect(result).toHaveLength(2)
  })

  it('filters out items whose URLs are already in the seen set', () => {
    const seenUrls = new Set<string>([SAMPLE_FEED_ITEM.link])
    const result = deduplicateItems([SAMPLE_FEED_ITEM, IRRELEVANT_FEED_ITEM], seenUrls)
    expect(result).toHaveLength(1)
    expect(result[0].link).toBe(IRRELEVANT_FEED_ITEM.link)
  })

  it('adds newly seen URLs to the seen set', () => {
    const seenUrls = new Set<string>()
    deduplicateItems([SAMPLE_FEED_ITEM], seenUrls)
    expect(seenUrls.has(SAMPLE_FEED_ITEM.link)).toBe(true)
  })

  it('deduplicates within the same batch when two items share the same link', () => {
    const duplicate = { ...SAMPLE_FEED_ITEM }
    const seenUrls = new Set<string>()
    const result = deduplicateItems([SAMPLE_FEED_ITEM, duplicate], seenUrls)
    expect(result).toHaveLength(1)
  })

  it('filters out items with no link', () => {
    const noLink: FeedItem = { title: 'No link item', link: '' }
    const seenUrls = new Set<string>()
    const result = deduplicateItems([noLink], seenUrls)
    expect(result).toHaveLength(0)
  })
})

// ── Stage 2: LLM Triage ───────────────────────────────────────────────────────

describe('triage', () => {
  it('returns true (boolean) for a relevant article', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'YES' }],
    })
    const result = await triage(SAMPLE_FEED_ITEM)
    expect(result).toBe(true)
    expect(typeof result).toBe('boolean')
  })

  it('returns false (boolean) for an irrelevant article', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'NO' }],
    })
    const result = await triage(IRRELEVANT_FEED_ITEM)
    expect(result).toBe(false)
    expect(typeof result).toBe('boolean')
  })

  it('returns false for empty LLM response', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '  ' }],
    })
    const result = await triage(SAMPLE_FEED_ITEM)
    expect(result).toBe(false)
  })
})

// ── Stage 3: Fan-out Copywriting ──────────────────────────────────────────────

describe('draft', () => {
  it('returns an object with non-empty title and content strings', async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Jakarta Market Booms (Gen-Z Take)',
            content: 'Yo, the property scene in Jakarta is absolutely unhinged right now.',
          }),
        },
      ],
    })
    const result = await draft(SAMPLE_FEED_ITEM, 'gen-z-tech')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('content')
    expect(typeof result.title).toBe('string')
    expect(typeof result.content).toBe('string')
    expect(result.title.length).toBeGreaterThan(0)
    expect(result.content.length).toBeGreaterThan(0)
  })

  it('fan-out creates 2 articles per feed item (one per brand)', async () => {
    mockAnthropicCreate
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"title":"A","content":"Body A"}' }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"title":"B","content":"Body B"}' }],
      })
    const results = await Promise.all(BRANDS.map(b => draft(SAMPLE_FEED_ITEM, b)))
    expect(results).toHaveLength(2)
    expect(results[0]).toHaveProperty('title', 'A')
    expect(results[1]).toHaveProperty('title', 'B')
  })
})

// ── Stage 4: Editor-in-Chief Review ──────────────────────────────────────────

describe('review', () => {
  it('returns valid JSON with status PASS for clean content', async () => {
    const reviewPayload = { status: 'PASS', reason: 'Article is factual and balanced.' }
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(reviewPayload) }],
    })
    const result = await review({ title: 'Clean Article', content: 'Safe content here.' })
    expect(result).toHaveProperty('status', 'PASS')
    expect(result).toHaveProperty('reason')
    expect(typeof result.reason).toBe('string')
  })

  it('returns valid JSON with status FAIL for problematic content', async () => {
    const reviewPayload = { status: 'FAIL', reason: 'Contains misleading financial claims.' }
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(reviewPayload) }],
    })
    const result = await review({ title: 'Risky Article', content: 'Guaranteed 500% returns!' })
    expect(result).toHaveProperty('status', 'FAIL')
    expect(result).toHaveProperty('reason')
  })

  it('status field is strictly PASS or FAIL', async () => {
    const reviewPayload = { status: 'PASS', reason: 'OK' }
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(reviewPayload) }],
    })
    const result = await review({ title: 'T', content: 'C' })
    expect(['PASS', 'FAIL']).toContain(result.status)
  })
})

// ── Full Cycle Orchestration ──────────────────────────────────────────────────

describe('runCycle', () => {
  it('runs all pipeline stages in sequence', async () => {
    mockRssParse.mockResolvedValueOnce({ items: [SAMPLE_FEED_ITEM] })

    // triage: YES
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'YES' }],
    })
    // draft brand A
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"title":"Draft A","content":"Content A"}' }],
    })
    // draft brand B
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"title":"Draft B","content":"Content B"}' }],
    })
    // review A: PASS
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"status":"PASS","reason":"OK"}' }],
    })
    // review B: PASS
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"status":"PASS","reason":"OK"}' }],
    })

    const result = await runCycle('https://propertynews.id/feed')
    expect(result.drafted).toBe(2)
    expect(result.published).toBe(2)
    // Anthropic was called: 1 triage + 2 drafts + 2 reviews = 5
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(5)
  })

  it('skips drafting when triage returns NO', async () => {
    mockRssParse.mockResolvedValueOnce({ items: [IRRELEVANT_FEED_ITEM] })
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'NO' }],
    })
    const result = await runCycle('https://sports.example.com/feed')
    expect(result.drafted).toBe(0)
    expect(result.published).toBe(0)
    // Only the triage call
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
  })

  it('does not count FAIL reviews as published', async () => {
    mockRssParse.mockResolvedValueOnce({ items: [SAMPLE_FEED_ITEM] })
    mockAnthropicCreate
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'YES' }] }) // triage
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"title":"A","content":"C"}' }] }) // draft A
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"title":"B","content":"C"}' }] }) // draft B
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"status":"FAIL","reason":"Bad"}' }] }) // review A
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"status":"FAIL","reason":"Bad"}' }] }) // review B

    const result = await runCycle('https://propertynews.id/feed')
    expect(result.drafted).toBe(2)
    expect(result.published).toBe(0)
  })

  it('deduplicates items before processing', async () => {
    const duplicate = { ...SAMPLE_FEED_ITEM }
    mockRssParse.mockResolvedValueOnce({ items: [SAMPLE_FEED_ITEM, duplicate] })
    mockAnthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'NO' }] }) // triage

    await runCycle('https://propertynews.id/feed')
    // Even though 2 items were in the feed, only 1 triage call (dedup removed duplicate)
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
  })
})
