'use client'

import { useCallback } from 'react'
import { usePolling } from './usePolling'
import { api } from '@/lib/api-client'
import type { Article } from '@/types'

interface UseArticlesResult {
  articles: Article[]
  loading: boolean
  error: string | null
  refetch: () => void
  updateArticle: (id: string, title: string, content: string) => Promise<void>
  approveArticle: (id: string) => Promise<void>
  updateLivePost: (id: string) => Promise<void>
}

/**
 * Hook for fetching and managing articles.
 * Polls /api/articles every 3 seconds.
 * Provides convenience methods for common operations.
 */
export function useArticles(): UseArticlesResult {
  const { data, loading, error, refetch } = usePolling<Article[]>(
    () => api.getArticles(),
    3_000 // Poll every 3 seconds
  )

  const updateArticle = useCallback(
    async (id: string, title: string, content: string) => {
      await api.updateArticle(id, { title, content })
      refetch()
    },
    [refetch]
  )

  const approveArticle = useCallback(
    async (id: string) => {
      await api.approveArticle(id)
      refetch()
    },
    [refetch]
  )

  const updateLivePost = useCallback(
    async (id: string) => {
      await api.updateLivePost(id)
      refetch()
    },
    [refetch]
  )

  return {
    articles: Array.isArray(data) ? data : [],
    loading,
    error,
    refetch,
    updateArticle,
    approveArticle,
    updateLivePost,
  }
}
