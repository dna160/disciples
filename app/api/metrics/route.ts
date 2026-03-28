/**
 * GET /api/metrics
 * Retrieve cycle metrics, costs, and performance analytics.
 * Supports filtering by date range and cycle ID.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getMetricsStore } from '@/lib/metrics'
import { createErrorResponse, NotFoundError } from '@/lib/error-handler'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const cycleId = searchParams.get('cycleId')
    const limit = parseInt(searchParams.get('limit') || '10', 10)
    const aggregates = searchParams.get('aggregates') === 'true'

    const store = getMetricsStore()

    if (cycleId) {
      // Return metrics for a specific cycle
      const metrics = store.getCycle(cycleId)
      if (!metrics) {
        throw new NotFoundError('Cycle metrics', cycleId)
      }
      return NextResponse.json(metrics)
    }

    if (aggregates) {
      // Return aggregated metrics across all cycles
      return NextResponse.json({
        summary: store.getAggregates(),
        samples: store.getLatest(limit),
      })
    }

    // Return recent cycles
    const recent = store.getLatest(limit)

    return NextResponse.json({
      cycles: recent,
      count: recent.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return createErrorResponse(error)
  }
}

/**
 * Schema for GET /api/metrics
 *
 * Without query params:
 * {
 *   "cycles": CycleMetrics[],
 *   "count": number,
 *   "timestamp": ISO8601 string
 * }
 *
 * With ?aggregates=true:
 * {
 *   "summary": {
 *     "totalCycles": number,
 *     "totalArticles": number,
 *     "totalPublished": number,
 *     "totalCost": number,
 *     "avgDuration_ms": number,
 *     "avgCost": number
 *   },
 *   "samples": CycleMetrics[]
 * }
 *
 * With ?cycleId=UUID:
 * CycleMetrics
 */
