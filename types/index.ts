// ─────────────────────────────────────────────
//  Shared Types for Pantheon Newsroom
// ─────────────────────────────────────────────

export type ArticleStatus = 'Drafting' | 'Revising' | 'Pending Review' | 'Published' | 'Failed'
export type InsightStatus = 'Pending' | 'Approved' | 'Dismissed'
export type TargetAgent = 'Investigator' | 'Copywriter-A' | 'Copywriter-B'

export interface Article {
  id: string
  cycleId: string
  brandId: string // 'gen-z-tech' | 'formal-biz'
  status: ArticleStatus
  title: string
  content: string
  sourceUrl?: string
  sourceTitle?: string
  reviewResult?: string // JSON: { status: 'PASS'|'FAIL', reason: string }
  wpPostId?: string
  featuredImage?: string
  images?: string // JSON: string[] of additional image URLs (index 1+)
  revisionCount?: number
  createdAt: string
  updatedAt: string
}

export interface Insight {
  id: string
  targetAgent: TargetAgent
  suggestionText: string
  status: InsightStatus
  createdAt: string
}

export interface Settings {
  id: string
  scrapeFrequency: '10s' | '1h' | '4h' | '12h' | '24h'
  requireReview: boolean
  isLive: boolean
  targetNiche: string
  nicheA: string
  nicheB: string
  toneA: string
  toneB: string
  rssSourcesA: string
  rssSourcesB: string
  imageCountA: number
  imageCountB: number
  seoDedupeHours: number
  seoShortTail: number
  seoEvergreen: number
}

export interface LogEntry {
  level: 'info' | 'success' | 'error' | 'warn'
  message: string
  timestamp: string
}

export type NodeState = 'idle' | 'working' | 'success' | 'error'
export type NodeId =
  | 'seo-strategist'
  | 'investigator'
  | 'router'
  | 'copywriter-a'
  | 'copywriter-b'
  | 'editor'
  | 'publisher-a'
  | 'publisher-b'
