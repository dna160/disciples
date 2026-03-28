/**
 * Metrics collection and analysis for observability.
 * Tracks tokens, costs, timing, and workflow performance.
 */

import { StageMetrics, CycleMetrics } from './api-types'

// Claude 3 Haiku pricing (as of Feb 2025)
const PRICING = {
  input_tokens_per_mtok: 0.80, // $0.80 per 1M input tokens
  output_tokens_per_mtok: 4.0, // $4.00 per 1M output tokens
}

export class MetricsCollector {
  private cycleId: string
  private stages: Map<string, StageMetrics> = new Map()
  private startTime: number

  constructor(cycleId: string) {
    this.cycleId = cycleId
    this.startTime = Date.now()
  }

  /**
   * Record stage completion with token usage and timing.
   */
  recordStage(
    stageName: string,
    status: 'success' | 'failure' | 'partial',
    options: {
      duration_ms: number
      items_processed: number
      items_failed?: number
      input_tokens?: number
      output_tokens?: number
      errors?: string[]
    }
  ): void {
    const inputTokens = options.input_tokens || 0
    const outputTokens = options.output_tokens || 0

    const cost =
      (inputTokens / 1_000_000) * PRICING.input_tokens_per_mtok +
      (outputTokens / 1_000_000) * PRICING.output_tokens_per_mtok

    const metric: StageMetrics = {
      stage: stageName,
      status,
      duration_ms: options.duration_ms,
      items_processed: options.items_processed,
      items_failed: options.items_failed || 0,
      tokens_used: inputTokens + outputTokens,
      cost_usd: parseFloat(cost.toFixed(4)),
      errors: options.errors || [],
    }

    this.stages.set(stageName, metric)
  }

  /**
   * Finalize and return complete cycle metrics.
   */
  finalize(): CycleMetrics {
    const totalDuration = Date.now() - this.startTime
    const stagesArray = Array.from(this.stages.values())

    const totalTokens = stagesArray.reduce((sum, s) => sum + s.tokens_used, 0)
    const totalCost = stagesArray.reduce((sum, s) => sum + s.cost_usd, 0)
    const articleCount = stagesArray.reduce((sum, s) => sum + s.items_processed, 0)

    return {
      cycleId: this.cycleId,
      startedAt: new Date(this.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      totalDuration_ms: totalDuration,
      stages: stagesArray,
      totalTokens,
      totalCost: parseFloat(totalCost.toFixed(4)),
      articleCount,
      publishedCount: 0, // Updated by publisher stage
    }
  }

  /**
   * Pretty-print metrics for logging/dashboards.
   */
  static formatMetrics(metrics: CycleMetrics): string {
    const lines = [
      `\n========== CYCLE METRICS ==========`,
      `Cycle ID: ${metrics.cycleId}`,
      `Duration: ${(metrics.totalDuration_ms / 1000).toFixed(2)}s`,
      `Articles: ${metrics.articleCount} processed, ${metrics.publishedCount} published`,
      `Tokens: ${metrics.totalTokens.toLocaleString()}`,
      `Cost: $${metrics.totalCost.toFixed(4)}`,
      `\nStages:`,
    ]

    for (const stage of metrics.stages) {
      lines.push(
        `  ${stage.stage}: ${stage.status} | ${stage.duration_ms}ms | ${stage.items_processed} items | ${stage.tokens_used} tokens | $${stage.cost_usd.toFixed(4)}`
      )
    }

    lines.push(`===================================\n`)
    return lines.join('\n')
  }

  /**
   * Estimate cost for a given token count (for pre-flight checks).
   */
  static estimateCost(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * PRICING.input_tokens_per_mtok +
      (outputTokens / 1_000_000) * PRICING.output_tokens_per_mtok
    )
  }
}

/**
 * Global metrics aggregator for dashboard/analytics.
 */
export class CycleMetricsStore {
  private cycles: Map<string, CycleMetrics> = new Map()

  addCycle(metrics: CycleMetrics): void {
    this.cycles.set(metrics.cycleId, metrics)
  }

  getCycle(cycleId: string): CycleMetrics | undefined {
    return this.cycles.get(cycleId)
  }

  getLatest(limit = 10): CycleMetrics[] {
    return Array.from(this.cycles.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit)
  }

  getAggregates(): {
    totalCycles: number
    totalArticles: number
    totalPublished: number
    totalCost: number
    avgDuration_ms: number
    avgCost: number
  } {
    const cycles = Array.from(this.cycles.values())

    if (cycles.length === 0) {
      return {
        totalCycles: 0,
        totalArticles: 0,
        totalPublished: 0,
        totalCost: 0,
        avgDuration_ms: 0,
        avgCost: 0,
      }
    }

    const totalArticles = cycles.reduce((sum, c) => sum + c.articleCount, 0)
    const totalPublished = cycles.reduce((sum, c) => sum + c.publishedCount, 0)
    const totalCost = cycles.reduce((sum, c) => sum + c.totalCost, 0)
    const avgDuration = cycles.reduce((sum, c) => sum + c.totalDuration_ms, 0) / cycles.length

    return {
      totalCycles: cycles.length,
      totalArticles,
      totalPublished,
      totalCost: parseFloat(totalCost.toFixed(4)),
      avgDuration_ms: Math.round(avgDuration),
      avgCost: parseFloat((totalCost / cycles.length).toFixed(4)),
    }
  }
}

// Global instance (in production, use a real store like Redis)
let globalStore: CycleMetricsStore | null = null

export function getMetricsStore(): CycleMetricsStore {
  if (!globalStore) {
    globalStore = new CycleMetricsStore()
  }
  return globalStore
}
