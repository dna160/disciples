'use client'

import { Component, ReactNode, ErrorInfo } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode
  /** Optional custom fallback UI.  Receives the error and a reset callback. */
  fallback?: (error: Error, resetError: () => void) => ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * ErrorBoundary
 *
 * Wraps any subtree and catches React render errors.  On error, renders a
 * dark-themed fallback panel consistent with the Pantheon newsroom design
 * system.  Provides a "Try again" button that resets the boundary so the
 * child subtree can re-mount.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomePotentiallyUnstableComponent />
 *   </ErrorBoundary>
 *
 * With custom fallback:
 *   <ErrorBoundary fallback={(err, reset) => <MyFallback error={err} onReset={reset} />}>
 *     ...
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production you could forward to an error tracking service here.
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack)
  }

  private resetError = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const { children, fallback } = this.props

    if (!hasError || !error) {
      return children
    }

    // Delegate to custom fallback if provided
    if (fallback) {
      return fallback(error, this.resetError)
    }

    // Default fallback UI — matches newsroom dark theme
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-4 rounded-lg border border-newsroom-border bg-newsroom-surface p-8 text-center"
      >
        {/* Amber warning icon */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-newsroom-amber-glow">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-newsroom-amber"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>

        <div>
          <h2 className="font-mono text-sm font-semibold text-newsroom-text">
            Something went wrong
          </h2>
          <p className="mt-1 font-mono text-xs text-newsroom-muted">
            {error.message || 'An unexpected error occurred.'}
          </p>
        </div>

        <button
          onClick={this.resetError}
          className="mt-2 rounded border border-newsroom-amber px-4 py-1.5 font-mono text-xs text-newsroom-amber transition-colors hover:bg-newsroom-amber-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-newsroom-amber"
        >
          Try again
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
