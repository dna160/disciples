import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const DATA_DIR = path.join(process.cwd(), 'data')
const DEDUP_FILE = path.join(DATA_DIR, 'seen-urls.json')

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readStore(): Record<string, boolean> {
  ensureDataDir()
  try {
    if (!fs.existsSync(DEDUP_FILE)) {
      return {}
    }
    const raw = fs.readFileSync(DEDUP_FILE, 'utf-8')
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    // If the file is corrupted or unreadable, start fresh
    return {}
  }
}

function writeStore(store: Record<string, boolean>): void {
  ensureDataDir()
  fs.writeFileSync(DEDUP_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex')
}

export async function hasBeenSeen(url: string): Promise<boolean> {
  try {
    const hash = hashUrl(url)
    const store = readStore()
    return store[hash] === true
  } catch (err) {
    // On any unexpected error, treat as unseen to avoid blocking pipeline
    console.error('[dedup] Error checking seen status:', err)
    return false
  }
}

export async function markAsSeen(url: string): Promise<void> {
  try {
    const hash = hashUrl(url)
    const store = readStore()
    store[hash] = true
    writeStore(store)
  } catch (err) {
    console.error('[dedup] Error marking URL as seen:', err)
  }
}

export async function clearStore(): Promise<void> {
  try {
    ensureDataDir()
    writeStore({})
  } catch (err) {
    console.error('[dedup] Error clearing store:', err)
  }
}
