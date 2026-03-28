import { NextResponse } from 'next/server'
import { clearStore } from '@/lib/dedup'
import { log } from '@/lib/logger'

export async function POST(_req: Request) {
  try {
    await clearStore()
    log('info', '[API] Dedup cache cleared. All URLs will be treated as new on next cycle.')
    return NextResponse.json({
      success: true,
      message: 'Dedup cache cleared. Next pipeline run will reprocess all available articles.',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    log('error', `[API] Failed to clear dedup cache: ${err}`)
    return NextResponse.json(
      { error: 'Failed to clear dedup cache', timestamp: new Date().toISOString() },
      { status: 500 }
    )
  }
}
