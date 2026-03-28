'use client'

import { useCallback } from 'react'
import { usePolling } from './usePolling'
import { api } from '@/lib/api-client'
import type { Insight } from '@/types'

interface UseInsightsResult {
  insights: Insight[]
  loading: boolean
  error: string | null
  refetch: () => void
  approveInsight: (id: string) => Promise<void>
  dismissInsight: (id: string) => Promise<void>
}

/**
 * Hook for fetching and managing insights.
 * Polls /api/insights every 5 seconds.
 * Provides convenience methods for approve/dismiss actions.
 */
export function useInsights(): UseInsightsResult {
  const { data, loading, error, refetch } = usePolling<Insight[]>(
    () => api.getInsights(),
    5_000 // Poll every 5 seconds
  )

  const approveInsight = useCallback(
    async (id: string) => {
      await api.approveInsight(id)
      refetch()
    },
    [refetch]
  )

  const dismissInsight = useCallback(
    async (id: string) => {
      await api.dismissInsight(id)
      refetch()
    },
    [refetch]
  )

  return {
    insights: Array.isArray(data) ? data : [],
    loading,
    error,
    refetch,
    approveInsight,
    dismissInsight,
  }
}
