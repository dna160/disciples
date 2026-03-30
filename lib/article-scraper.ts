import { log } from './logger'

const SCRAPE_TIMEOUT_MS = 12_000
const MAX_PAGES = 3
const MAX_CHARS_PER_PAGE = 6_000

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
}

/**
 * Extract readable text from HTML. Strips scripts, styles, navigation elements
 * and all remaining tags, returning plain text.
 */
function extractReadableText(html: string): string {
  return html
    // Remove entire invisible/structural blocks
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS_PER_PAGE)
}

/**
 * Detect a "next page" link in raw HTML.
 * Checks rel="next", common anchor text, and href patterns (/page/N, ?page=N, ?p=N).
 */
function findNextPageUrl(html: string, currentUrl: string): string | null {
  // 1. <link rel="next" href="..."> or attribute order reversed
  const linkNext =
    html.match(/<link[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']next["']/i)
  if (linkNext?.[1]) {
    try { return new URL(linkNext[1], currentUrl).href } catch { /* skip */ }
  }

  // 2. <a rel="next" href="...">
  const anchorNext =
    html.match(/<a[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<a[^>]+href=["']([^"']+)["'][^>]+rel=["']next["']/i)
  if (anchorNext?.[1]) {
    try { return new URL(anchorNext[1], currentUrl).href } catch { /* skip */ }
  }

  // 3. Anchor with "next page" text in English or Indonesian
  const nextText = html.match(
    /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>\s*(?:Next|»|›|next\s+page|halaman\s+berikutnya|selanjutnya)\s*<\/a>/i
  )
  if (nextText?.[1]) {
    try { return new URL(nextText[1], currentUrl).href } catch { /* skip */ }
  }

  return null
}

/**
 * Scrape the full text content of an article URL.
 * Follows pagination links (rel=next, common patterns) up to MAX_PAGES pages.
 * Returns the concatenated text and number of pages scraped.
 * Never throws — returns empty content on any failure.
 */
export async function scrapeArticleContent(
  url: string,
  signal?: AbortSignal
): Promise<{ content: string; pagesScraped: number }> {
  if (!url || !url.startsWith('http')) {
    return { content: '', pagesScraped: 0 }
  }

  const pages: string[] = []
  let currentUrl: string | null = url
  let pagesScraped = 0

  while (currentUrl && pagesScraped < MAX_PAGES) {
    try {
      const fetchSignal = signal ?? AbortSignal.timeout(SCRAPE_TIMEOUT_MS)
      const res = await fetch(currentUrl, { headers: SCRAPE_HEADERS, signal: fetchSignal })
      if (!res.ok) break

      const html = await res.text()
      const pageText = extractReadableText(html)

      if (pageText.length > 100) {
        pages.push(pagesScraped === 0 ? pageText : `[Page ${pagesScraped + 1}]\n${pageText}`)
        pagesScraped++

        if (pagesScraped < MAX_PAGES) {
          const nextUrl = findNextPageUrl(html, currentUrl)
          if (nextUrl && nextUrl !== currentUrl) {
            log('info', `[SCRAPER] Pagination detected — page ${pagesScraped + 1}: ${nextUrl.slice(0, 80)}`)
            currentUrl = nextUrl
          } else {
            break
          }
        }
      } else {
        break
      }
    } catch {
      break
    }
  }

  if (pagesScraped > 1) {
    log('success', `[SCRAPER] Scraped ${pagesScraped} pages (${pages.reduce((n, p) => n + p.length, 0)} chars) from ${url.slice(0, 60)}`)
  }

  return { content: pages.join('\n\n'), pagesScraped }
}
