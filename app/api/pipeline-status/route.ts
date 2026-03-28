/**
 * GET /api/pipeline-status
 * Real-time pipeline state for dashboard visualization.
 * Shows current cycle, stage, and progress metrics.
 */

import { NextResponse } from 'next/server'
import { getPipelineRunning } from '@/lib/pipeline'
import { prisma } from '@/lib/prisma'
import { PipelineStatusResponse } from '@/lib/api-types'
import { createErrorResponse } from '@/lib/error-handler'

export async function GET(_req: Request) {
  try {
    const isRunning = getPipelineRunning()

    // Get the most recent cycle
    const latestArticle = await prisma.article.findFirst({
      orderBy: { createdAt: 'desc' },
    })

    const latestCycleId = latestArticle?.cycleId
    let lastCycleStatus = 'unknown'
    let lastCycleTimestamp: string | undefined

    if (latestCycleId) {
      // Infer cycle status from article statuses
      const articles = await prisma.article.findMany({
        where: { cycleId: latestCycleId },
      })

      lastCycleTimestamp = latestArticle?.updatedAt?.toISOString()

      const published = articles.filter((a) => a.status === 'Published').length
      const failed = articles.filter((a) => a.status === 'Failed').length

      if (published > 0 && failed === 0) {
        lastCycleStatus = 'completed_success'
      } else if (failed > 0) {
        lastCycleStatus = 'completed_partial'
      } else if (articles.length > 0) {
        lastCycleStatus = 'in_progress'
      }
    }

    const response: PipelineStatusResponse = {
      isRunning,
      currentCycleId: isRunning ? 'unknown' : undefined, // Would need to expose from pipeline state
      uptime: Math.floor(process.uptime()),
      lastCycleId: latestCycleId,
      lastCycleStatus,
      lastCycleTimestamp,
    }

    return NextResponse.json(response)
  } catch (error) {
    return createErrorResponse(error)
  }
}

/**
 * Schema for GET /api/pipeline-status response
 *
 * {
 *   "isRunning": boolean,
 *   "currentCycleId"?: string,
 *   "uptime": number (seconds),
 *   "lastCycleId"?: string,
 *   "lastCycleStatus"?: "completed_success" | "completed_partial" | "in_progress",
 *   "lastCycleTimestamp"?: ISO8601 string
 * }
 */
