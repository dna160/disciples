'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseWebSocketResult<T> {
  data: T | null
  isConnected: boolean
  error: string | null
  send: (message: any) => void
  reconnect: () => void
}

/**
 * Hook for WebSocket connections (optional real-time alternative to SSE/polling).
 * Automatically handles reconnection and cleanup.
 *
 * Usage:
 * ```
 * const { data, isConnected } = useWebSocket<LogEntry>(
 *   'ws://localhost:3000/api/ws',
 *   (msg) => console.log('Received:', msg)
 * )
 * ```
 */
export function useWebSocket<T>(
  url: string,
  onMessage?: (data: T) => void,
  options?: { reconnectInterval?: number; maxReconnectAttempts?: number }
): UseWebSocketResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)

  onMessageRef.current = onMessage

  const reconnectInterval = options?.reconnectInterval ?? 3000
  const maxAttempts = options?.maxReconnectAttempts ?? 5

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      wsRef.current = new WebSocket(url)

      wsRef.current.onopen = () => {
        setIsConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
      }

      wsRef.current.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as T
          setData(parsed)
          onMessageRef.current?.(parsed)
        } catch {
          console.error('Failed to parse WebSocket message:', event.data)
        }
      }

      wsRef.current.onerror = (event) => {
        console.error('WebSocket error:', event)
        setError('WebSocket connection failed')
      }

      wsRef.current.onclose = () => {
        setIsConnected(false)

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxAttempts) {
          reconnectAttemptsRef.current += 1
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, reconnectInterval)
        } else {
          setError('Max reconnection attempts reached')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create WebSocket')
    }
  }, [url, reconnectInterval, maxAttempts])

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0
    if (wsRef.current) {
      wsRef.current.close()
    }
    connect()
  }, [connect])

  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [connect])

  return { data, isConnected, error, send, reconnect }
}
