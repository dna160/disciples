import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createErrorResponse, logErrorWithContext } from '@/lib/error-handler'
import { InsightStatus } from '@/lib/api-types'

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const targetAgent = searchParams.get('targetAgent')
    const where = targetAgent ? { targetAgent } : {}
    const { count } = await prisma.insight.deleteMany({ where })
    return NextResponse.json({ deleted: count })
  } catch (err) {
    logErrorWithContext('[API /insights] DELETE', err)
    return createErrorResponse(err)
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') ?? InsightStatus.Pending
    const targetAgent = searchParams.get('targetAgent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 500)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const where: Record<string, string> = {}

    // Allow passing 'all' to bypass status filter
    if (status !== 'all') {
      where.status = status
    }

    if (targetAgent) {
      where.targetAgent = targetAgent
    }

    const [insights, total] = await Promise.all([
      prisma.insight.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.insight.count({ where }),
    ])

    return NextResponse.json({
      insights,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + insights.length < total,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext('[API /insights] GET', err)
    return createErrorResponse(err)
  }
}
