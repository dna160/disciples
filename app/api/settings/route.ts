import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startScheduler, stopScheduler, isRunning } from '@/lib/scheduler'
import { getPipelineRunning } from '@/lib/pipeline'
import { log } from '@/lib/logger'
import { createErrorResponse, ValidationAppError, logErrorWithContext } from '@/lib/error-handler'

// New fields that the stale Prisma client doesn't know yet — handled via raw SQL
const EXTENDED_STRING_FIELDS = ['nicheA', 'nicheB', 'toneA', 'toneB', 'rssSourcesA', 'rssSourcesB'] as const
type ExtendedField = typeof EXTENDED_STRING_FIELDS[number]

const EXTENDED_DEFAULTS: Record<ExtendedField, string> = {
  nicheA: '',
  nicheB: '',
  toneA: 'Gen-Z Tech: casual, energetic, emoji-friendly, Indonesian slang',
  toneB: 'Formal Biz: professional, authoritative, financial focus',
  rssSourcesA: '',
  rssSourcesB: '',
}

const VALID_FREQUENCIES = ['10s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '24h']

// Read extended fields directly from SQLite for a given settings row id
async function readExtendedFields(id: string): Promise<Record<ExtendedField, string>> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT nicheA, nicheB, toneA, toneB, rssSourcesA, rssSourcesB FROM "Settings" WHERE id = ?`,
      id
    )
    if (rows.length === 0) return { ...EXTENDED_DEFAULTS }
    const row = rows[0]
    return {
      nicheA: (row.nicheA as string) ?? '',
      nicheB: (row.nicheB as string) ?? '',
      toneA: (row.toneA as string) ?? EXTENDED_DEFAULTS.toneA,
      toneB: (row.toneB as string) ?? EXTENDED_DEFAULTS.toneB,
      rssSourcesA: (row.rssSourcesA as string) ?? '',
      rssSourcesB: (row.rssSourcesB as string) ?? '',
    }
  } catch {
    return { ...EXTENDED_DEFAULTS }
  }
}

// Write only the extended fields that are present in the incoming body
async function writeExtendedFields(
  id: string,
  body: Partial<Record<ExtendedField, string>>
): Promise<void> {
  const pairs = EXTENDED_STRING_FIELDS
    .filter((f) => f in body)
    .map((f) => ({ field: f, value: body[f] ?? '' }))

  if (pairs.length === 0) return

  const setClauses = pairs.map((p) => `"${p.field}" = ?`).join(', ')
  const values = pairs.map((p) => p.value)

  await prisma.$executeRawUnsafe(
    `UPDATE "Settings" SET ${setClauses} WHERE id = ?`,
    ...values,
    id
  )
}

export async function GET(_req: Request) {
  try {
    let settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })

    if (!settings) {
      // Auto-create defaults on first access
      settings = await prisma.settings.create({
        data: {
          id: 'singleton',
          scrapeFrequency: '4h',
          requireReview: false,
          isLive: false,
          targetNiche: 'Indonesian property real estate',
        },
      })
      log('info', '[API] Settings singleton created with defaults')
    }

    // Restore scheduler after HMR or cold start if isLive was enabled
    if (settings.isLive && !isRunning()) {
      log('info', `[API] Restoring scheduler after server restart (frequency: ${settings.scrapeFrequency})`)
      startScheduler(settings.scrapeFrequency)
    }

    // Merge extended fields
    const extended = await readExtendedFields('singleton')

    return NextResponse.json({
      settings: { ...settings, ...extended },
      schedulerRunning: isRunning(),
      pipelineRunning: getPipelineRunning(),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext('[API /settings] GET', err)
    return createErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Partial<{
      scrapeFrequency: string
      requireReview: boolean
      isLive: boolean
      targetNiche: string
      nicheA: string
      nicheB: string
      toneA: string
      toneB: string
      rssSourcesA: string
      rssSourcesB: string
      imageCountA: number
      imageCountB: number
      seoDedupeHours: number
      seoShortTail: number
      seoEvergreen: number
    }>

    // Validate frequency if provided
    if (body.scrapeFrequency && !VALID_FREQUENCIES.includes(body.scrapeFrequency)) {
      throw new ValidationAppError([
        {
          field: 'scrapeFrequency',
          message: `Invalid frequency. Valid options: ${VALID_FREQUENCIES.join(', ')}`,
        },
      ])
    }

    // Validate targetNiche if provided
    if (body.targetNiche !== undefined && body.targetNiche.trim().length === 0) {
      throw new ValidationAppError([
        {
          field: 'targetNiche',
          message: 'Target niche cannot be empty',
        },
      ])
    }

    // Get current settings to compare isLive state
    const current = await prisma.settings.findUnique({ where: { id: 'singleton' } })
    const wasLive = current?.isLive ?? false
    const willBeLive = body.isLive !== undefined ? body.isLive : wasLive
    const newFrequency = body.scrapeFrequency ?? current?.scrapeFrequency ?? '4h'

    // Separate standard fields from extended fields
    const { nicheA, nicheB, toneA, toneB, rssSourcesA, rssSourcesB, ...standardBody } = body

    // Upsert standard fields via Prisma ORM
    const updated = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        scrapeFrequency: '4h',
        requireReview: false,
        isLive: false,
        targetNiche: 'Indonesian property real estate',
        ...standardBody,
      },
      update: standardBody,
    })

    // Persist extended fields via raw SQL
    const extendedBody: Partial<Record<ExtendedField, string>> = {}
    if (nicheA !== undefined) extendedBody.nicheA = nicheA
    if (nicheB !== undefined) extendedBody.nicheB = nicheB
    if (toneA !== undefined) extendedBody.toneA = toneA
    if (toneB !== undefined) extendedBody.toneB = toneB
    if (rssSourcesA !== undefined) extendedBody.rssSourcesA = rssSourcesA
    if (rssSourcesB !== undefined) extendedBody.rssSourcesB = rssSourcesB

    await writeExtendedFields('singleton', extendedBody)

    // Read back extended for response
    const extended = await readExtendedFields('singleton')

    // React to isLive / frequency changes
    if (!wasLive && willBeLive) {
      log('info', `[API] Settings: isLive enabled — starting scheduler (${newFrequency})`)
      startScheduler(newFrequency)
    } else if (wasLive && !willBeLive) {
      log('info', '[API] Settings: isLive disabled — stopping scheduler')
      stopScheduler()
    } else if (willBeLive && body.scrapeFrequency && body.scrapeFrequency !== current?.scrapeFrequency) {
      log('info', `[API] Settings: Frequency changed to ${newFrequency} — restarting scheduler`)
      startScheduler(newFrequency)
    }

    log('success', '[API] Settings updated successfully')
    return NextResponse.json({
      success: true,
      settings: { ...updated, ...extended },
      schedulerRunning: willBeLive && isRunning(),
      pipelineRunning: getPipelineRunning(),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logErrorWithContext('[API /settings] PUT', err)
    return createErrorResponse(err)
  }
}
