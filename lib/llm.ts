import Anthropic from '@anthropic-ai/sdk'
import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import { log } from './logger'

// Next.js may not inject .env.local vars into the server bundle context when
// external packages (serverComponentsExternalPackages) are involved.
// Explicitly load them here so the Anthropic client always has the key.
dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })
console.log('[LLM] dotenv loaded — ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY, '| cwd:', process.cwd())

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment variables. Ensure it exists in .env.local')
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

const MODEL = 'claude-haiku-4-5-20251001'

const GEN_Z_GUIDELINES = `You are a digital news writer for a young Indonesian audience. Write in clear, energetic Bahasa Indonesia with a modern journalistic tone. You may use 1-2 relevant emojis per article MAX. Do NOT use slang like 'bestie', 'yo', 'no cap', 'gais', or code-switch excessively between English and Indonesian. Stay strictly factual — do not speculate, add opinions, or hallucinate anything not in the source. Structure: punchy headline, 3-4 short paragraphs, factual conclusion. Keep it under 400 words.`

const FORMAL_BIZ_GUIDELINES = `You are a senior business journalist. Write formal, authoritative, and precise prose. Stick EXCLUSIVELY to the facts provided in the source material. Do NOT speculate on market trends, motivations, or implications unless they are explicitly in the text. Structure with clear paragraphs. Target audience: C-suite executives. Keep it under 600 words.`

export const BRAND_GUIDELINES: Record<string, string> = {
  'gen-z-tech': GEN_Z_GUIDELINES,
  'formal-biz': FORMAL_BIZ_GUIDELINES,
}

/**
 * Triage an article for niche relevance.
 * Returns true if the article is relevant to the given niche.
 */
export async function triageArticle(
  headline: string,
  summary: string,
  niche: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 10,
      temperature: 0.0,
      messages: [
        {
          role: 'user',
          content: `You are a strict news triage filter. An article passes ONLY if it is DIRECTLY and primarily about the specified niche — not just tangentially related, not in the same broad industry, and not merely mentioning a related topic in passing.

Niche: "${niche}"

Headline: ${headline}
Summary: ${summary}

Is this article's PRIMARY subject directly within the specified niche? If in doubt, answer NO.
Respond with ONLY "YES" or "NO". No other text.`,
        },
      ],
    }, { signal })

    const text =
      response.content[0].type === 'text' ? response.content[0].text.trim().toUpperCase() : 'NO'
    return text === 'YES'
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[LLM] triageArticle failed: ${err}`)
    return false
  }
}

/**
 * Draft an article based on raw source text and brand guidelines.
 * Returns { title, content }.
 */
export async function draftArticle(
  rawText: string,
  brandId: string,
  brandGuidelines: string,
  signal?: AbortSignal
): Promise<{ title: string; content: string }> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: `${brandGuidelines}

Based on the following source material, write a complete news article. MONITOR SOURCE ADHERENCE STRICTLY: Do not add quotes, names, or dates not in the source. You MUST respond with valid JSON only in this exact format:
{
  "title": "Your article title here",
  "content": "Your full article content here"
}

Source material:
${rawText}

Respond ONLY with the JSON object. No preamble, no explanation.`,
        },
      ],
    }, { signal })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''

    // Strip markdown code fences if present
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    const parsed = JSON.parse(jsonText) as { title: string; content: string }
    if (!parsed.title || !parsed.content) {
      throw new Error('Invalid draft response: missing title or content')
    }
    return parsed
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[LLM] draftArticle failed for brand "${brandId}": ${err}`)
    // Return a fallback so pipeline can continue
    return {
      title: `[Draft Failed] Article for ${brandId}`,
      content: `Article generation failed. Source text was:\n\n${rawText.slice(0, 200)}...`,
    }
  }
}

/**
 * Review a drafted article for compliance.
 * Returns { status: 'PASS' | 'FAIL', reason: string }.
 * Temperature is fixed at 0.0 for deterministic review.
 */
export async function reviewArticle(
  draft: string,
  sourceText: string,
  signal?: AbortSignal
): Promise<{ status: 'PASS' | 'FAIL'; reason: string }> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 256,
      temperature: 0.0,
      messages: [
        {
          role: 'user',
          content: `You are an editorial compliance officer. Review the following drafted article against its source material.

Check for:
1. Factual accuracy — does the draft accurately represent the source?
2. No hallucinated facts, statistics, or quotes not present in the source
3. No defamatory or legally risky statements
4. Appropriate journalistic tone

Respond ONLY with valid JSON in this format:
{
  "status": "PASS" or "FAIL",
  "reason": "Brief explanation of decision"
}

SOURCE MATERIAL:
${sourceText}

DRAFTED ARTICLE:
${draft}

Respond ONLY with the JSON object.`,
        },
      ],
    }, { signal })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as { status: 'PASS' | 'FAIL'; reason: string }

    if (parsed.status === 'FAIL') {
      log('error', `[EDITOR] REJECTED: ${parsed.reason}`)
    } else {
      log('success', '[EDITOR] APPROVED for publication.')
    }

    if (parsed.status !== 'PASS' && parsed.status !== 'FAIL') {
      throw new Error(`Invalid status value: ${parsed.status}`)
    }
    return parsed
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[LLM] reviewArticle failed: ${err}`)
    return { status: 'FAIL', reason: `Review system error: ${err}` }
  }
}

/**
 * Investigator cross-reference: compare SEO directives against recently published
 * article titles in the DB. Returns the directives that are NOT already covered.
 * This gives the Investigator awareness of what the War Room has already published
 * so it doesn't kick off duplicate content pipelines.
 */
export async function filterDirectivesAgainstPublished(
  directives: Array<{ keyword: string; type: string; angle: string }>,
  publishedHeadlines: string[],
  signal?: AbortSignal
): Promise<string[]> {  // returns the keywords to KEEP
  if (publishedHeadlines.length === 0) return directives.map((d) => d.keyword)
  if (directives.length === 0) return []

  try {
    const directivesBlock = directives
      .map((d) => `- [${d.type}] "${d.keyword}" — angle: ${d.angle}`)
      .join('\n')

    const publishedBlock = publishedHeadlines
      .map((h) => `  • ${h}`)
      .join('\n')

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      temperature: 0.0,
      messages: [
        {
          role: 'user',
          content: `You are the Investigator agent. You have access to the War Room's publication log. Your job is to cross-reference the SEO Strategist's recommended topics against articles that have already been published to avoid producing duplicate content.

RECENTLY PUBLISHED ARTICLES:
${publishedBlock}

SEO STRATEGIST DIRECTIVES (topics the strategist wants to cover):
${directivesBlock}

Rules:
- A directive is DUPLICATE if its topic, franchise, or core subject is already well-covered by a published article.
- A directive is FRESH if it covers a genuinely different angle, subject, or entity not yet published.
- Be specific: "Jujutsu Kaisen review" is duplicate if a Jujutsu Kaisen article was published, but "Blue Lock episode recap" is fresh even if another anime was published.
- When in doubt, keep the directive (return it as fresh).

Respond ONLY with valid JSON — the keywords to keep (fresh directives):
{"keep": ["keyword1", "keyword2", ...]}`,
        },
      ],
    }, { signal })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as { keep: string[] }
    return Array.isArray(parsed.keep) ? parsed.keep : directives.map((d) => d.keyword)
  } catch (err) {
    if (signal?.aborted) throw err
    log('warn', `[LLM] filterDirectivesAgainstPublished failed: ${err} — keeping all directives`)
    return directives.map((d) => d.keyword)
  }
}

/**
 * Post-router franchise deduplication.
 * Takes all articles that passed niche triage and removes duplicates where multiple
 * articles are about the SAME specific franchise, IP, or named entity.
 * Returns the IDs of articles to KEEP (one per unique franchise/topic).
 */
export async function deduplicateByFranchise(
  items: Array<{ id: string; title: string; summary: string }>,
  signal?: AbortSignal
): Promise<string[]> {
  if (items.length <= 1) return items.map((i) => i.id)

  try {
    const itemsBlock = items
      .map((item, idx) => `[${idx}] ID:${item.id}\n    Title: ${item.title}\n    Summary: ${item.summary.slice(0, 120)}`)
      .join('\n\n')

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      temperature: 0.0,
      messages: [
        {
          role: 'user',
          content: `You are a content diversity editor. Below are news articles that passed niche triage. Your job is to ensure no specific franchise, IP, or named entity appears more than once.

ARTICLES:
${itemsBlock}

Rules:
- Group articles that are about the SAME specific franchise/IP/company/named entity.
- From each group with duplicates, keep ONLY the most informative/unique one (prefer the one with the most distinct angle).
- Articles about DIFFERENT subjects within the same genre are NOT duplicates (e.g., two different anime titles are fine).
- If all articles are already about distinct subjects, keep all of them.

Respond ONLY with valid JSON listing the IDs to KEEP:
{"keep": ["id1", "id2", ...]}`,
        },
      ],
    }, { signal })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as { keep: string[] }
    if (!Array.isArray(parsed.keep)) throw new Error('Invalid response')
    return parsed.keep
  } catch (err) {
    if (signal?.aborted) throw err
    log('warn', `[LLM] deduplicateByFranchise failed: ${err} — keeping all items`)
    return items.map((i) => i.id)
  }
}

/**
 * Detect whether search results across multiple SEO directives are concentrated
 * on the same franchise/topic. Returns the directives that are duplicates and
 * what dominant topic is causing the concentration.
 */
export async function detectTopicConcentration(
  directiveResults: Array<{ keyword: string; titles: string[] }>,
  signal?: AbortSignal
): Promise<{ duplicateKeywords: string[]; dominantTopics: string[] }> {
  const allTitles = directiveResults.flatMap((d) => d.titles)
  if (allTitles.length === 0) return { duplicateKeywords: [], dominantTopics: [] }

  try {
    const resultsBlock = directiveResults
      .map((d) => `Directive: "${d.keyword}"\nTitles:\n${d.titles.map((t) => `  - ${t}`).join('\n')}`)
      .join('\n\n')

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 256,
      temperature: 0.0,
      messages: [
        {
          role: 'user',
          content: `You are a content diversity analyst. Below are search results grouped by SEO directive keyword.

Your job: detect if multiple directives returned results dominated by the SAME specific franchise, IP, or named entity (e.g., all about "Jujutsu Kaisen" even though directives were different).

${resultsBlock}

Rules:
- A directive is a "duplicate" if its results are clearly about the SAME specific franchise/IP/entity as another directive's results.
- Only flag if 2+ directives share the exact same dominant subject. Genre overlap alone (e.g. both are anime) does NOT count.
- The dominantTopic must be the specific franchise/IP name (e.g. "Jujutsu Kaisen"), NOT a broad category like "anime".
- If all directives have genuinely diverse subjects, return empty arrays.

Respond ONLY with valid JSON:
{
  "duplicateKeywords": ["directive keyword that is a duplicate", ...],
  "dominantTopics": ["the dominant topic/franchise causing the duplication", ...]
}`,
        },
      ],
    }, { signal })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as { duplicateKeywords: string[]; dominantTopics: string[] }
    return {
      duplicateKeywords: Array.isArray(parsed.duplicateKeywords) ? parsed.duplicateKeywords : [],
      dominantTopics: Array.isArray(parsed.dominantTopics) ? parsed.dominantTopics : [],
    }
  } catch (err) {
    if (signal?.aborted) throw err
    log('warn', `[LLM] detectTopicConcentration failed: ${err}`)
    return { duplicateKeywords: [], dominantTopics: [] }
  }
}

/**
 * Revise an existing article draft based on editorial notes.
 * Unlike draftArticle (which writes from scratch), this shows the LLM its own
 * previous draft so it can make targeted corrections rather than re-writing blindly.
 */
export async function reviseArticle(
  currentDraft: { title: string; content: string },
  editorialNotes: string,
  sourceText: string,
  brandId: string,
  brandGuidelines: string,
  signal?: AbortSignal
): Promise<{ title: string; content: string }> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.5,
      messages: [
        {
          role: 'user',
          content: `${brandGuidelines}

You previously wrote the following article draft. The editor-in-chief has reviewed it and flagged specific issues. Your task is to REVISE the existing draft to fix ALL of the listed issues while keeping the article grounded in the source material.

CURRENT DRAFT (your previous version — revise this):
Title: ${currentDraft.title}
Content: ${currentDraft.content}

EDITORIAL REVISION NOTES — you MUST address each of these:
${editorialNotes}

SOURCE MATERIAL (factual reference only — do not add facts not present here):
${sourceText}

Respond ONLY with valid JSON in this exact format:
{
  "title": "Your revised title here",
  "content": "Your revised article content here"
}

No preamble, no explanation.`,
        },
      ],
    }, { signal })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(jsonText) as { title: string; content: string }
    if (!parsed.title || !parsed.content) {
      throw new Error('Invalid revision response: missing title or content')
    }
    return parsed
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[LLM] reviseArticle failed for brand "${brandId}": ${err}`)
    return currentDraft // fall back to keeping the current draft on error
  }
}

/**
 * Generate improvement feedback for a copywriter based on a recent draft.
 */
export async function generateCopywriterFeedback(
  draft: string,
  brandId: string,
  niche: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const guidelines = BRAND_GUIDELINES[brandId] || 'General journalist guidelines.'
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      temperature: 0.8,
      messages: [
        {
          role: 'user',
          content: `You are an editorial strategist reviewing a copywriter's recent output.

Brand: ${brandId}
Niche: ${niche}
Brand guidelines: ${guidelines}

Here is the recent draft:
${draft}

Provide ONE specific, actionable suggestion to improve future articles for this brand. Focus on tone, structure, SEO, or audience engagement. Keep it to 2-3 sentences.`,
        },
      ],
    }, { signal })

    return response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : 'No feedback generated.'
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[LLM] generateCopywriterFeedback failed: ${err}`)
    return `Feedback generation failed: ${err}`
  }
}

/**
 * Generate new source suggestions for the Investigator agent.
 */
export async function generateInvestigatorFeedback(
  sourcesUsed: string[],
  niche: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 512,
      temperature: 0.8,
      messages: [
        {
          role: 'user',
          content: `You are an investigative journalism strategist.

The Investigator agent is monitoring the following RSS sources for the niche "${niche}":
${sourcesUsed.join('\n')}

Suggest 2-3 additional high-quality Indonesian news sources, RSS feeds, or data sources that would improve coverage of this niche. Include the source name and why it would be valuable. Keep it concise.`,
        },
      ],
    }, { signal })

    return response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : 'No suggestions generated.'
  } catch (err) {
    if (signal?.aborted) throw err
    log('error', `[LLM] generateInvestigatorFeedback failed: ${err}`)
    return `Investigator feedback generation failed: ${err}`
  }
}
