import { NextResponse } from 'next/server'
import { runPipelineCycle, getPipelineRunning } from '@/lib/pipeline'
import { log } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request) {
  if (getPipelineRunning()) {
    return NextResponse.json(
      { error: 'A pipeline cycle is already in progress.' },
      { status: 409 }
    )
  }

  const cycleId = crypto.randomUUID()

  // Fire and forget — do NOT await the full pipeline
  // The pipeline sets its own internal cycleId, but we return immediately
  log('info', `[API] Manual pipeline trigger received. Initiating background cycle...`)

  // Run the pipeline asynchronously without awaiting
  runPipelineCycle(true)
    .then((completedCycleId) => {
      log('success', `[API] Background pipeline cycle completed: ${completedCycleId}`)
    })
    .catch((err) => {
      log('error', `[API] Background pipeline cycle failed: ${err}`)
    })

  return NextResponse.json(
    {
      cycleId,
      message: 'Pipeline cycle started in background. Monitor /api/stream for real-time logs.',
    },
    { status: 202 }
  )
}
