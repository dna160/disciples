import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { createErrorResponse, NotFoundError, ConflictError, logErrorWithContext } from '@/lib/error-handler'
import { InsightStatus } from '@/lib/api-types'

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const insight = await prisma.insight.findUnique({ where: { id: params.id } })

    if (!insight) {
      throw new NotFoundError('Insight', params.id)
    }

    if (insight.status !== InsightStatus.Pending) {
      throw new ConflictError(`Insight is already ${insight.status}. Cannot change status.`)
    }

    const updated = await prisma.insight.update({
      where: { id: params.id },
      data: { status: InsightStatus.Dismissed },
    })

    log('info', `[API] Insight ${params.id} dismissed (target: ${insight.targetAgent})`)

    return NextResponse.json({
      insight: updated,
      message: 'Insight dismissed.',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext(`[API /insights/${params.id}/dismiss]`, err)
    return createErrorResponse(err)
  }
}
