'use client'

import type { ArticleStatus, InsightStatus } from '@/types'

interface StatusBadgeProps {
  status: ArticleStatus | InsightStatus
  size?: 'sm' | 'md'
}

const STATUS_CONFIG: Record<
  ArticleStatus | InsightStatus,
  { bg: string; text: string; border: string; dot: string; label: string }
> = {
  Drafting: {
    bg: 'rgba(59, 130, 246, 0.12)',
    text: '#93C5FD',
    border: 'rgba(59, 130, 246, 0.35)',
    dot: '#3B82F6',
    label: 'Drafting',
  },
  Revising: {
    bg: 'rgba(251, 146, 60, 0.12)',
    text: '#FDBA74',
    border: 'rgba(251, 146, 60, 0.35)',
    dot: '#F97316',
    label: 'Revising',
  },
  'Pending Review': {
    bg: 'rgba(245, 158, 11, 0.12)',
    text: '#FCD34D',
    border: 'rgba(245, 158, 11, 0.35)',
    dot: '#F59E0B',
    label: 'Pending Review',
  },
  Published: {
    bg: 'rgba(16, 185, 129, 0.12)',
    text: '#34D399',
    border: 'rgba(16, 185, 129, 0.35)',
    dot: '#10B981',
    label: 'Published',
  },
  Failed: {
    bg: 'rgba(239, 68, 68, 0.12)',
    text: '#FCA5A5',
    border: 'rgba(239, 68, 68, 0.35)',
    dot: '#EF4444',
    label: 'Failed',
  },
  Pending: {
    bg: 'rgba(245, 158, 11, 0.12)',
    text: '#FCD34D',
    border: 'rgba(245, 158, 11, 0.35)',
    dot: '#F59E0B',
    label: 'Pending',
  },
  Approved: {
    bg: 'rgba(16, 185, 129, 0.12)',
    text: '#34D399',
    border: 'rgba(16, 185, 129, 0.35)',
    dot: '#10B981',
    label: 'Approved',
  },
  Dismissed: {
    bg: 'rgba(107, 107, 128, 0.12)',
    text: '#9CA3AF',
    border: 'rgba(107, 107, 128, 0.3)',
    dot: '#6B7280',
    label: 'Dismissed',
  },
}

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG['Dismissed']

  const paddingClass = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5'
  const textClass = size === 'md' ? 'text-xs' : 'text-[10px]'
  const dotSize = size === 'md' ? '7px' : '5px'

  return (
    <span
      style={{
        background: config.bg,
        color: config.text,
        border: `1px solid ${config.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        borderRadius: '4px',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
      className={`${paddingClass} ${textClass}`}
    >
      <span
        style={{
          display: 'inline-block',
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: config.dot,
          flexShrink: 0,
        }}
      />
      {config.label}
    </span>
  )
}
