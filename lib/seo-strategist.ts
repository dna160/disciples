import Parser from 'rss-parser'
import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { log } from './logger'
import { withRetry } from './llm'
import { prisma } from './prisma'

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

export interface InvestigatorDirective {
  topic_type: 'short-tail' | 'evergreen'
  brand: string // 'anime' | 'toys' | 'infotainment' | 'game' | 'comic'
  target_keyword: string
  search_intent: string
  angle: string
  suggested_search_queries: string[]
}

export interface SeoStrategyOutput {
  investigator_directives: InvestigatorDirective[]
}

const BRAND_IDS = ['anime', 'toys', 'infotainment', 'game', 'comic'] as const

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

// ---------------------------------------------------------------------------
// Google Trends RSS Integration
// ---------------------------------------------------------------------------

export interface TrendingTopic {
  keyword: string
  traffic: string
  newsList: string
}

/**
 * Fetches the top N daily trending topics from Google Trends RSS for a given
 * country code (e.g. 'ID' for Indonesia). Falls back to [] on any network error.
 */
export async function getRealTimeTrends(
  countryCode: string = 'ID',
  limit: number = 15
): Promise<TrendingTopic[]> {
  const parser = new Parser({
    customFields: {
      item: [['ht:approx_traffic', 'ht:approx_traffic']],
    },
  })
  try {
    const feed = await parser.parseURL(
      `https://trends.google.com/trending/rss?geo=${countryCode}`
    )
    const trendingTopics: TrendingTopic[] = feed.items.slice(0, limit).map((item) => ({
      keyword:   item.title ?? '(unknown)',
      // rss-parser stores custom fields under their tag name
      traffic:   ((item as unknown) as Record<string, unknown>)['ht:approx_traffic'] as string ?? 'N/A',
      newsList:  item.contentSnippet ?? '',
    }))
    log('info', `[TRENDS] Fetched ${trendingTopics.length} trending topics for geo=${countryCode}`)
    return trendingTopics
  } catch (error) {
    log('warn', `[TRENDS] Failed to fetch Google Trends (geo=${countryCode}): ${error}`)
    return []
  }
}

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

function buildStrategistPrompt(
  niches: Record<string, string>,
  shortTailPerBrand: number,
  evergreenPerBrand: number,
  recentKeywords: string[],
  extraAvoidTopics: string[] = [],
  trendingTopics: TrendingTopic[] = []
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Jakarta',
  })

  const totalPerBrand = shortTailPerBrand + evergreenPerBrand
  const totalDirectives = totalPerBrand * 5

  const keywordsBlock = recentKeywords.length > 0
    ? `\n⛔ KEYWORDS ALREADY USED THIS SESSION (do NOT reuse these exact keywords):\n${recentKeywords.map((k) => `  - "${k}"`).join('\n')}\n`
    : ''

  const investigatorFlagBlock = extraAvoidTopics.length > 0
    ? `\n🔴 INVESTIGATOR ALERT — The following specific topics/franchises were recently published or caused duplication. Replace them with DIFFERENT subjects within the SAME brand niche:\n${extraAvoidTopics.map((t) => `  ✗ ${t}`).join('\n')}\n`
    : ''

  const trendsBlock = trendingTopics.length > 0
    ? `\n📈 REAL-TIME GOOGLE TRENDS (geo=Indonesia, fetched now — use these as signals for short-tail topics):\n${trendingTopics
        .map((t, i) => `  ${i + 1}. "${t.keyword}" — est. traffic: ${t.traffic}${t.newsList ? ` | context: ${t.newsList.slice(0, 120)}` : ''}`)
        .join('\n')}\n`
    : ''

  const avoidBlock = keywordsBlock + investigatorFlagBlock + trendsBlock

  // Build the per-brand example structure
  const exampleDirective = (brand: string, type: 'short-tail' | 'evergreen') => ({
    brand,
    topic_type: type,
    target_keyword: '...',
    search_intent: '...',
    angle: '...',
    suggested_search_queries: ['...', '...', '...'],
  })

  const exampleDirectives: ReturnType<typeof exampleDirective>[] = []
  for (const brand of BRAND_IDS) {
    for (let i = 0; i < shortTailPerBrand; i++) exampleDirectives.push(exampleDirective(brand, 'short-tail'))
    for (let i = 0; i < evergreenPerBrand; i++) exampleDirectives.push(exampleDirective(brand, 'evergreen'))
  }

  const nicheLines = [
    `- anime: ${niches.anime || 'anime, manga, Japanese animation, otaku culture'}`,
    `- toys: ${niches.toys || 'toys, collectibles, action figures, hobby merchandise'}`,
    `- infotainment: ${niches.infotainment || 'celebrity news, trending entertainment, viral stories'}`,
    `- game: ${niches.game || 'video games, esports, gaming hardware, game releases'}`,
    `- comic: ${niches.comic || 'comics, graphic novels, manga, superhero media'}`,
  ].join('\n')

  return `You are the Lead SEO Strategist for an Indonesian digital publishing network. Your goal is to maximize organic traffic by balancing explosive short-tail trends with high-value evergreen content.

⚠️  NO STALE NEWS RULE: Never propose topics about events from previous years (e.g. past season finales, old film releases, historical results). All short-tail topics MUST reflect search intent that is active RIGHT NOW.

Today's date (Jakarta time): ${today}

Our 5 brand niches:
${nicheLines}
${avoidBlock}
Your Task:
For EACH of the 5 brands (anime, toys, infotainment, game, comic), generate:
- ${shortTailPerBrand} Short-Tail directive${shortTailPerBrand === 1 ? '' : 's'}: trending topic${shortTailPerBrand === 1 ? '' : 's'} requiring immediate news coverage today in Indonesia
- ${evergreenPerBrand} Evergreen directive${evergreenPerBrand === 1 ? '' : 's'}: long-term foundational topic${evergreenPerBrand === 1 ? '' : 's'} for steady month-over-month traffic

Total output: ${totalDirectives} directives (${totalPerBrand} per brand × 5 brands).

Rules:
- Every directive MUST include a "brand" field matching exactly one of: anime, toys, infotainment, game, comic
- Each brand MUST receive exactly ${shortTailPerBrand} short-tail + ${evergreenPerBrand} evergreen directive(s)
- All directives must be DISTINCT topics — no overlapping keywords or angles across ANY brand
- Short-tail topics must be genuinely trending RIGHT NOW in Indonesia
- Evergreen topics must have lasting search value
- The "brand" field determines which copywriter writes the article — pick the most relevant brand for each topic
${recentKeywords.length > 0 ? '- Avoid the exact keywords listed above — picking a different subject within the same genre is fine\n' : ''}
For each directive, define:
- target_keyword: exact keyword (Bahasa Indonesia or English, whichever dominates search volume)
- search_intent: what users are looking for
- angle: the specific take our copywriter should use
- suggested_search_queries: exact queries for the Investigator agent (include site: operators where helpful)

You MUST respond with ONLY a valid JSON object — no preamble, no explanation:
${JSON.stringify({ investigator_directives: exampleDirectives }, null, 2)}`
}

/**
 * Build a minimal prompt for generating a single replacement directive for one brand.
 * Called by the Investigator when a topic is rejected due to recent publication.
 */
function buildReplacementPrompt(
  brand: string,
  niche: string,
  topicType: 'short-tail' | 'evergreen',
  avoidTopics: string[]
): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Jakarta',
  })

  return `You are the SEO Strategist. The Investigator has rejected a topic for one of our brands because it was recently published.

Today (Jakarta): ${today}
Brand: ${brand}
Niche: ${niche}
Topic type needed: ${topicType}

🔴 REJECTED / RECENTLY PUBLISHED (do NOT suggest these or closely related subjects):
${avoidTopics.map((t) => `  ✗ "${t}"`).join('\n')}

Generate exactly 1 fresh ${topicType} directive for brand "${brand}". Choose a DIFFERENT specific subject within the niche — same genre is fine, just a distinct title/subject.

Respond ONLY with valid JSON (no preamble):
${JSON.stringify({
    brand,
    topic_type: topicType,
    target_keyword: '...',
    search_intent: '...',
    angle: '...',
    suggested_search_queries: ['...', '...', '...'],
  }, null, 2)}`
}

/**
 * Run the SEO Strategist agent to generate per-brand investigator directives.
 * Generates shortTailPerBrand + evergreenPerBrand topics for EACH of the 5 brands.
 */
export async function generateSeoDirectives(
  niches: { nicheA: string; nicheB: string; nicheC?: string; nicheD?: string; nicheE?: string },
  signal?: AbortSignal,
  options: {
    dedupeHours?: number
    shortTailPerBrand?: number
    evergreenPerBrand?: number
    // Legacy flat-mode used by detectTopicConcentration replacement calls
    shortTailCount?: number
    evergreenCount?: number
    extraAvoidTopics?: string[]
  } = {}
): Promise<InvestigatorDirective[]> {
  const dedupeHours = options.dedupeHours ?? 24

  // Per-brand mode (new default) vs legacy flat mode
  const isPerBrandMode = options.shortTailPerBrand !== undefined || options.evergreenPerBrand !== undefined
  const shortTailPerBrand = Math.max(0, options.shortTailPerBrand ?? options.shortTailCount ?? 2)
  const evergreenPerBrand = Math.max(0, options.evergreenPerBrand ?? options.evergreenCount ?? 1)

  if (shortTailPerBrand + evergreenPerBrand === 0) {
    log('warn', '[SEO STRATEGIST] Both counts are 0 — skipping directive generation')
    return []
  }

  const isReplacement = (options.extraAvoidTopics?.length ?? 0) > 0
  if (isPerBrandMode) {
    log('info', `[SEO STRATEGIST] Generating directives: ${shortTailPerBrand} short-tail + ${evergreenPerBrand} evergreen per brand × 5 brands = ${(shortTailPerBrand + evergreenPerBrand) * 5} total${isReplacement ? ' [REPLACEMENT MODE]' : ''} (dedup window: ${dedupeHours}h)`)
  } else {
    log('info', `[SEO STRATEGIST] [REPLACEMENT] Generating ${shortTailPerBrand} replacement directive(s)`)
  }

  const recentKeywords = await getRecentKeywords(dedupeHours)
  if (recentKeywords.length > 0) {
    log('info', `[SEO STRATEGIST] Avoiding ${recentKeywords.length} recent keyword(s)`)
  }

  const nicheMap = {
    anime:        niches.nicheA,
    toys:         niches.nicheB,
    infotainment: niches.nicheC ?? '',
    game:         niches.nicheD ?? '',
    comic:        niches.nicheE ?? '',
  }

  const totalExpected = isPerBrandMode
    ? (shortTailPerBrand + evergreenPerBrand) * 5
    : shortTailPerBrand + evergreenPerBrand

  try {
    // Fetch live Google Trends data — limit matches the total directive count so
    // every slot has at least one fresh trend signal to draw from (non-fatal).
    const trendsLimit = Math.max(5, totalExpected)
    const trendingTopics = await getRealTimeTrends('ID', trendsLimit)

    const response = await withRetry(() => getClient().messages.create(
      {
        model: MODEL,
        max_tokens: Math.min(8192, Math.max(1500, totalExpected * 250)),
        temperature: 0.85,
        messages: [
          {
            role: 'user',
            content: buildStrategistPrompt(
              nicheMap,
              isPerBrandMode ? shortTailPerBrand : Math.ceil(shortTailPerBrand / 5),
              isPerBrandMode ? evergreenPerBrand : Math.ceil(evergreenPerBrand / 5),
              recentKeywords,
              options.extraAvoidTopics ?? [],
              trendingTopics
            ),
          },
        ],
      },
      { signal }
    ), signal)

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as SeoStrategyOutput

    if (!Array.isArray(parsed.investigator_directives) || parsed.investigator_directives.length === 0) {
      throw new Error('Invalid SEO strategist response: missing investigator_directives')
    }

    log('success', `[SEO STRATEGIST] Generated ${parsed.investigator_directives.length} directives`)
    for (const d of parsed.investigator_directives) {
      log('info', `[SEO STRATEGIST] [${(d.brand ?? 'unknown').toUpperCase()}] [${d.topic_type.toUpperCase()}] "${d.target_keyword}" — ${d.angle}`)
    }

    return parsed.investigator_directives
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[SEO STRATEGIST] Failed to generate directives: ${err}`)
    return []
  }
}

/**
 * Generate a single replacement directive for a specific brand.
 * Called by the Investigator when a topic is rejected due to recent publication or conflict.
 */
export async function generateReplacementDirective(
  brand: string,
  niche: string,
  topicType: 'short-tail' | 'evergreen',
  avoidTopics: string[],
  signal?: AbortSignal
): Promise<InvestigatorDirective | null> {
  log('info', `[SEO STRATEGIST] Generating replacement [${topicType}] for brand "${brand}" — avoiding: ${avoidTopics.map(t => `"${t}"`).join(', ')}`)

  try {
    const response = await withRetry(() => getClient().messages.create(
      {
        model: MODEL,
        max_tokens: 512,
        temperature: 0.9,
        messages: [{ role: 'user', content: buildReplacementPrompt(brand, niche, topicType, avoidTopics) }],
      },
      { signal }
    ), signal)

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as InvestigatorDirective

    if (!parsed.target_keyword || !parsed.angle) {
      throw new Error('Invalid replacement directive response')
    }

    // Ensure brand is stamped correctly
    parsed.brand = brand
    parsed.topic_type = topicType

    log('success', `[SEO STRATEGIST] Replacement ready: "${parsed.target_keyword}" for ${brand}`)
    return parsed
  } catch (err) {
    if (signal?.aborted) throw err
    log('warn', `[SEO STRATEGIST] Failed to generate replacement for ${brand}: ${err}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Item 6 & 7: Distributed Topic Quota System with Strict Intent Definitions
// ---------------------------------------------------------------------------

export interface QuotaSlot {
  niche: typeof BRAND_IDS[number]
  type: 'shorttail' | 'evergreen'
}

export interface DistributedTopic {
  niche: string
  type: 'shorttail' | 'evergreen'
  title: string
  focus_keyword: string
  /** Specific Japanese IP/franchise (e.g. 'Jujutsu Kaisen', 'Gundam', 'Hololive'). 'General' if none. */
  franchise: string
  reasoning: string
}

/**
 * Strict SEO intent definitions injected per-prompt.
 * These prevent the LLM from using fuzzy or inconsistent interpretations of
 * "short-tail" and "evergreen". Each prompt receives ONLY the definition that
 * matches its slot — removing ambiguity entirely.
 */
const INTENT_DEFINITIONS: Record<QuotaSlot['type'], string> = {
  shorttail:
    'Broad, ONE-TO-THREE word search phrases with high search volume, high competition, and ' +
    'general intent (e.g., "Jujutsu Kaisen Review"). The topic MUST be trending RIGHT NOW. ' +
    'The focus_keyword must be 1–3 words ONLY.',
  evergreen:
    'Highly specific, multi-word search phrases (long-tail) with lower search volume but higher ' +
    'conversion potential. The content MUST remain relevant for years and NOT expire like breaking ' +
    'news (e.g., "How to watch Jujutsu Kaisen in chronological order"). ' +
    'The focus_keyword must be 4+ words.',
}

/**
 * Per-niche subculture constraints and copywriter persona definitions.
 *
 * Injected verbatim into every per-slot prompt to:
 *  1. Force the LLM to stay within the correct Japanese subculture domain.
 *  2. Give the LLM a named persona whose expertise anchors the topic choice.
 *  3. Provide explicit hard-exclusion rules preventing drift into generic
 *     Western content (e.g. DC/Marvel, Hollywood celebrities, Hot Wheels).
 */
const NICHE_CONFIG: Record<typeof BRAND_IDS[number], {
  persona: string
  context: string
  neverProduce: string
}> = {
  anime: {
    persona: 'Hardcore Anime Analyst',
    context:
      'Seasonal anime (currently airing), anime production news, studio announcements ' +
      '(e.g., MAPPA, Toei, Ufotable), voice cast updates, streaming release dates, and otaku culture events.',
    neverProduce:
      'Western cartoons, live-action adaptations, or any topic not rooted in Japanese animation.',
  },
  comic: {
    persona: 'Manga & Webtoon Scholar',
    context:
      'Japanese Manga (Weekly Shonen Jump, seinen, shoujo), Light Novels, and popular Asian Webtoons ' +
      '(Korean manhwa, Chinese manhua). Focus on publisher news, volume releases, and author updates.',
    neverProduce:
      'Western comics such as DC, Marvel, Image, or Dark Horse. ' +
      'This category is EXCLUSIVELY for Japanese manga and Asian webtoon content.',
  },
  infotainment: {
    persona: 'J-Pop & Seiyuu Insider',
    context:
      "Japanese Voice Actors (Seiyuu), Idol groups (AKB48, Nogizaka46, Johnny's), V-Tubers " +
      '(Hololive, Nijisanji), Japanese music artists, and Japanese entertainment celebrity news.',
    neverProduce:
      'Western celebrities, Hollywood actors, K-Pop artists, or any non-Japanese entertainment figure. ' +
      'This category is EXCLUSIVELY for Japanese entertainment personalities.',
  },
  toys: {
    persona: 'Otaku Collectibles Expert',
    context:
      'Anime scale figures (Good Smile Company, Kotobukiya, Alter), Gunpla model kits, ' +
      'Nendoroids, Figma, prize figures, official Japanese merchandise, and Japanese toy manufacturer news.',
    neverProduce:
      'Western toys such as Marvel Legends, Hot Wheels, or LEGO (non-anime collab). ' +
      'This category is EXCLUSIVELY for Japanese anime/manga IP merchandise.',
  },
  game: {
    persona: 'Japanese Gaming & Gacha Specialist',
    context:
      'Japanese game studios (Nintendo, Square Enix, Capcom, Bandai Namco, FromSoftware), ' +
      'JRPG releases, gacha/mobile games (Genshin Impact, Blue Archive, Arknights), and anime-based games.',
    neverProduce:
      'Western-only game studios or titles with no connection to Japanese culture, anime IP, or Japanese game developers.',
  },
}

/**
 * Generate topics enforcing an explicit per-slot quota.
 *
 * Each LLM call receives a named Copywriter Persona, a strict subculture
 * Context (what IS in scope), and a hard neverProduce exclusion list (what is
 * NEVER acceptable) — preventing drift into generic Western content.
 *
 * @param trendsData  Live trending signals to pass into each prompt.
 * @param quotas      Explicit list of {niche, type} slots to fill.
 *                    Defaults to 2 short-tail + 1 evergreen per brand (15 total).
 * @param signal      AbortSignal forwarded from the pipeline.
 */
export async function generateDistributedTopics(
  trendsData: TrendingTopic[],
  quotas?: QuotaSlot[],
  signal?: AbortSignal
): Promise<DistributedTopic[]> {
  // Build the default distribution: 2 short-tail + 1 evergreen × 5 brands = 15 slots
  const defaultQuotas: QuotaSlot[] = []
  for (const niche of BRAND_IDS) {
    defaultQuotas.push({ niche, type: 'shorttail' })
    defaultQuotas.push({ niche, type: 'shorttail' })
    defaultQuotas.push({ niche, type: 'evergreen' })
  }

  const distributionQuotas: QuotaSlot[] = quotas ?? defaultQuotas
  log('info', `[SEO STRATEGIST] Quota mode: generating ${distributionQuotas.length} topics (${distributionQuotas.filter(q => q.type === 'shorttail').length} short-tail, ${distributionQuotas.filter(q => q.type === 'evergreen').length} evergreen)`)

  const generatedTopics: DistributedTopic[] = []

  for (const quota of distributionQuotas) {
    if (signal?.aborted) break

    const config = NICHE_CONFIG[quota.niche]
    const intentDef = INTENT_DEFINITIONS[quota.type]
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Asia/Jakarta',
    })

    const forcedPrompt = `You are an elite SEO Strategist and Editor for a Japanese Subculture website targeting Indonesian readers.
Today (Jakarta): ${today}

CURRENT REAL-TIME TRENDS (prefer Japanese-related entries as inspiration):
${trendsData.length > 0
  ? trendsData.map((t, i) => `  ${i + 1}. "${t.keyword}" (est. traffic: ${t.traffic})`).join('\n')
  : '  (no trend data available — use your knowledge of current Japanese subculture events)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL INSTRUCTION — READ CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST generate exactly ONE topic.

NICHE & SUBCULTURE CONTEXT:
The topic MUST fall strictly under the "${quota.niche}" category.
In-scope content: ${config.context}

COPYWRITER PERSONA:
The article will be written by a "${config.persona}".
The topic MUST match their specific expertise domain listed above.

HARD EXCLUSION — NEVER PRODUCE:
${config.neverProduce}

ARTICLE INTENT (SEO Definition for "${quota.type}"):
${intentDef}

Do not deviate from the niche constraints, copywriter persona, or intent definition above.
Do not produce a topic about a different niche even if that niche has stronger trending signals.

Respond ONLY with a valid JSON object — no preamble, no explanation:
{
  "title": "Catchy, SEO-optimised article title",
  "focus_keyword": "exact keyword phrase (must match the intent type word-count rule above)",
  "franchise": "The specific Japanese IP or franchise central to this topic (e.g. 'Jujutsu Kaisen', 'Gundam', 'Hololive', 'Blue Archive'). Use 'General' only if no specific IP applies.",
  "reasoning": "1-sentence confirmation that this topic is within the niche scope and intent type"
}`

    try {
      const response = await withRetry(
        () => getClient().messages.create({
          model: MODEL,
          max_tokens: 300,
          temperature: 0.85,
          messages: [{ role: 'user', content: forcedPrompt }],
        }),
        signal
      )
      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
      const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      const parsed = JSON.parse(jsonText) as { title: string; focus_keyword: string; franchise?: string; reasoning: string }

      if (!parsed.title || !parsed.focus_keyword) {
        throw new Error('Missing title or focus_keyword in response')
      }

      generatedTopics.push({
        niche: quota.niche,
        type: quota.type,
        title: parsed.title,
        focus_keyword: parsed.focus_keyword,
        // Fallback: use focus_keyword if LLM omits or nulls the franchise field
        franchise: (parsed.franchise || parsed.focus_keyword || 'general').trim(),
        reasoning: parsed.reasoning ?? '',
      })
      log('success', `[SEO STRATEGIST] [QUOTA] [${quota.niche.toUpperCase()}] [${quota.type}] "${parsed.focus_keyword}" — via ${config.persona}`)
    } catch (err) {
      if (signal?.aborted) break
      log('error', `[SEO STRATEGIST] [QUOTA] Failed to generate topic for ${quota.niche} / ${quota.type}: ${err}`)
      // Slot failure is non-fatal: continue with remaining slots
    }
  }

  log('info', `[SEO STRATEGIST] Quota run complete. ${generatedTopics.length}/${distributionQuotas.length} slots filled.`)
  return generatedTopics
}
