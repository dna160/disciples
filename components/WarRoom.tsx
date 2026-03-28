'use client'

import { useState, useCallback } from 'react'
import ArticleSidebar from './ArticleSidebar'
import ArticleEditor from './ArticleEditor'
import InsightsPanel from './InsightsPanel'
import { usePolling } from '@/hooks/usePolling'
import { api } from '@/lib/api-client'
import type { Article, Insight } from '@/types'

export default function WarRoom() {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null)

  // ── Articles polling (every 3s) ─────────────────────────────────────────────
  const {
    data: articlesData,
    loading: articlesLoading,
    error: articlesError,
    refetch: refetchArticles,
  } = usePolling<Article[]>(() => api.getArticles(), 3_000)

  // ── Insights polling (every 5s) ─────────────────────────────────────────────
  const {
    data: insightsData,
    loading: insightsLoading,
    error: insightsError,
    refetch: refetchInsights,
  } = usePolling<Insight[]>(() => api.getInsights(), 5_000)

  const articles: Article[] = Array.isArray(articlesData) ? articlesData : []
  const insights: Insight[] = Array.isArray(insightsData) ? insightsData : []

  const selectedArticle = selectedArticleId
    ? articles.find((a) => a.id === selectedArticleId) ?? null
    : null

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(
    async (id: string, title: string, content: string) => {
      await api.updateArticle(id, { title, content })
      refetchArticles()
    },
    [refetchArticles]
  )

  const handleApprove = useCallback(
    async (id: string) => {
      await api.approveArticle(id)
      refetchArticles()
    },
    [refetchArticles]
  )

  const handleUpdateLive = useCallback(
    async (id: string) => {
      await api.updateLivePost(id)
      refetchArticles()
    },
    [refetchArticles]
  )

  const handleApproveInsight = useCallback(
    async (id: string) => {
      await api.approveInsight(id)
      refetchInsights()
    },
    [refetchInsights]
  )

  const handleDismissInsight = useCallback(
    async (id: string) => {
      await api.dismissInsight(id)
      refetchInsights()
    },
    [refetchInsights]
  )

  const handleClearArticles = useCallback(async (status?: string) => {
    await api.clearArticles(status)
    setSelectedArticleId(null)
    refetchArticles()
  }, [refetchArticles])

  const handleClearInsights = useCallback(async (targetAgent?: string) => {
    await api.clearInsights(targetAgent)
    refetchInsights()
  }, [refetchInsights])

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', width: '100%' }}>
      {/* ── LEFT: Article sidebar ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '280px', flexShrink: 0, height: '100%', overflow: 'hidden' }}>
        {articlesLoading && articles.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4B5563',
              fontSize: '0.75rem',
              borderRight: '1px solid #2A2A32',
              background: '#0D0D10',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Loading articles…
          </div>
        ) : articlesError ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#F87171',
              fontSize: '0.75rem',
              gap: '8px',
              borderRight: '1px solid #2A2A32',
              background: '#0D0D10',
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Articles unavailable
            </span>
            <span style={{ color: '#6B6B80', fontSize: '0.6875rem' }}>{articlesError}</span>
            <button className="btn-secondary" onClick={refetchArticles} style={{ marginTop: '8px' }}>
              Retry
            </button>
          </div>
        ) : (
          <ArticleSidebar
            articles={articles}
            selectedId={selectedArticleId}
            onSelect={setSelectedArticleId}
            onClearAll={handleClearArticles}
          />
        )}
      </div>

      {/* ── CENTER: Article editor ─────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #2A2A32',
        }}
      >
        <ArticleEditor
          article={selectedArticle}
          onSave={handleSave}
          onApprove={handleApprove}
          onUpdateLive={handleUpdateLive}
        />
      </div>

      {/* ── RIGHT: Insights panel ─────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '320px', flexShrink: 0, height: '100%', overflow: 'hidden' }}>
        {insightsLoading && insights.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4B5563',
              fontSize: '0.75rem',
              borderLeft: '1px solid #2A2A32',
              background: '#0D0D10',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Loading insights…
          </div>
        ) : insightsError ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#F87171',
              fontSize: '0.75rem',
              gap: '8px',
              borderLeft: '1px solid #2A2A32',
              background: '#0D0D10',
              padding: '16px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>Insights unavailable</span>
            <button className="btn-secondary" onClick={refetchInsights} style={{ marginTop: '8px' }}>
              Retry
            </button>
          </div>
        ) : (
          <InsightsPanel
            insights={insights}
            onApprove={handleApproveInsight}
            onDismiss={handleDismissInsight}
            onClearAll={handleClearInsights}
          />
        )}
      </div>
    </div>
  )
}
