import { NextResponse } from 'next/server'
import { abortPipelineCycle, getPipelineRunning } from '@/lib/pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  if (!getPipelineRunning()) {
    return NextResponse.json({ message: 'No pipeline is currently running.' }, { status: 400 })
  }

  abortPipelineCycle()
  
  return NextResponse.json({
    success: true,
    message: 'Abort signal sent. The pipeline will terminate at the next safe checkpoint.',
  })
}
