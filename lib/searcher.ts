import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import { log } from './logger'

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

export interface SearchResult {
  title: string
  link: string
  snippet: string
  source: string
  date: string
}

const SERPER_ENDPOINT = 'https://google.serper.dev/news'
const SEARCH_TIMEOUT_MS = 10_000

/**
 * Search for news articles using Serper.dev.
 * Returns up to `maxResults` results per query.
 * Falls back to an empty array if the API key is missing or the call fails.
 */
export async function searchNews(
  query: string,
  maxResults: number = 5
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    log('warn', '[SEARCHER] SERPER_API_KEY not set — skipping web search')
    return []
  }

  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({ q: query, gl: 'id', hl: 'id', num: maxResults }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      log('warn', `[SEARCHER] Serper returned HTTP ${res.status} for query: "${query}"`)
      return []
    }

    const data = (await res.json()) as {
      news?: Array<{
        title?: string
        link?: string
        snippet?: string
        source?: string
        date?: string
      }>
    }

    return (data.news || []).slice(0, maxResults).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
      source: item.source || 'Serper News',
      date: item.date || new Date().toISOString(),
    }))
  } catch (err) {
    log('warn', `[SEARCHER] Search failed for "${query}": ${err}`)
    return []
  }
}

/**
 * Run multiple search queries and merge results, deduplicating by URL.
 */
export async function searchMultiple(
  queries: string[],
  maxPerQuery: number = 3
): Promise<SearchResult[]> {
  const seen = new Set<string>()
  const results: SearchResult[] = []

  for (const query of queries) {
    const hits = await searchNews(query, maxPerQuery)
    for (const hit of hits) {
      if (hit.link && !seen.has(hit.link)) {
        seen.add(hit.link)
        results.push(hit)
      }
    }
  }

  return results
}
