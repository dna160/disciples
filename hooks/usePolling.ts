'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface UsePollingResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  interval: number
): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)
  const fetcherRef = useRef(fetcher)

  // Keep fetcherRef up to date without triggering re-effect
  fetcherRef.current = fetcher

  const execute = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true)
    try {
      const result = await fetcherRef.current()
      if (isMountedRef.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      }
    } finally {
      if (isMountedRef.current && isInitial) {
        setLoading(false)
      }
    }
  }, [])

  const refetch = useCallback(() => {
    execute(false)
  }, [execute])

  useEffect(() => {
    isMountedRef.current = true

    // Initial fetch
    execute(true)

    // Set up polling interval
    intervalRef.current = setInterval(() => {
      execute(false)
    }, interval)

    return () => {
      isMountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [execute, interval])

  return { data, loading, error, refetch }
}
