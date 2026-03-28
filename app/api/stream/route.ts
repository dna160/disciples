import { logEmitter, type LogEntry } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      // Send a connection-established event immediately
      const connectedEvent = JSON.stringify({
        level: 'info',
        message: 'SSE stream connected. Listening for pipeline events...',
        timestamp: new Date().toISOString(),
      })
      controller.enqueue(encoder.encode(`data: ${connectedEvent}\n\n`))

      // Handler for each log entry emitted by the pipeline
      const handler = (entry: LogEntry) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
        } catch {
          // Controller may be closed — ignore
        }
      }

      logEmitter.on('log', handler)

      // Keep-alive ping every 15 seconds to prevent proxy timeouts
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          clearInterval(keepAliveInterval)
        }
      }, 15_000)

      // Clean up when the client disconnects
      req.signal.addEventListener('abort', () => {
        logEmitter.off('log', handler)
        clearInterval(keepAliveInterval)
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  })
}
