import type { Settings } from '@/types'

// ─────────────────────────────────────────────
//  Centralised API Client
// ─────────────────────────────────────────────

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  // ── Articles ───────────────────────────────
  getArticles: async () => {
    const res = await request<{ articles: import('@/types').Article[] }>('/api/articles')
    return res.articles
  },

  getArticle: async (id: string) => {
    const res = await request<{ article: import('@/types').Article }>(`/api/articles/${id}`)
    return res.article
  },

  updateArticle: (id: string, data: { title: string; content: string }) =>
    request<{ article: import('@/types').Article }>(`/api/articles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  approveArticle: (id: string) =>
    request<{ success: boolean; wpPostId: string }>(
      `/api/articles/${id}/approve`,
      { method: 'POST' }
    ),

  updateLivePost: (id: string) =>
    request<{ success: boolean }>(`/api/articles/${id}/update-live`, {
      method: 'POST',
    }),

  clearArticles: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    return request<{ deleted: number }>(`/api/articles${qs}`, { method: 'DELETE' })
  },

  // ── Insights ───────────────────────────────
  getInsights: async () => {
    const res = await request<{ insights: import('@/types').Insight[] }>('/api/insights?status=all')
    return res.insights
  },

  approveInsight: (id: string) =>
    request<{ success: boolean }>(`/api/insights/${id}/approve`, {
      method: 'POST',
    }),

  dismissInsight: (id: string) =>
    request<{ success: boolean }>(`/api/insights/${id}/dismiss`, {
      method: 'POST',
    }),

  clearInsights: (targetAgent?: string) => {
    const qs = targetAgent ? `?targetAgent=${encodeURIComponent(targetAgent)}` : ''
    return request<{ deleted: number }>(`/api/insights${qs}`, { method: 'DELETE' })
  },

  // ── Pipeline ───────────────────────────────
  triggerPipeline: () =>
    request<{ cycleId: string; message: string }>('/api/process-news', {
      method: 'POST',
    }),

  // ── Settings ───────────────────────────────
  getSettings: () =>
    request<{ settings: Settings; schedulerRunning: boolean; pipelineRunning: boolean }>('/api/settings'),

  updateSettings: (data: Partial<Settings>) =>
    request<{
      success: boolean
      settings: Settings
      schedulerRunning: boolean
      pipelineRunning: boolean
    }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}
