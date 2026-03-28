import { v4 as uuidv4 } from 'uuid'
import { prisma } from './prisma'
import { log } from './logger'
import { hasBeenSeen, markAsSeen } from './dedup'
import { fetchAllFeeds, type FeedItem } from './rss-fetcher'
import {
  triageArticle,
  draftArticle,
  reviseArticle,
  reviewArticle,
  generateCopywriterFeedback,
  generateInvestigatorFeedback,
  detectTopicConcentration,
  deduplicateByFranchise,
  filterDirectivesAgainstPublished,
  BRAND_GUIDELINES,
} from './llm'
import { publishToWordPress } from './wordpress'
import { resolveItemImages } from './image-resolver'
import { generateSeoDirectives, type InvestigatorDirective } from './seo-strategist'
import { searchMultiple } from './searcher'

// Base brands — niche & tone overrides are loaded per cycle from Settings
const BASE_BRANDS = [
  { id: 'gen-z-tech', settingsNicheKey: 'nicheA' as const, settingsToneKey: 'toneA' as const },
  { id: 'formal-biz', settingsNicheKey: 'nicheB' as const, settingsToneKey: 'toneB' as const },
]

// ── Pipeline state ────────────────────────────────────────────────────────────
// Stored on globalThis so it survives Next.js HMR module reloads in development.
// Without this, the abort route would import a freshly-reset module instance and
// call abort on an AbortController that has nothing to do with the running cycle.
// ─────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __pipelineState: {
    running: boolean
    shouldAbort: boolean
    controller: AbortController | null
  } | undefined
}

function state() {
  if (!globalThis.__pipelineState) {
    globalThis.__pipelineState = { running: false, shouldAbort: false, controller: null }
  }
  return globalThis.__pipelineState
}

export let pipelineAbortController: AbortController | null = null

export function getPipelineRunning(): boolean {
  return state().running
}

export function abortPipelineCycle(): void {
  const s = state()
  if (s.running) {
    s.shouldAbort = true
    s.controller?.abort()
    // Keep module-level ref in sync for callers that read it directly
    pipelineAbortController = s.controller
    log('warn', '[PIPELINE] Abort signal received. Terminating safely.')
  } else {
    log('warn', '[PIPELINE] Abort called but no pipeline is running.')
  }
}

function checkAbort() {
  const s = state()
  if (s.shouldAbort || s.controller?.signal.aborted) {
    log('error', '[PIPELINE] Process killed by user.')
    throw new Error('Pipeline manually aborted by user')
  }
}

// Extended type to cover new schema fields (Prisma client may lag behind schema)
type ExtendedSettings = {
  id: string
  scrapeFrequency: string
  requireReview: boolean
  isLive: boolean
  targetNiche: string
  nicheA: string
  nicheB: string
  toneA: string
  toneB: string
  rssSourcesA: string
  rssSourcesB: string
  imageCountA: number
  imageCountB: number
  seoDedupeHours: number
  seoShortTail: number
  seoEvergreen: number
}

async function getSettings(): Promise<ExtendedSettings> {
  const defaults: ExtendedSettings = {
    id: 'singleton',
    scrapeFrequency: '4h',
    requireReview: false,
    isLive: false,
    targetNiche: 'Indonesian property real estate',
    nicheA: '',
    nicheB: '',
    toneA: 'Gen-Z Tech: casual, energetic, emoji-friendly, Indonesian slang',
    toneB: 'Formal Biz: professional, authoritative, financial focus',
    rssSourcesA: '',
    rssSourcesB: '',
    imageCountA: 1,
    imageCountB: 1,
    seoDedupeHours: 24,
    seoShortTail: 2,
    seoEvergreen: 1,
  }
  const row = await prisma.settings.findUnique({ where: { id: 'singleton' } })
  if (!row) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.settings.create as any)({ data: defaults })
    return defaults
  }
  // Merge row with defaults so new fields always have a value
  return { ...defaults, ...row } as ExtendedSettings
}

export async function runPipelineCycle(isManual: boolean = false): Promise<string> {
  const s = state()
  if (s.running) {
    log('warn', '[PIPELINE] A cycle is already running. Skipping.')
    throw new Error('Pipeline already running')
  }

  const controller = new AbortController()
  s.running = true
  s.shouldAbort = false
  s.controller = controller
  pipelineAbortController = controller  // keep module ref in sync
  const cycleId = uuidv4()

  log('info', `[PIPELINE] ===== Starting cycle ${cycleId} ${isManual ? '(MANUAL)' : '(SCHEDULED)'} =====`)

  try {
    checkAbort()
    const settings = await getSettings()

    // GUARDRAIL: Refuse to run if system is not LIVE, unless it was a manual trigger
    if (!settings.isLive && !isManual) {
      log('warn', '[PIPELINE] Execution blocked: System is currently set to STANDBY (isLive=false) and this was a scheduled run.')
      state().running = false
      return 'execution_blocked'
    }

    // ----------------------------------------------------------------
    // STAGE 0 — SEO Strategist: Generate investigator directives
    // ----------------------------------------------------------------
    log('info', '[SEO STRATEGIST] Running SEO strategy analysis...')
    let seoDirectives: InvestigatorDirective[] = []
    try {
      seoDirectives = await generateSeoDirectives(
        { nicheA: settings.nicheA || settings.targetNiche, nicheB: settings.nicheB || settings.targetNiche },
        pipelineAbortController?.signal,
        {
          dedupeHours: settings.seoDedupeHours,
          shortTailCount: settings.seoShortTail,
          evergreenCount: settings.seoEvergreen,
        }
      )
      if (seoDirectives.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (prisma as any).seoDirective.upsert({
          where: { cycleId },
          create: { id: uuidv4(), cycleId, directives: JSON.stringify(seoDirectives) },
          update: { directives: JSON.stringify(seoDirectives) },
        })
        log('success', `[SEO STRATEGIST] ${seoDirectives.length} directives saved for cycle ${cycleId}`)
      }
    } catch (err) {
      log('warn', `[SEO STRATEGIST] Could not generate directives, continuing with RSS: ${err}`)
    }
    checkAbort()

    // ── Investigator DB cross-reference ──────────────────────────────────────
    // Before searching, compare SEO directives against recently published articles
    // so the Investigator won't chase content the War Room already has.
    // ─────────────────────────────────────────────────────────────────────────
    if (seoDirectives.length > 0) {
      try {
        const dedupeWindowHours = settings.seoDedupeHours ?? 24
        const cutoff = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000).toISOString()
        const publishedRows = await prisma.$queryRawUnsafe<Array<{ title: string; sourceTitle: string | null }>>(
          `SELECT title, sourceTitle FROM "Article" WHERE createdAt >= ? AND status NOT IN ('Failed','Drafting') ORDER BY createdAt DESC LIMIT 150`,
          cutoff
        )
        const publishedHeadlines = publishedRows
          .map((r) => r.sourceTitle || r.title)
          .filter((h) => h && !h.startsWith('[Draft Failed]') && !h.startsWith('[Drafting]'))

        if (publishedHeadlines.length > 0) {
          log('info', `[INVESTIGATOR] Cross-referencing ${seoDirectives.length} directive(s) against ${publishedHeadlines.length} recently published article(s)...`)
          const keepKeywords = await filterDirectivesAgainstPublished(
            seoDirectives.map((d) => ({ keyword: d.target_keyword, type: d.topic_type, angle: d.angle })),
            publishedHeadlines,
            pipelineAbortController?.signal
          )
          const before = seoDirectives.length
          seoDirectives = seoDirectives.filter((d) => keepKeywords.includes(d.target_keyword))
          const dropped = before - seoDirectives.length
          if (dropped > 0) {
            log('warn', `[INVESTIGATOR] Dropped ${dropped} directive(s) already covered in War Room — proceeding with ${seoDirectives.length} fresh directive(s)`)
          } else {
            log('info', `[INVESTIGATOR] All directives are fresh — no overlap with published content`)
          }
        }
      } catch (err) {
        log('warn', `[INVESTIGATOR] DB cross-reference failed, continuing with all directives: ${err}`)
      }
    }

    // ----------------------------------------------------------------
    // STAGE 1 — Investigator: Ingest news (Serper search or RSS fallback)
    // ----------------------------------------------------------------
    log('info', '[INVESTIGATOR] Starting news ingestion cycle...')
    log('info', `[INVESTIGATOR] Niche A (Gen-Z): "${settings.nicheA || settings.targetNiche}" | Niche B (Formal): "${settings.nicheB || settings.targetNiche}"`)

    let feedItems: FeedItem[]
    const serperKeySet = !!process.env.SERPER_API_KEY

    if (seoDirectives.length > 0 && serperKeySet) {
      // Search-driven ingestion: execute Serper queries from SEO directives
      log('info', '[INVESTIGATOR] SEO directives + SERPER_API_KEY detected — using targeted web search')

      // Helper: search one directive and return its hits
      const searchDirective = async (directive: (typeof seoDirectives)[number]) => {
        log('info', `[INVESTIGATOR] Searching for [${directive.topic_type}] "${directive.target_keyword}"`)
        return searchMultiple(directive.suggested_search_queries, 3)
      }

      // First pass: search all directives
      const directiveHitsMap = new Map<string, { directive: (typeof seoDirectives)[number]; hits: Awaited<ReturnType<typeof searchMultiple>> }>()
      for (const directive of seoDirectives) {
        const hits = await searchDirective(directive)
        directiveHitsMap.set(directive.target_keyword, { directive, hits })
      }

      // Diversity check — let the Investigator call out the SEO Strategist for duplication
      const directiveResults = Array.from(directiveHitsMap.entries()).map(([keyword, { hits }]) => ({
        keyword,
        titles: hits.map((h) => h.title).filter(Boolean),
      }))
      const { duplicateKeywords, dominantTopics } = await detectTopicConcentration(
        directiveResults,
        pipelineAbortController?.signal
      )

      if (duplicateKeywords.length > 0) {
        log('warn', `[INVESTIGATOR] ⚠ Topic concentration detected — dominant topic(s): ${dominantTopics.join(', ')}`)
        log('warn', `[INVESTIGATOR] Calling SEO Strategist to replace duplicate directive(s): ${duplicateKeywords.join(', ')}`)

        // Generate replacement directives from SEO Strategist, avoiding the dominant topics
        const dominantAsKeywords = dominantTopics.map((t) => `"${t}" (avoid entirely)`)
        const replacements = await generateSeoDirectives(
          { nicheA: settings.nicheA || settings.targetNiche, nicheB: settings.nicheB || settings.targetNiche },
          pipelineAbortController?.signal,
          {
            dedupeHours: settings.seoDedupeHours ?? 24,
            shortTailCount: duplicateKeywords.length,
            evergreenCount: 0,
            extraAvoidTopics: dominantAsKeywords,
          }
        )

        // Search replacement directives and swap into the map
        for (const replacement of replacements) {
          log('info', `[INVESTIGATOR] Searching replacement directive: "${replacement.target_keyword}"`)
          const hits = await searchDirective(replacement)
          // Remove one of the duplicate entries and add the replacement
          const dupKey = duplicateKeywords.shift()
          if (dupKey) directiveHitsMap.delete(dupKey)
          directiveHitsMap.set(replacement.target_keyword, { directive: replacement, hits })
        }
      }

      // Flatten all directive results into feedItems
      feedItems = []
      for (const { directive, hits } of directiveHitsMap.values()) {
        for (const hit of hits) {
          feedItems.push({
            title: hit.title,
            summary: hit.snippet,
            link: hit.link,
            pubDate: hit.date,
            source: hit.source,
            seoContext: {
              topicType: directive.topic_type,
              targetKeyword: directive.target_keyword,
              angle: directive.angle,
            },
          })
        }
      }
      log('info', `[INVESTIGATOR] Web search returned ${feedItems.length} raw items across ${directiveHitsMap.size} directives`)
    } else {
      // Fallback: RSS feed ingestion
      if (seoDirectives.length > 0 && !serperKeySet) {
        log('warn', '[INVESTIGATOR] SEO directives ready but SERPER_API_KEY not set — falling back to RSS')
      }
      feedItems = await fetchAllFeeds({
        nicheA: settings.nicheA,
        nicheB: settings.nicheB,
        rssSourcesA: settings.rssSourcesA,
        rssSourcesB: settings.rssSourcesB,
        targetNiche: settings.targetNiche,
      })
    }
    checkAbort()
    log('info', `[INVESTIGATOR] Fetched ${feedItems.length} raw items`)

    const newItems: FeedItem[] = []
    for (const item of feedItems) {
      checkAbort()
      const isSeen = await hasBeenSeen(item.link)
      if (!isSeen) {
        newItems.push(item)
      }
    }
    log('success', `[INVESTIGATOR] ${newItems.length} new items after deduplication`)

    if (newItems.length === 0) {
      log('info', '[INVESTIGATOR] No new items to process. Cycle complete.')
      return cycleId
    }

    // ----------------------------------------------------------------
    // STAGE 2 — Triage Router: Filter by niche relevance
    // ----------------------------------------------------------------
    log('info', '[ROUTER] Triaging articles for niche relevance...')

    // Build per-brand niches from settings — fall back to global targetNiche if blank
    const brandNiches: Record<string, string> = {
      'gen-z-tech': settings.nicheA?.trim() || settings.targetNiche,
      'formal-biz': settings.nicheB?.trim() || settings.targetNiche,
    }

    // An item is relevant if it passes triage for at least one brand's niche
    const itemBrandRelevance: Record<string, string[]> = {} // itemLink -> [brandIds]

    // Sort deduplicated items entirely by published date (newest first)
    newItems.sort(
      (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
    )

    // Limit to 10 most recent articles as requested
    const itemsToProcess = newItems.slice(0, 10)
    log('info', `[INVESTIGATOR] Processing top ${itemsToProcess.length} most recent articles`)

    // Resolve images in parallel — use the max count across both copywriters so we
    // fetch enough images once; each brand will slice to its own configured count.
    const maxImageCount = Math.max(settings.imageCountA || 1, settings.imageCountB || 1)
    log('info', `[IMAGE] Resolving up to ${maxImageCount} image(s) per item...`)
    const itemImageMap = new Map<string, string[]>()
    await Promise.all(
      itemsToProcess.map(async (item) => {
        const imgs = await resolveItemImages(item, maxImageCount)
        itemImageMap.set(item.link, imgs)
        item.featuredImage = imgs[0] // keep single-image field for compat
      })
    )
    log('info', `[IMAGE] Image resolution complete (${itemsToProcess.filter(i => i.featuredImage).length}/${itemsToProcess.length} resolved)`)

    for (const item of itemsToProcess) {
      checkAbort()
      const relevantBrands: string[] = []
      for (const [brandId, niche] of Object.entries(brandNiches)) {
        checkAbort()
        const isRelevant = await triageArticle(item.title, item.summary, niche, pipelineAbortController?.signal)
        if (isRelevant) relevantBrands.push(brandId)
      }
      if (relevantBrands.length > 0) {
        itemBrandRelevance[item.link] = relevantBrands
        log('success', `[ROUTER] PASS: "${item.title}" → brands: ${relevantBrands.join(', ')}`)
      } else {
        log('warn', `[ROUTER] SKIP: "${item.title}" - not relevant to any brand niche`)
      }
      await markAsSeen(item.link)
    }

    const relevantItems = itemsToProcess.filter((i) => i.link in itemBrandRelevance)

    if (relevantItems.length === 0) {
      log('info', '[ROUTER] No relevant items after triage. Cycle complete.')
      return cycleId
    }

    log('info', `[ROUTER] ${relevantItems.length} items passed triage`)

    // ── Franchise deduplication ────────────────────────────────────────────────
    // Even after per-directive diversity checks, the router can pass multiple
    // articles about the same franchise (e.g. 3× Jujutsu Kaisen from different
    // search queries). Haiku reads all passed titles and keeps only one per
    // specific franchise/IP/entity before handing off to the copywriters.
    // ──────────────────────────────────────────────────────────────────────────
    checkAbort()
    log('info', '[ROUTER] Running franchise deduplication on passed items...')
    const keepIds = await deduplicateByFranchise(
      relevantItems.map((item) => ({ id: item.link, title: item.title, summary: item.summary })),
      pipelineAbortController?.signal
    )
    const dedupedItems = relevantItems.filter((item) => keepIds.includes(item.link))
    const removedCount = relevantItems.length - dedupedItems.length
    if (removedCount > 0) {
      const removedTitles = relevantItems
        .filter((item) => !keepIds.includes(item.link))
        .map((item) => `"${item.title}"`)
      log('warn', `[ROUTER] Franchise dedup removed ${removedCount} duplicate(s): ${removedTitles.join(', ')}`)
    }
    log('info', `[ROUTER] ${dedupedItems.length} unique-franchise items proceeding to copywriters`)

    // ----------------------------------------------------------------
    // STAGE 3 — Fan-Out Copywriters: Draft for all brands
    // ----------------------------------------------------------------
    log('info', '[COPYWRITER] Fan-out drafting for all brands...')

    // Track all article IDs created in this stage for editor processing
    const draftedArticleIds: string[] = []
    const articleSourceMap: Record<string, string> = {}

    for (const item of dedupedItems) {
      checkAbort()
      log('info', `[COPYWRITER] Drafting article: "${item.title}"`)

      // Only draft for brands this item is relevant to
      const eligibleBrands = BASE_BRANDS.filter(
        (b) => (itemBrandRelevance[item.link] ?? []).includes(b.id)
      )

      // Fan out to eligible brands simultaneously
      const brandDraftPromises = eligibleBrands.map(async (brand) => {
        checkAbort()
        // Resolve tone guidelines: use per-brand tone from settings if set, else default
        const toneOverride = settings[brand.settingsToneKey]?.trim()
        const guidelines = toneOverride
          ? toneOverride + '\n\nWrite a complete news article in JSON format: {"title":"...","content":"..."}'
          : BRAND_GUIDELINES[brand.id]

        // Slice images to this brand's configured count
        const imageCountKey = brand.id === 'gen-z-tech' ? 'imageCountA' : 'imageCountB'
        const brandImageCount = settings[imageCountKey] || 1
        const allImages = itemImageMap.get(item.link) ?? (item.featuredImage ? [item.featuredImage] : [])
        const brandImages = allImages.slice(0, brandImageCount)
        const featuredImage = brandImages[0] ?? null
        const extraImages = brandImages.slice(1) // index 1+

        // Create DB record with 'Drafting' status
        const article = await prisma.article.create({
          data: {
            id: uuidv4(),
            cycleId,
            brandId: brand.id,
            status: 'Drafting',
            title: `[Drafting] ${item.title}`,
            content: '',
            sourceUrl: item.link,
            sourceTitle: item.title,
            featuredImage,
            images: extraImages.length > 0 ? JSON.stringify(extraImages) : null,
          },
        })

        const seoBlock = item.seoContext
          ? `\n\nSEO CONTEXT (incorporate naturally):\n- Target Keyword: ${item.seoContext.targetKeyword}\n- Content Angle: ${item.seoContext.angle}\n- Topic Type: ${item.seoContext.topicType}`
          : ''
        const fullSourceText = `Title: ${item.title}\n\nSummary: ${item.summary}\n\nSource: ${item.source}\nPublished: ${item.pubDate}${seoBlock}`
        articleSourceMap[article.id] = fullSourceText

        log('info', `[COPYWRITER] Drafting for brand "${brand.id}" — article ${article.id}`)

        const draft = await draftArticle(
          fullSourceText,
          brand.id,
          guidelines,
          pipelineAbortController?.signal
        )

        const updated = await prisma.article.update({
          where: { id: article.id },
          data: {
            title: draft.title,
            content: draft.content,
            status: 'Pending Review',
          },
        })

        log('success', `[COPYWRITER] Draft complete for brand "${brand.id}": "${draft.title}"`)
        return updated
      })

      const results = await Promise.all(brandDraftPromises)
      draftedArticleIds.push(...results.map((r) => r.id))
    }

    log('success', `[COPYWRITER] ${draftedArticleIds.length} total drafts created`)

    // ----------------------------------------------------------------
    // STAGE 4 — Editor-in-Chief: Review → Revise → Re-review (loop)
    // ----------------------------------------------------------------
    // Workflow:
    //   First-pass PASS  → auto-publish to WordPress immediately
    //   First-pass FAIL  → revision loop: revise → review → repeat until PASS
    //   Revised PASS     → queue for manual approval in War Room (Pending Review)
    //   After MAX_REVISIONS still failing → Pending Review (human decides)
    // ----------------------------------------------------------------
    const MAX_REVISIONS = 5

    log('info', '[EDITOR] Phase A: Running compliance guardrail...')

    const firstPassIds: string[] = []   // passed on first review → auto-publish
    const revisedPassIds: string[] = [] // passed after revision  → pending manual review
    const allPassedIds: string[] = []   // union, used for insights

    for (const articleId of draftedArticleIds) {
      checkAbort()
      const article = await prisma.article.findUnique({ where: { id: articleId } })
      if (!article) continue

      const sourceText = articleSourceMap[articleId] || article.content

      // ── First review ──────────────────────────────────────────────
      const firstReview = await reviewArticle(article.content, sourceText, pipelineAbortController?.signal)
      const firstReviewJson = JSON.stringify(firstReview)

      if (firstReview.status === 'PASS') {
        await prisma.article.update({ where: { id: articleId }, data: { reviewResult: firstReviewJson } })
        firstPassIds.push(articleId)
        allPassedIds.push(articleId)
        log('success', `[EDITOR] PASS (1st): "${article.title}" (${article.brandId})`)
        continue
      }

      // ── Revision loop — keep revising until PASS or MAX_REVISIONS ─
      log('warn', `[EDITOR] FAIL (1st): "${article.title}" — ${firstReview.reason}`)

      const brand = BASE_BRANDS.find((b) => b.id === article.brandId)
      if (!brand) continue
      const toneOverride = settings[brand.settingsToneKey]?.trim()
      const guidelines = toneOverride
        ? toneOverride + '\n\nWrite a complete news article in JSON format: {"title":"...","content":"..."}'
        : BRAND_GUIDELINES[brand.id]

      let lastReview = firstReview
      let revisionNum = 0
      let passed = false
      // Track the current draft so each revision sees the previous version, not just the source
      let currentDraft = { title: article.title, content: article.content }

      while (revisionNum < MAX_REVISIONS) {
        checkAbort()
        revisionNum++

        await prisma.article.update({
          where: { id: articleId },
          data: { status: 'Revising', reviewResult: JSON.stringify(lastReview), revisionCount: revisionNum },
        })

        log('info', `[COPYWRITER] Revision #${revisionNum} for "${article.brandId}" — notes: ${lastReview.reason}`)
        const revised = await reviseArticle(
          currentDraft,
          lastReview.reason,
          sourceText,
          article.brandId,
          guidelines,
          pipelineAbortController?.signal
        )
        currentDraft = revised

        await prisma.article.update({
          where: { id: articleId },
          data: { title: revised.title, content: revised.content },
        })
        log('info', `[COPYWRITER] Revision #${revisionNum} complete: "${revised.title}"`)

        const review = await reviewArticle(revised.content, sourceText, pipelineAbortController?.signal)
        lastReview = review

        if (review.status === 'PASS') {
          await prisma.article.update({ where: { id: articleId }, data: { reviewResult: JSON.stringify(review) } })
          revisedPassIds.push(articleId)
          allPassedIds.push(articleId)
          log('success', `[EDITOR] PASS (rev #${revisionNum}): "${revised.title}" → queued for manual approval`)
          passed = true
          break
        }

        log('warn', `[EDITOR] FAIL (rev #${revisionNum}): "${revised.title}" — ${review.reason}`)
      }

      if (!passed) {
        // Hit revision cap — send to Pending Review for human decision
        await prisma.article.update({
          where: { id: articleId },
          data: { status: 'Pending Review', reviewResult: JSON.stringify(lastReview) },
        })
        revisedPassIds.push(articleId)
        allPassedIds.push(articleId)
        log('warn', `[EDITOR] MAX REVISIONS reached for "${article.title}" — sent to Pending Review for human review`)
      }
    }

    log('info', `[EDITOR] Guardrail complete. ${firstPassIds.length} first-pass auto-publish, ${revisedPassIds.length} queued for review.`)

    // Phase B — Strategic Insights
    log('info', '[EDITOR] Phase B: Generating strategic insights...')

    const brandsWithPassingArticles = new Set<string>()
    for (const articleId of allPassedIds) {
      const article = await prisma.article.findUnique({ where: { id: articleId } })
      if (article) brandsWithPassingArticles.add(article.brandId)
    }

    for (const brandId of Array.from(brandsWithPassingArticles)) {
      const latestArticle = await prisma.article.findFirst({
        where: { cycleId, brandId, status: { not: 'Failed' } },
        orderBy: { createdAt: 'desc' },
      })
      if (latestArticle) {
        const feedback = await generateCopywriterFeedback(
          latestArticle.content,
          brandId,
          brandNiches[brandId] ?? settings.targetNiche,
          pipelineAbortController?.signal
        )
        const targetAgent = brandId === 'gen-z-tech' ? 'Copywriter-A' : 'Copywriter-B'
        await prisma.insight.create({
          data: { id: uuidv4(), targetAgent, suggestionText: feedback, status: 'Pending' },
        })
        log('success', `[EDITOR] Insight generated for ${targetAgent}`)
      }
    }

    const parseUrls = (s: string) =>
      s.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean)
    const feedSourceNames = [
      ...parseUrls(settings.rssSourcesA),
      ...parseUrls(settings.rssSourcesB),
    ]
    const insightNiche = [settings.nicheA, settings.nicheB, settings.targetNiche]
      .filter(Boolean)
      .join(' / ')
    const investigatorFeedback = await generateInvestigatorFeedback(
      feedSourceNames.length > 0 ? feedSourceNames : ['(no RSS sources configured)'],
      insightNiche,
      pipelineAbortController?.signal
    )
    await prisma.insight.create({
      data: { id: uuidv4(), targetAgent: 'Investigator', suggestionText: investigatorFeedback, status: 'Pending' },
    })
    log('success', '[EDITOR] Investigator insight generated')

    // ----------------------------------------------------------------
    // STAGE 5a — Auto-publish first-pass articles to WordPress
    // ----------------------------------------------------------------
    if (firstPassIds.length > 0) {
      log('info', `[PUBLISHER] Auto-publishing ${firstPassIds.length} first-pass article(s)...`)
      for (const articleId of firstPassIds) {
        checkAbort()
        const article = await prisma.article.findUnique({ where: { id: articleId } })
        if (!article) continue
        try {
          // Embed extra images into article content as figure blocks
          let publishContent = article.content
          const extraImgs: string[] = (article as any).images
            ? JSON.parse((article as any).images)
            : []
          if (extraImgs.length > 0) {
            const figures = extraImgs
              .map((url) => `<figure class="wp-block-image size-large"><img src="${url}" alt="" /></figure>`)
              .join('\n')
            publishContent = publishContent + '\n\n' + figures
          }

          const wpResult = await publishToWordPress({
            title: article.title,
            content: publishContent,
            brandId: article.brandId,
            featuredImageUrl: (article as any).featuredImage || undefined,
          })
          await prisma.article.update({
            where: { id: articleId },
            data: { status: 'Published', wpPostId: String(wpResult.id) },
          })
          log('success', `[PUBLISHER] Published: "${article.title}" → WP ID ${wpResult.id}`)
        } catch (err) {
          await prisma.article.update({ where: { id: articleId }, data: { status: 'Failed' } })
          log('error', `[PUBLISHER] Failed to publish "${article.title}": ${err}`)
        }
      }
    }

    // ----------------------------------------------------------------
    // STAGE 5b — Queue revised articles for manual approval
    // ----------------------------------------------------------------
    if (revisedPassIds.length > 0) {
      for (const articleId of revisedPassIds) {
        await prisma.article.update({ where: { id: articleId }, data: { status: 'Pending Review' } })
      }
      log('info', `[EDITOR] ${revisedPassIds.length} article(s) queued in War Room for manual approval`)
    }

    log('success', `[PIPELINE] ===== Cycle ${cycleId} complete =====`)
    return cycleId
  } catch (err) {
    if (err instanceof Error && err.message.includes('manually aborted')) {
      // Don't crash loudly if intentional
      log('warn', `[PIPELINE] Cycle ${cycleId} was successfully terminated.`)
    } else {
      log('error', `[PIPELINE] Cycle ${cycleId} failed with unhandled error: ${err}`)
      throw err
    }
    return cycleId
  } finally {
    const s = state()
    s.running = false
    s.shouldAbort = false
    s.controller = null
    pipelineAbortController = null
  }
}
