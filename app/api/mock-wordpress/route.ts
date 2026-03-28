import { NextResponse } from 'next/server'

// Global in-memory store shared across route handlers within the same process
declare global {
  // eslint-disable-next-line no-var
  var mockWpPosts: Record<string, {
    id: number
    title: { rendered: string }
    content: { rendered: string }
    status: string
    link: string
    date: string
    modified: string
    meta: Record<string, unknown>
  }>
  // eslint-disable-next-line no-var
  var mockWpPostIdCounter: number
}

if (!global.mockWpPosts) {
  global.mockWpPosts = {}
}
if (!global.mockWpPostIdCounter) {
  global.mockWpPostIdCounter = 1000
}

/**
 * POST /api/mock-wordpress
 * Mock WordPress REST API post creation.
 * Accepts: { title, content, status, meta }
 * Returns: WP-like post object with id and link.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string
      content?: string
      status?: string
      meta?: Record<string, unknown>
    }

    if (!body.title || !body.content) {
      return NextResponse.json(
        { code: 'rest_missing_callback_param', message: 'title and content are required' },
        { status: 400 }
      )
    }

    const id = ++global.mockWpPostIdCounter
    const now = new Date().toISOString()
    const slug = body.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)

    const post = {
      id,
      title: { rendered: body.title },
      content: { rendered: body.content },
      status: body.status || 'publish',
      link: `http://localhost:3000/mock-posts/${id}-${slug}`,
      date: now,
      modified: now,
      meta: body.meta || {},
    }

    global.mockWpPosts[String(id)] = post

    console.log(`[MockWP] Created post #${id}: "${body.title}"`)

    return NextResponse.json(post, { status: 201 })
  } catch (err) {
    console.error('[MockWP] POST error:', err)
    return NextResponse.json(
      { code: 'rest_error', message: `Internal error: ${err}` },
      { status: 500 }
    )
  }
}

/**
 * GET /api/mock-wordpress
 * Returns all mock posts (for debugging/inspection).
 */
export async function GET(_req: Request) {
  return NextResponse.json(Object.values(global.mockWpPosts))
}
