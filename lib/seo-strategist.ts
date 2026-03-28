import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { log } from './logger'
import { prisma } from './prisma'

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

export interface InvestigatorDirective {
  topic_type: 'short-tail' | 'evergreen'
  target_keyword: string
  search_intent: string
  angle: string
  suggested_search_queries: string[]
}

export interface SeoStrategyOutput {
  investigator_directives: InvestigatorDirective[]
}

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

const MODEL = 'claude-haiku-4-5-20251001'

/** Query SeoDirective records from the last `hours` hours and extract all used keywords. */
async function getRecentKeywords(hours: number): Promise<string[]> {
  if (hours <= 0) return []
  try {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    const rows = await prisma.$queryRawUnsafe<Array<{ directives: string }>>(
      `SELECT directives FROM "SeoDirective" WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 50`,
      cutoff
    )
    const keywords: string[] = []
    for (const row of rows) {
      try {
        const directives: InvestigatorDirective[] = JSON.parse(row.directives)
        for (const d of directives) {
          if (d.target_keyword) keywords.push(d.target_keyword)
        }
      } catch {
        // skip malformed rows
      }
    }
    return [...new Set(keywords)]
  } catch {
    return []
  }
}

/**
 * Query Article records from the last `hours` hours and return source headlines.
 * This gives the LLM semantic awareness of actual topics covered, not just keyword strings.
 */
async function getRecentArticleHeadlines(hours: number): Promise<string[]> {
  if (hours <= 0) return []
  try {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    const rows = await prisma.$queryRawUnsafe<Array<{ sourceTitle: string | null; title: string }>>(
      `SELECT sourceTitle, title FROM "Article" WHERE createdAt >= ? AND status != 'Failed' ORDER BY createdAt DESC LIMIT 100`,
      cutoff
    )
    const headlines: string[] = []
    for (const row of rows) {
      const h = row.sourceTitle || row.title
      if (h && !h.startsWith('[Draft Failed]') && !h.startsWith('[Drafting]')) {
        headlines.push(h)
      }
    }
    return [...new Set(headlines)]
  } catch {
    return []
  }
}

function buildStrategistPrompt(
  nicheA: string,
  nicheB: string,
  shortTailCount: number,
  evergreenCount: number,
  recentKeywords: string[],
  recentHeadlines: string[],
  extraAvoidTopics: string[] = []
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Jakarta',
  })

  const totalDirectives = shortTailCount + evergreenCount

  // Build the JSON schema example dynamically
  const exampleDirectives = [
    ...Array(shortTailCount).fill(null).map(() => ({
      topic_type: 'short-tail',
      target_keyword: '...',
      search_intent: '...',
      angle: '...',
      suggested_search_queries: ['...', '...', '...'],
    })),
    ...Array(evergreenCount).fill(null).map(() => ({
      topic_type: 'evergreen',
      target_keyword: '...',
      search_intent: '...',
      angle: '...',
      suggested_search_queries: ['...', '...', '...'],
    })),
  ]

  const keywordsBlock = recentKeywords.length > 0
    ? `\n⛔ KEYWORDS ALREADY USED (do NOT reuse these exact keywords):\n${recentKeywords.map((k) => `  - "${k}"`).join('\n')}\n`
    : ''

  const headlinesBlock = recentHeadlines.length > 0
    ? `\n🚫 ARTICLES ALREADY PUBLISHED — avoid repeating the SAME specific franchise, IP, or named entity. The entire genre/category is still fair game; only the specific subject already covered is off-limits:\n${recentHeadlines.map((h) => `  • ${h}`).join('\n')}\n`
    : ''

  const investigatorFlagBlock = extraAvoidTopics.length > 0
    ? `\n🔴 INVESTIGATOR ALERT — Search results for these specific topics were dominated by the same franchise/IP listed below. Replace them with DIFFERENT specific subjects within the SAME niche (e.g. if "Jujutsu Kaisen" dominated, pick a different anime/manga title — do NOT abandon the genre):\n${extraAvoidTopics.map((t) => `  ✗ ${t}`).join('\n')}\n`
    : ''

  const avoidBlock = keywordsBlock + headlinesBlock + investigatorFlagBlock

  return `You are the Lead SEO Strategist for an Indonesian digital publishing network. Your goal is to maximize organic traffic by balancing explosive short-tail trends with high-value evergreen content.

Today's date (Jakarta time): ${today}

Our brand niches:
- Brand A (Gen-Z Tech): ${nicheA || 'Indonesian tech, startup, digital lifestyle'}
- Brand B (Formal Biz): ${nicheB || 'Indonesian business, investment, property'}
${avoidBlock}
Your Task:
1. Identify ${shortTailCount} Short-Tail Opportunit${shortTailCount === 1 ? 'y' : 'ies'}: Select trending topic${shortTailCount === 1 ? '' : 's'} that require immediate news coverage today to capture spike traffic in Indonesia.
2. Identify ${evergreenCount} Evergreen Opportunit${evergreenCount === 1 ? 'y' : 'ies'}: Define long-term, foundational topic${evergreenCount === 1 ? '' : 's'} related to our niches that will generate steady month-over-month traffic.

Rules:
- Each directive must cover a DISTINCT topic — no overlapping keywords or angles.
- Short-tail topics must be genuinely trending RIGHT NOW in Indonesia (not recycled from last week).
- Evergreen topics must have lasting search value and not duplicate previously covered fundamentals.
${(recentKeywords.length > 0 || recentHeadlines.length > 0) ? '- Avoid the specific franchise/IP/entity already covered — picking a different title within the same genre is perfectly fine.\n' : ''}
For each opportunity, define:
- The exact search intent
- The target keyword in Bahasa Indonesia or English (whichever dominates the search volume)
- The specific angle our copywriters should take
- Exact suggested_search_queries the Investigator agent should use to find source material (include site: operators where helpful)

You MUST respond with ONLY a valid JSON object in this exact format (${totalDirectives} total directives) — no preamble, no explanation:
${JSON.stringify({ investigator_directives: exampleDirectives }, null, 2)}`
}

/**
 * Run the SEO Strategist agent to generate investigator directives.
 * Deduplicates against recent cycles using the configured lookback window.
 */
export async function generateSeoDirectives(
  niches: { nicheA: string; nicheB: string },
  signal?: AbortSignal,
  options: { dedupeHours?: number; shortTailCount?: number; evergreenCount?: number; extraAvoidTopics?: string[] } = {}
): Promise<InvestigatorDirective[]> {
  const dedupeHours = options.dedupeHours ?? 24
  const shortTailCount = Math.max(0, options.shortTailCount ?? 2)
  const evergreenCount = Math.max(0, options.evergreenCount ?? 1)
  const totalDirectives = shortTailCount + evergreenCount

  if (totalDirectives === 0) {
    log('warn', '[SEO STRATEGIST] Both shortTailCount and evergreenCount are 0 — skipping directive generation')
    return []
  }

  const isReplacement = (options.extraAvoidTopics?.length ?? 0) > 0
  log('info', `[SEO STRATEGIST] ${isReplacement ? '[REPLACEMENT] ' : ''}Generating directives (${shortTailCount} short-tail + ${evergreenCount} evergreen, dedupe window: ${dedupeHours}h)...`)

  // Fetch recently used keywords AND published headlines for semantic dedup
  const [recentKeywords, recentHeadlines] = await Promise.all([
    getRecentKeywords(dedupeHours),
    getRecentArticleHeadlines(dedupeHours),
  ])
  if (recentKeywords.length > 0 || isReplacement) {
    log('info', `[SEO STRATEGIST] Avoiding ${recentKeywords.length} recent keyword(s) + ${recentHeadlines.length} published headline(s)${isReplacement ? ` + ${options.extraAvoidTopics!.length} Investigator-flagged topic(s)` : ''}`)
  }

  try {
    const response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 1500,
        temperature: 0.85,
        messages: [
          {
            role: 'user',
            content: buildStrategistPrompt(
              niches.nicheA,
              niches.nicheB,
              shortTailCount,
              evergreenCount,
              recentKeywords,
              recentHeadlines,
              options.extraAvoidTopics ?? []
            ),
          },
        ],
      },
      { signal }
    )

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    const parsed = JSON.parse(jsonText) as SeoStrategyOutput

    if (!Array.isArray(parsed.investigator_directives) || parsed.investigator_directives.length === 0) {
      throw new Error('Invalid SEO strategist response: missing investigator_directives')
    }

    log('success', `[SEO STRATEGIST] Generated ${parsed.investigator_directives.length} directives`)
    for (const d of parsed.investigator_directives) {
      log('info', `[SEO STRATEGIST] [${d.topic_type.toUpperCase()}] "${d.target_keyword}" — ${d.angle}`)
    }

    return parsed.investigator_directives
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[SEO STRATEGIST] Failed to generate directives: ${err}`)
    return []
  }
}
