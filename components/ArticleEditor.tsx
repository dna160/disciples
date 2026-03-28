'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Article } from '@/types'

interface ArticleEditorProps {
  article: Article | null
  onSave: (id: string, title: string, content: string) => Promise<void>
  onApprove: (id: string) => Promise<void>
  onUpdateLive: (id: string) => Promise<void>
}

interface ReviewResult {
  status: 'PASS' | 'FAIL'
  reason: string
}

function parseReviewResult(raw?: string): ReviewResult | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ReviewResult
  } catch {
    return null
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function ArticleEditor({
  article,
  onSave,
  onApprove,
  onUpdateLive,
}: ArticleEditorProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [updatingLive, setUpdatingLive] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [useMono, setUseMono] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Sync to article prop
  useEffect(() => {
    if (article) {
      setTitle(article.title)
      setContent(article.content)
      setIsDirty(false)
      setSavedAt(null)
      setSaveError(null)
    }
  }, [article?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTitleChange = (v: string) => {
    setTitle(v)
    setIsDirty(true)
  }

  const handleContentChange = (v: string) => {
    setContent(v)
    setIsDirty(true)
  }

  const handleSave = useCallback(async () => {
    if (!article || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(article.id, title, content)
      setSavedAt(new Date().toLocaleTimeString())
      setIsDirty(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [article, saving, onSave, title, content])

  const handleApprove = useCallback(async () => {
    if (!article || approving) return
    setApproving(true)
    try {
      await onApprove(article.id)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }, [article, approving, onApprove])

  const handleUpdateLive = useCallback(async () => {
    if (!article || updatingLive) return
    setUpdatingLive(true)
    try {
      await onUpdateLive(article.id)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setUpdatingLive(false)
    }
  }, [article, updatingLive, onUpdateLive])

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!article) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '40px',
          color: '#4B5563',
        }}
      >
        <span style={{ fontSize: '3rem', filter: 'grayscale(1) opacity(0.4)' }}>📄</span>
        <div style={{ textAlign: 'center' }}>
          <p
            style={{
              color: '#6B6B80',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '4px',
            }}
          >
            No article selected
          </p>
          <p style={{ color: '#374151', fontSize: '0.75rem' }}>
            Select an article from the sidebar to begin editing
          </p>
        </div>
      </div>
    )
  }

  const reviewResult = parseReviewResult(article.reviewResult)
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#0A0A0B',
      }}
    >
      {/* Editor toolbar */}
      <div
        style={{
          background: '#0D0D10',
          borderBottom: '1px solid #2A2A32',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {/* Article ID */}
        <span
          style={{
            color: '#374151',
            fontSize: '0.5625rem',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.06em',
          }}
        >
          #{article.id.slice(0, 8)}
        </span>

        <div style={{ width: '1px', height: '16px', background: '#2A2A32' }} />

        {/* Brand */}
        <span
          style={{
            color: article.brandId === 'gen-z-tech' ? '#C4B5FD' : '#93C5FD',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {article.brandId.toUpperCase()}
        </span>

        <div style={{ width: '1px', height: '16px', background: '#2A2A32' }} />

        {/* Word count */}
        <span
          style={{
            color: '#4B5563',
            fontSize: '0.5625rem',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
        </span>

        {/* Mono toggle */}
        <button
          onClick={() => setUseMono(!useMono)}
          style={{
            background: useMono ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
            border: `1px solid ${useMono ? 'rgba(245, 158, 11, 0.35)' : '#2A2A32'}`,
            color: useMono ? '#F59E0B' : '#6B6B80',
            fontSize: '0.5625rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            borderRadius: '4px',
            padding: '2px 8px',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            transition: 'all 0.15s ease',
          }}
        >
          MONO
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Dirty indicator */}
        {isDirty && (
          <span
            style={{
              color: '#F59E0B',
              fontSize: '0.5625rem',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            ● Unsaved changes
          </span>
        )}

        {/* Saved at */}
        {savedAt && !isDirty && (
          <span
            style={{
              color: '#10B981',
              fontSize: '0.5625rem',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            ✓ Saved at {savedAt}
          </span>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="btn-secondary"
          style={{
            borderColor: isDirty ? 'rgba(245, 158, 11, 0.4)' : '#2A2A32',
            color: isDirty ? '#F59E0B' : '#374151',
            fontSize: '0.6875rem',
            padding: '5px 14px',
          }}
        >
          {saving ? 'Saving…' : 'Save  ⌘S'}
        </button>

        {/* Status-dependent action buttons */}
        {article.status === 'Pending Review' && (
          <button
            onClick={handleApprove}
            disabled={approving}
            className="btn-success"
            style={{ fontSize: '0.6875rem', padding: '5px 14px' }}
          >
            {approving ? '⏳ Publishing…' : '✓ APPROVE & PUBLISH'}
          </button>
        )}

        {article.status === 'Published' && article.wpPostId && (
          <button
            onClick={handleUpdateLive}
            disabled={updatingLive}
            style={{
              background: 'rgba(59, 130, 246, 0.12)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#93C5FD',
              fontSize: '0.6875rem',
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              padding: '5px 14px',
              borderRadius: '4px',
              cursor: updatingLive ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: updatingLive ? 0.6 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {updatingLive ? '⏳ Updating…' : '↑ UPDATE LIVE POST'}
          </button>
        )}
      </div>

      {/* Save error */}
      {saveError && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#FCA5A5',
            fontSize: '0.75rem',
            padding: '6px 16px',
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
          }}
        >
          ⚠ {saveError}
        </div>
      )}

      {/* Review result banner */}
      {reviewResult && (
        <div
          style={{
            background:
              reviewResult.status === 'PASS'
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(239, 68, 68, 0.08)',
            borderBottom: `1px solid ${
              reviewResult.status === 'PASS'
                ? 'rgba(16, 185, 129, 0.25)'
                : 'rgba(239, 68, 68, 0.25)'
            }`,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.875rem', flexShrink: 0, marginTop: '1px' }}>
            {reviewResult.status === 'PASS' ? '✅' : '❌'}
          </span>
          <div>
            <span
              style={{
                color:
                  reviewResult.status === 'PASS' ? '#34D399' : '#F87171',
                fontSize: '0.625rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: "'JetBrains Mono', monospace",
                display: 'block',
                marginBottom: '2px',
              }}
            >
              REVIEW {reviewResult.status}
            </span>
            <span style={{ color: '#9CA3AF', fontSize: '0.8125rem', lineHeight: 1.4 }}>
              {reviewResult.reason}
            </span>
          </div>
        </div>
      )}

      {/* Source link */}
      {article.sourceUrl && (
        <div
          style={{
            background: '#080809',
            borderBottom: '1px solid #2A2A32',
            padding: '6px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#4B5563', fontSize: '0.6875rem' }}>🔗</span>
          <span style={{ color: '#6B6B80', fontSize: '0.6875rem' }}>Source:</span>
          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#60A5FA',
              fontSize: '0.6875rem',
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '400px',
            }}
            onMouseEnter={(e) =>
              ((e.target as HTMLAnchorElement).style.textDecoration = 'underline')
            }
            onMouseLeave={(e) =>
              ((e.target as HTMLAnchorElement).style.textDecoration = 'none')
            }
          >
            {article.sourceTitle || article.sourceUrl}
          </a>
        </div>
      )}

      {/* Featured image preview */}
      {article.featuredImage && (
        <div
          style={{
            background: '#080809',
            borderBottom: '1px solid #2A2A32',
            padding: '6px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#4B5563', fontSize: '0.6875rem' }}>🖼</span>
          <span
            style={{
              color: '#6B6B80',
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            FEATURED IMAGE
          </span>
          <img
            src={article.featuredImage}
            alt="Featured"
            style={{
              height: '36px',
              width: '64px',
              objectFit: 'cover',
              borderRadius: '3px',
              border: '1px solid #2A2A32',
              flexShrink: 0,
            }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <a
            href={article.featuredImage}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#4B5563',
              fontSize: '0.5625rem',
              fontFamily: "'JetBrains Mono', monospace",
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '280px',
            }}
          >
            {article.featuredImage}
          </a>
        </div>
      )}

      {/* Editor fields */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Title */}
        <div>
          <label
            style={{
              display: 'block',
              color: '#6B6B80',
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: '5px',
            }}
          >
            TITLE
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="newsroom-input"
            style={{
              fontSize: '1.0625rem',
              fontWeight: 600,
              padding: '10px 12px',
            }}
            placeholder="Article title…"
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label
            style={{
              display: 'block',
              color: '#6B6B80',
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: '5px',
            }}
          >
            CONTENT
          </label>
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            className={`newsroom-textarea${useMono ? ' mono' : ''}`}
            placeholder="Article content…"
            style={{ flex: 1, minHeight: '320px' }}
          />
        </div>

        {/* WP Post ID if published */}
        {article.wpPostId && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              background: 'rgba(16, 185, 129, 0.06)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: '6px',
            }}
          >
            <span style={{ fontSize: '0.875rem' }}>🌐</span>
            <span style={{ color: '#6B6B80', fontSize: '0.75rem' }}>WordPress Post:</span>
            <span
              style={{
                color: '#34D399',
                fontSize: '0.75rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
              }}
            >
              #{article.wpPostId}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
