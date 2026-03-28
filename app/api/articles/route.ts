import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createErrorResponse } from '@/lib/error-handler'

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const where = status ? { status } : {}
    const { count } = await prisma.article.deleteMany({ where })
    return NextResponse.json({ deleted: count })
  } catch (err) {
    return createErrorResponse(err)
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const brandId = searchParams.get('brandId')
    const cycleId = searchParams.get('cycleId')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build dynamic where clause
    const where: Record<string, string> = {}
    if (status) where.status = status
    if (brandId) where.brandId = brandId
    if (cycleId) where.cycleId = cycleId

    const [articles, total] = await Promise.all([
      prisma.article.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.article.count({ where }),
    ])

    return NextResponse.json({
      articles,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + articles.length < total,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return createErrorResponse(err)
  }
}
