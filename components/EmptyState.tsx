'use client'

import { ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  /** Icon element to display above the message.  Defaults to an inbox SVG. */
  icon?: ReactNode
  /** Primary heading text. */
  message: string
  /** Optional sub-message / call-to-action description. */
  description?: string
  /** Optional action button or link rendered below the description. */
  action?: ReactNode
  /** Additional class names for the outer container. */
  className?: string
}

// ── Default icon ──────────────────────────────────────────────────────────

function DefaultIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-10 w-10 text-newsroom-muted"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
      />
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * EmptyState
 *
 * Renders a centred, dark-themed placeholder panel for empty lists or
 * zero-data states.  Accepts an optional icon, message, description, and
 * an action slot (e.g. a button to trigger the pipeline).
 *
 * Usage:
 *   <EmptyState message="No articles yet" description="Run the pipeline to generate content." />
 *
 *   <EmptyState
 *     icon={<CustomIcon />}
 *     message="No insights available"
 *     action={<button onClick={run}>Run pipeline</button>}
 *   />
 */
export function EmptyState({
  icon,
  message,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-newsroom-border bg-newsroom-surface px-6 py-12 text-center ${className}`}
    >
      {/* Icon */}
      <div className="mb-1 flex items-center justify-center">
        {icon ?? <DefaultIcon />}
      </div>

      {/* Primary message */}
      <p className="font-mono text-sm font-semibold text-newsroom-text">{message}</p>

      {/* Optional description */}
      {description && (
        <p className="max-w-xs font-mono text-xs leading-relaxed text-newsroom-muted">
          {description}
        </p>
      )}

      {/* Optional action */}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export default EmptyState
