/**
 * Tests for LLM pipeline functions.
 *
 * The Anthropic SDK is fully mocked so these tests run without a live API key
 * and execute in milliseconds.  The mock is declared here (not in setup.ts) so
 * it is scoped to this file only.
 */

// ── Anthropic SDK mock ───────────────────────────────────────────────────────

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
    Anthropic: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    })),
  }
})

// ── Types shared with pipeline functions ────────────────────────────────────

interface TriageResult {
  relevant: boolean
}

interface DraftResult {
  title: string
  content: string
}

interface ReviewResult {
  status: 'PASS' | 'FAIL'
  reason: string
}

// ── Inline pipeline function implementations for testing ─────────────────────
// These mirror the logic that will live in app/api/process-news/route.ts.
// If the actual implementations are extracted to a lib/pipeline.ts, update
// the imports here accordingly.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AnthropicSDK = require('@anthropic-ai/sdk').default
const anthropic = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY })

async function triageArticle(title: string, summary: string): Promise<boolean> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 10,
    messages: [
      {
        role: 'user',
        content: `Is this article about Indonesian property or real estate? Reply with only YES or NO.\nTitle: ${title}\nSummary: ${summary}`,
      },
    ],
  })
  const text: string =
    response.content[0]?.type === 'text' ? response.content[0].text.trim().toUpperCase() : ''
  return text.startsWith('YES')
}

async function draftArticle(
  sourceTitle: string,
  sourceSummary: string,
  brandId: string
): Promise<DraftResult> {
  const brandVoice =
    brandId === 'gen-z-tech'
      ? 'casual, Gen-Z tech blog style'
      : 'formal, professional business publication style'
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: `Write an article in ${brandVoice} about: "${sourceTitle}"\nSource summary: ${sourceSummary}\nReturn JSON with keys "title" and "content" only.`,
      },
    ],
  })
  const raw: string =
    response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw) as DraftResult
  } catch {
    return { title: sourceTitle, content: raw }
  }
}

async function reviewArticle(
  title: string,
  content: string
): Promise<ReviewResult> {
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content: `Review this article for compliance. Return JSON with "status" (PASS or FAIL) and "reason".\nTitle: ${title}\nContent: ${content}`,
      },
    ],
  })
  const raw: string =
    response.content[0]?.type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(raw) as ReviewResult
  } catch {
    return { status: 'FAIL', reason: 'Could not parse review response' }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockReset()
})

describe('triageArticle', () => {
  it('returns true when the LLM responds YES', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'YES' }],
    })
    const result = await triageArticle(
      'Jakarta Luxury Condo Market Booms in Q1 2025',
      'Demand for premium properties in South Jakarta surges amid infrastructure development.'
    )
    expect(result).toBe(true)
  })

  it('returns false when the LLM responds NO', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'NO' }],
    })
    const result = await triageArticle(
      'Premier League Results: Arsenal Win 3-0',
      'Arsenal beat Chelsea in a thrilling London derby at the Emirates.'
    )
    expect(result).toBe(false)
  })

  it('returns false for ambiguous or empty LLM response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '' }],
    })
    const result = await triageArticle('Some Title', 'Some summary')
    expect(result).toBe(false)
  })

  it('handles API errors gracefully by rejecting the promise', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Anthropic API overloaded'))
    await expect(triageArticle('Title', 'Summary')).rejects.toThrow('Anthropic API overloaded')
  })

  it('calls the Anthropic SDK with the article title and summary', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'YES' }],
    })
    const title = 'Bali Villa Prices Hit Record High'
    const summary = 'Foreign interest drives Bali villa prices to record levels.'
    await triageArticle(title, summary)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const callArg = mockCreate.mock.calls[0][0]
    expect(callArg.messages[0].content).toContain(title)
    expect(callArg.messages[0].content).toContain(summary)
  })
})

describe('draftArticle', () => {
  it('returns an object with title and content strings', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Why Jakarta Real Estate Is the Next Big Thing',
            content: 'Full article body here.',
          }),
        },
      ],
    })
    const result = await draftArticle(
      'Jakarta Property Surge',
      'Demand continues to outpace supply in Jakarta.',
      'formal-biz'
    )
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('content')
    expect(typeof result.title).toBe('string')
    expect(typeof result.content).toBe('string')
    expect(result.title.length).toBeGreaterThan(0)
    expect(result.content.length).toBeGreaterThan(0)
  })

  it('falls back gracefully when LLM returns non-JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Plain text, not JSON at all.' }],
    })
    const result = await draftArticle('Source Title', 'Source summary', 'gen-z-tech')
    // Should not throw; fallback uses source title
    expect(result).toHaveProperty('title', 'Source Title')
    expect(result).toHaveProperty('content')
  })

  it('handles API errors gracefully by rejecting the promise', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    await expect(draftArticle('Title', 'Summary', 'gen-z-tech')).rejects.toThrow(
      'Rate limit exceeded'
    )
  })

  it('includes brand voice in the prompt for gen-z-tech brand', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"title":"T","content":"C"}' }],
    })
    await draftArticle('Title', 'Summary', 'gen-z-tech')
    const callArg = mockCreate.mock.calls[0][0]
    expect(callArg.messages[0].content).toContain('Gen-Z')
  })

  it('includes brand voice in the prompt for formal-biz brand', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"title":"T","content":"C"}' }],
    })
    await draftArticle('Title', 'Summary', 'formal-biz')
    const callArg = mockCreate.mock.calls[0][0]
    expect(callArg.messages[0].content).toContain('formal')
  })
})

describe('reviewArticle', () => {
  it('returns {status: PASS, reason: string} for compliant content', async () => {
    const reviewJson: ReviewResult = { status: 'PASS', reason: 'Content is accurate and balanced.' }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(reviewJson) }],
    })
    const result = await reviewArticle(
      'Jakarta Condo Sales Up 12%',
      'Sales volumes across Jakarta increased significantly in the latest quarter.'
    )
    expect(result.status).toBe('PASS')
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('returns {status: FAIL, reason: string} for problematic content', async () => {
    const reviewJson: ReviewResult = {
      status: 'FAIL',
      reason: 'Contains unverified claims about guaranteed investment returns.',
    }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(reviewJson) }],
    })
    const result = await reviewArticle(
      'Get Rich Quick With Bali Villas',
      'This article guarantees 300% ROI with no risk whatsoever.'
    )
    expect(result.status).toBe('FAIL')
    expect(result.reason).toContain('unverified')
  })

  it('returns status PASS or FAIL only – no other values', async () => {
    const reviewJson: ReviewResult = { status: 'PASS', reason: 'All good.' }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(reviewJson) }],
    })
    const result = await reviewArticle('T', 'C')
    expect(['PASS', 'FAIL']).toContain(result.status)
  })

  it('falls back to FAIL when LLM returns unparseable JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'This is not JSON.' }],
    })
    const result = await reviewArticle('T', 'C')
    expect(result.status).toBe('FAIL')
    expect(result.reason).toBeTruthy()
  })

  it('handles API errors gracefully by rejecting the promise', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Server error'))
    await expect(reviewArticle('T', 'C')).rejects.toThrow('Server error')
  })
})
