'use client'

import { HTMLAttributes } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface LoadingSpinnerProps extends HTMLAttributes<HTMLDivElement> {
  /** Size in pixels.  Defaults to 24. */
  size?: number
  /** Accessible label announced to screen readers.  Defaults to "Loading". */
  label?: string
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * LoadingSpinner
 *
 * An accessible, amber-coloured spinning indicator that matches the Pantheon
 * newsroom design system.  Renders an SVG spinner with a live-region label.
 *
 * Usage:
 *   <LoadingSpinner />
 *   <LoadingSpinner size={16} label="Fetching articles" />
 */
export function LoadingSpinner({
  size = 24,
  label = 'Loading',
  className = '',
  ...rest
}: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={`inline-flex items-center justify-center ${className}`}
      {...rest}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-spin text-newsroom-amber"
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          className="opacity-20"
        />
        {/* Spinning arc */}
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {/* Visually hidden text for screen readers */}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export default LoadingSpinner
