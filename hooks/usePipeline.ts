'use client'

import { useCallback } from 'react'
import { usePolling } from './usePolling'
import { api } from '@/lib/api-client'
import type { Settings } from '@/types'

interface UsePipelineResult {
  settings: Settings | null
  loading: boolean
  error: string | null
  refetch: () => void
  updateSettings: (partial: Partial<Settings>) => Promise<void>
  triggerPipeline: () => Promise<{ cycleId: string; message: string }>
}

/**
 * Hook for managing pipeline settings and triggering runs.
 * Polls /api/settings every 10 seconds.
 * Provides convenience methods for updates and pipeline triggers.
 */
export function usePipeline(): UsePipelineResult {
  type SettingsResponse = { settings: Settings; schedulerRunning: boolean; pipelineRunning: boolean }
  const { data: rawData, loading, error, refetch } = usePolling<SettingsResponse>(
    () => api.getSettings(),
    10_000 // Poll every 10 seconds
  )
  const data = rawData?.settings ?? null

  const updateSettings = useCallback(
    async (partial: Partial<Settings>) => {
      await api.updateSettings(partial)
      refetch()
    },
    [refetch]
  )

  const triggerPipeline = useCallback(async () => {
    return await api.triggerPipeline()
  }, [])

  return {
    settings: data,
    loading,
    error,
    refetch,
    updateSettings,
    triggerPipeline,
  }
}
