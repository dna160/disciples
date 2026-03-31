import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import { marked } from 'marked'
import { log } from './logger'

// ── Markdown → HTML safety-net ───────────────────────────────────────────────
// Even with strict prompts, Claude can occasionally emit Markdown syntax.
// This function ensures all article content published to WordPress is clean HTML.
function sanitizeToHtml(content: string): string {
  // If the content already looks fully HTML (starts with a block-level tag),
  // still run it through marked — it will pass HTML through untouched.
  return marked.parse(content) as string
}

dotenvConfig({ path: path.join(process.cwd(), '.env.local'), override: true })
dotenvConfig({ path: path.join(process.cwd(), '.env'), override: false })

// ── WordPress retry helper ────────────────────────────────────────────────────
// Retries fetch calls that fail with transient server errors (5xx, network).
// 4xx errors (except 429) are not retried — they indicate a client-side problem.
const WP_RETRY_MAX_ATTEMPTS = 4
const WP_RETRY_BASE_DELAY_MS = 10_000

function wpSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withWpRetry(fn: () => Promise<Response>): Promise<Response> {
  let attempt = 0
  while (true) {
    let response: Response | null = null
    try {
      response = await fn()
    } catch (networkErr) {
      // Network-level failure (DNS, connection refused, etc.)
      attempt++
      if (attempt >= WP_RETRY_MAX_ATTEMPTS) throw networkErr
      const delay = WP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      log('warn', `[WordPress] Network error — attempt ${attempt}/${WP_RETRY_MAX_ATTEMPTS}. Retrying in ${delay / 1000}s... (${networkErr})`)
      await wpSleep(delay)
      continue
    }

    // Retry on 429 or any 5xx (transient server-side errors)
    const isRetryable = response.status === 429 || (response.status >= 500 && response.status < 600)
    if (!isRetryable) return response

    attempt++
    if (attempt >= WP_RETRY_MAX_ATTEMPTS) return response // let caller handle the error body

    const delay = WP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
    log('warn', `[WordPress] HTTP ${response.status} — attempt ${attempt}/${WP_RETRY_MAX_ATTEMPTS}. Retrying in ${delay / 1000}s...`)
    await wpSleep(delay)
  }
}

interface WPPublishResult {
  id: number
  link: string
}

type WPBackend = 'mock' | 'wpcom' | 'selfhosted'

// ── Brand → WordPress Category mapping ───────────────────────────────────────
// Category IDs sourced from https://hotpink-dogfish-392833.hostingersite.com
// /wp-json/wp/v2/categories — verified 2026-03-31
// To refresh: GET /wp-json/wp/v2/categories?per_page=50
const BRAND_CATEGORY_ID: Record<string, number> = {
  'anime':        11,  // Anime
  'toys':         12,  // Toys
  'infotainment': 10,  // Infotainment
  'game':         13,  // Game
  'comic':        14,  // Comic
  'event':        17,  // Event
}

// Slug names for the wpcom v1.1 API (which takes category slugs, not IDs)
const BRAND_CATEGORY_SLUG: Record<string, string> = {
  'anime':        'anime',
  'toys':         'toys',
  'infotainment': 'infotainment',
  'game':         'game',
  'comic':        'comic',
  'event':        'event',
}

function getWPCredentials(): {
  postsEndpoint: string
  updateEndpoint: (postId: string) => string
  authHeader: string
  backend: WPBackend
} {
  const siteUrl = (process.env.WP_URL || 'http://localhost:3000/api/mock-wordpress').replace(/\/$/, '')

  if (siteUrl.includes('/api/mock-wordpress')) {
    const wpUsername = process.env.WP_USERNAME || 'admin'
    const wpPassword = process.env.WP_APP_PASSWORD || 'mock_password_here'
    const credentials = Buffer.from(`${wpUsername}:${wpPassword.trim()}`).toString('base64')
    return {
      postsEndpoint: siteUrl,
      updateEndpoint: (id) => `${siteUrl}/${id}`,
      authHeader: `Basic ${credentials}`,
      backend: 'mock',
    }
  }

  if (siteUrl.includes('wordpress.com')) {
    // WordPress.com hosted: use REST v1.1 API + OAuth2 Bearer token
    const accessToken = process.env.WPCOM_ACCESS_TOKEN
    if (!accessToken) {
      throw new Error('WPCOM_ACCESS_TOKEN is not set. Run the OAuth2 flow to generate one.')
    }
    const hostname = new URL(siteUrl).hostname
    const base = `https://public-api.wordpress.com/rest/v1.1/sites/${hostname}`
    return {
      postsEndpoint: `${base}/posts/new`,
      updateEndpoint: (id) => `${base}/posts/${id}`,
      authHeader: `Bearer ${accessToken}`,
      backend: 'wpcom',
    }
  }

  // Self-hosted WordPress: use Application Password with Basic auth
  const wpUsername = process.env.WP_USERNAME || 'admin'
  const wpPassword = process.env.WP_APP_PASSWORD || ''
  const credentials = Buffer.from(`${wpUsername}:${wpPassword.trim()}`).toString('base64')
  return {
    postsEndpoint: `${siteUrl}/wp-json/wp/v2/posts`,
    updateEndpoint: (id) => `${siteUrl}/wp-json/wp/v2/posts/${id}`,
    authHeader: `Basic ${credentials}`,
    backend: 'selfhosted',
  }
}

/**
 * Upload an image URL to the WordPress.com media library (wpcom v1.1 API).
 * Returns the media attachment ID, or undefined on failure.
 */
async function uploadMediaFromUrl(
  imageUrl: string,
  siteHostname: string,
  authHeader: string
): Promise<number | undefined> {
  try {
    const res = await fetch(
      `https://public-api.wordpress.com/rest/v1.1/sites/${siteHostname}/media/new`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({ media_urls: [imageUrl] }),
      }
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as { media?: Array<{ ID?: number }>; errors?: unknown[] }
    const mediaId = data.media?.[0]?.ID
    if (mediaId) {
      log('success', `[WordPress] Uploaded media ID ${mediaId} from ${imageUrl.slice(0, 60)}`)
    }
    return mediaId
  } catch {
    return undefined
  }
}

/**
 * Upload an image binary to a self-hosted WordPress site via /wp-json/wp/v2/media.
 * Fetches the image from the source URL, then POSTs its raw bytes to the WP Media API.
 * Returns the media attachment ID (for use as `featured_media`), or undefined on failure.
 *
 * Why binary upload instead of passing a URL?
 * The WP REST API v2 /media endpoint does NOT accept image URLs — you must
 * upload the actual file bytes. Only the wpcom v1.1 sideload endpoint accepts URLs.
 */
async function uploadImageBinaryToWordPress(
  imageUrl: string,
  wpBaseUrl: string,
  authHeader: string
): Promise<number | undefined> {
  try {
    // 1. Fetch the image from the external source
    const imageRes = await fetch(imageUrl)
    if (!imageRes.ok) {
      log('warn', `[WordPress] Could not fetch featured image from ${imageUrl.slice(0, 80)} (HTTP ${imageRes.status})`)
      return undefined
    }

    const imageBlob = await imageRes.blob()

    // 2. Determine content-type (prefer blob's type; fallback to JPEG)
    const contentType = imageBlob.type && imageBlob.type !== 'application/octet-stream'
      ? imageBlob.type
      : 'image/jpeg'

    // 3. Derive a filename from the URL (strip query strings)
    const urlPath = new URL(imageUrl).pathname
    const rawFilename = urlPath.split('/').pop() || `featured-image-${Date.now()}.jpg`
    const filename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_')

    // 4. POST binary to /wp-json/wp/v2/media
    const mediaEndpoint = `${wpBaseUrl.replace(/\/$/, '')}/wp-json/wp/v2/media`
    const mediaRes = await fetch(mediaEndpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': contentType,
      },
      body: imageBlob,
    })

    if (!mediaRes.ok) {
      const errText = await mediaRes.text().catch(() => '(no body)')
      log('warn', `[WordPress] Media upload failed (HTTP ${mediaRes.status}): ${errText.slice(0, 200)}`)
      return undefined
    }

    const mediaData = (await mediaRes.json()) as { id?: number; source_url?: string }
    const mediaId = mediaData.id

    if (mediaId) {
      log('success', `[WordPress] Featured image uploaded — media ID ${mediaId} (${filename})`)
    }
    return mediaId
  } catch (err) {
    log('warn', `[WordPress] Exception during featured image upload: ${err}`)
    return undefined
  }
}

/**
 * Extract the first image URL found in a piece of article content.
 * Handles both Markdown syntax and HTML <img> tags.
 */
function extractFirstImageUrl(content: string): string | null {
  const match = content.match(/!\[.*?\]\((.*?)\)|<img[^>]+src=["'](.*?)["']/)
  return match ? (match[1] || match[2] || null) : null
}

/**
 * Publish a new article to WordPress via REST API.
 * Returns the created post ID and link.
 */
export async function publishToWordPress(article: {
  title: string
  content: string
  brandId: string
  featuredImageUrl?: string
}): Promise<WPPublishResult> {
  const { postsEndpoint, authHeader, backend } = getWPCredentials()
  const siteUrl = (process.env.WP_URL || '').replace(/\/$/, '')

  // Resolve category for this brand
  const categoryId   = BRAND_CATEGORY_ID[article.brandId]   ?? 1   // fallback: Uncategorized
  const categorySlug = BRAND_CATEGORY_SLUG[article.brandId] ?? 'uncategorized'

  // ── Safety-net: coerce any residual Markdown to clean HTML ──────────────────
  // The LLM is instructed to output HTML, but this guarantees clean output
  // even if Markdown leaks through. marked passes well-formed HTML untouched.
  const htmlContent = sanitizeToHtml(article.content)

  // ── Attempt to resolve the featured image URL from content ──────────────────
  // If the caller didn't supply an explicit URL, scan the article content.
  const resolvedImageUrl =
    article.featuredImageUrl || extractFirstImageUrl(article.content) || null

  const payload: Record<string, unknown> = {
    title: article.title,
    content: htmlContent,
    status: 'publish',
  }

  if (backend === 'wpcom') {
    // v1.1 API: categories field is a comma-separated slug string
    payload.categories = categorySlug
    if (resolvedImageUrl) {
      const hostname = new URL(siteUrl).hostname
      const mediaId = await uploadMediaFromUrl(resolvedImageUrl, hostname, authHeader)
      if (mediaId) payload.featured_image = mediaId
    }
  } else {
    // wp/v2 REST API: categories field is an array of numeric IDs
    payload.categories = [categoryId]
    payload.meta = { brand_id: article.brandId }

    // Upload image binary to /wp-json/wp/v2/media and attach via `featured_media`.
    // The wp/v2 API requires an actual media library ID — it does NOT accept raw URLs.
    if (resolvedImageUrl) {
      const featuredMediaId = await uploadImageBinaryToWordPress(resolvedImageUrl, siteUrl, authHeader)
      if (featuredMediaId) {
        payload.featured_media = featuredMediaId
        log('info', `[WordPress] Featured media ID ${featuredMediaId} attached to post payload`)
      } else {
        log('warn', '[WordPress] Featured image upload failed — post will be published without a featured image')
      }
    }
  }

  log('info', `[WordPress] Publishing to category: ${categorySlug} (ID ${categoryId}) for brand "${article.brandId}"`)  

  let response: Response
  try {
    response = await withWpRetry(() => fetch(postsEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    }))
  } catch (err) {
    log('error', `[WordPress] Network error while publishing: ${err}`)
    throw new Error(`WordPress publish failed (network): ${err}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    log('error', `[WordPress] Publish returned HTTP ${response.status}: ${errorText}`)
    throw new Error(`WordPress publish failed (HTTP ${response.status}): ${errorText}`)
  }

  // v1.1 returns { ID, URL } — wp/v2 returns { id, link }
  const data = (await response.json()) as { ID?: number; id?: number; URL?: string; link?: string }
  const postId = data.ID ?? data.id
  const postLink = data.URL ?? data.link

  if (!postId) {
    throw new Error(`WordPress publish response missing post ID`)
  }

  return { id: postId, link: postLink || `${postsEndpoint}/${postId}` }
}

/**
 * Update an existing WordPress post via REST API.
 */
export async function updateWordPressPost(
  wpPostId: string,
  article: { title: string; content: string }
): Promise<void> {
  const { updateEndpoint, authHeader, backend } = getWPCredentials()

  const updateUrl = updateEndpoint(wpPostId)

  const payload = {
    title: article.title,
    content: article.content,
  }

  // v1.1 API uses POST for updates; wp/v2 and mock use PUT
  const method = backend === 'wpcom' ? 'POST' : 'PUT'

  let response: Response
  try {
    response = await withWpRetry(() => fetch(updateUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    }))
  } catch (err) {
    log('error', `[WordPress] Network error while updating post ${wpPostId}: ${err}`)
    throw new Error(`WordPress update failed (network): ${err}`)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    log('error', `[WordPress] Update post ${wpPostId} returned HTTP ${response.status}: ${errorText}`)
    throw new Error(`WordPress update failed (HTTP ${response.status}): ${errorText}`)
  }

  log('success', `[WordPress] Post ${wpPostId} updated successfully`)
}
