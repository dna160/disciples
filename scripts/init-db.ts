/**
 * Database initialization script.
 * Run with: npx ts-node scripts/init-db.ts
 *
 * - Creates the data/ directory if missing
 * - Ensures the Settings singleton row exists with defaults
 */

import * as path from 'path'
import * as fs from 'fs'
import { PrismaClient } from '@prisma/client'

const DATA_DIR = path.join(process.cwd(), 'data')
const SEEN_URLS_FILE = path.join(DATA_DIR, 'seen-urls.json')

async function main() {
  console.log('=== Pantheon Newsroom — DB Init ===\n')

  // 1. Ensure data/ directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    console.log(`[init] Created directory: ${DATA_DIR}`)
  } else {
    console.log(`[init] data/ directory already exists: ${DATA_DIR}`)
  }

  // 2. Ensure seen-urls.json exists
  if (!fs.existsSync(SEEN_URLS_FILE)) {
    fs.writeFileSync(SEEN_URLS_FILE, JSON.stringify({}, null, 2), 'utf-8')
    console.log(`[init] Created dedup store: ${SEEN_URLS_FILE}`)
  } else {
    console.log(`[init] Dedup store already exists: ${SEEN_URLS_FILE}`)
  }

  // 3. Initialize Prisma and upsert Settings singleton
  const prisma = new PrismaClient()

  try {
    const existing = await prisma.settings.findUnique({ where: { id: 'singleton' } })

    if (!existing) {
      const created = await prisma.settings.create({
        data: {
          id: 'singleton',
          scrapeFrequency: '4h',
          requireReview: false,
          isLive: false,
          targetNiche: 'Indonesian property real estate',
        },
      })
      console.log(`[init] Created Settings singleton:`, created)
    } else {
      console.log(`[init] Settings singleton already exists:`, existing)
    }

    console.log('\n[init] Database initialization complete.')
    console.log('[init] You can now run: npm run dev')
  } catch (err) {
    console.error('[init] Failed to initialize database:', err)
    console.error(
      '[init] Ensure you have run "npx prisma db push" first to create the database schema.'
    )
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('[init] Unhandled error:', err)
  process.exit(1)
})
