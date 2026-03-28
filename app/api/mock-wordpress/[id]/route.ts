import { NextResponse } from 'next/server'

// Re-use the same in-memory store via module-level import
// Since Next.js shares module state within a process, we import from the parent route
// We re-declare the store here — in production you'd use a shared module or DB
// For the mock, each process has its own in-memory store accessible from this route handler

// Shared in-memory posts store (mirrored from parent route — both live in same process)
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
}

if (!global.mockWpPosts) {
  global.mockWpPosts = {}
}

/**
 * GET /api/mock-wordpress/[id]
 * Returns a single mock post.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const post = global.mockWpPosts[params.id]

  if (!post) {
    return NextResponse.json(
      { code: 'rest_post_invalid_id', message: `Post ${params.id} not found` },
      { status: 404 }
    )
  }

  return NextResponse.json(post)
}

/**
 * PUT /api/mock-wordpress/[id]
 * Update an existing mock post (title, content).
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const post = global.mockWpPosts[params.id]

    if (!post) {
      return NextResponse.json(
        { code: 'rest_post_invalid_id', message: `Post ${params.id} not found` },
        { status: 404 }
      )
    }

    const body = (await req.json()) as { title?: string; content?: string }

    if (body.title) {
      post.title = { rendered: body.title }
    }
    if (body.content) {
      post.content = { rendered: body.content }
    }
    post.modified = new Date().toISOString()

    global.mockWpPosts[params.id] = post

    console.log(`[MockWP] Updated post #${params.id}: "${post.title.rendered}"`)

    return NextResponse.json(post)
  } catch (err) {
    console.error(`[MockWP] PUT /${params.id} error:`, err)
    return NextResponse.json(
      { code: 'rest_error', message: `Internal error: ${err}` },
      { status: 500 }
    )
  }
}
