import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createErrorResponse, NotFoundError, ValidationAppError, logErrorWithContext } from '@/lib/error-handler'
import { ArticleUpdateRequest } from '@/lib/api-types'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const article = await prisma.article.findUnique({
      where: { id: params.id },
    })

    if (!article) {
      throw new NotFoundError('Article', params.id)
    }

    return NextResponse.json({
      article,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext(`[API /articles/${params.id}] GET`, err)
    return createErrorResponse(err)
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await req.json()) as ArticleUpdateRequest

    if (!body.title && !body.content && !body.status) {
      throw new ValidationAppError([
        {
          field: 'body',
          message: 'At least one of title, content, or status must be provided',
        },
      ])
    }

    const existing = await prisma.article.findUnique({ where: { id: params.id } })
    if (!existing) {
      throw new NotFoundError('Article', params.id)
    }

    const updated = await prisma.article.update({
      where: { id: params.id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.content !== undefined && { content: body.content }),
        ...(body.status !== undefined && { status: body.status }),
      },
    })

    return NextResponse.json({
      article: updated,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext(`[API /articles/${params.id}] PUT`, err)
    return createErrorResponse(err)
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const article = await prisma.article.findUnique({ where: { id: params.id } })

    if (!article) {
      throw new NotFoundError('Article', params.id)
    }

    if (article.status === 'Published') {
      throw new ValidationAppError([
        {
          field: 'status',
          message: 'Cannot delete published articles. Use archive instead.',
        },
      ])
    }

    await prisma.article.delete({ where: { id: params.id } })

    return NextResponse.json({
      message: 'Article deleted',
      id: params.id,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext(`[API /articles/${params.id}] DELETE`, err)
    return createErrorResponse(err)
  }
}
