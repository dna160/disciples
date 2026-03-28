import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { updateWordPressPost } from '@/lib/wordpress'
import { log } from '@/lib/logger'

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const article = await prisma.article.findUnique({ where: { id: params.id } })

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 })
    }

    if (article.status !== 'Published') {
      return NextResponse.json(
        { error: 'Article must be Published to update live' },
        { status: 422 }
      )
    }

    if (!article.wpPostId) {
      return NextResponse.json(
        { error: 'Article has no associated WordPress post ID' },
        { status: 422 }
      )
    }

    // Allow optional body to override title/content for the update
    let title = article.title
    let content = article.content

    try {
      const body = (await req.json()) as { title?: string; content?: string }
      if (body.title) title = body.title
      if (body.content) content = body.content
    } catch {
      // No body or invalid JSON — use current article data
    }

    log('info', `[API] Updating live WP post ${article.wpPostId} for article "${article.title}"...`)

    await updateWordPressPost(article.wpPostId, { title, content })

    // If title or content changed, persist in DB too
    const updated = await prisma.article.update({
      where: { id: params.id },
      data: { title, content },
    })

    log('success', `[API] Live update successful for WP post ${article.wpPostId}`)

    return NextResponse.json({
      article: updated,
      wpPostId: article.wpPostId,
      message: 'WordPress post updated successfully',
    })
  } catch (err) {
    log('error', `[API /articles/${params.id}/update-live] Error: ${err}`)
    return NextResponse.json({ error: `Failed to update live post: ${err}` }, { status: 500 })
  }
}
