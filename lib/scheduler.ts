import cron from 'node-cron'
import { runPipelineCycle } from './pipeline'
import { log } from './logger'

const CRON_MAP: Record<string, string> = {
  '10s': '*/10 * * * * *',
  '1h': '0 * * * *',
  '4h': '0 */4 * * *',
  '12h': '0 */12 * * *',
  '24h': '0 0 * * *',
}

let scheduledTask: cron.ScheduledTask | null = null
let currentFrequency: string | null = null

/**
 * Start (or restart) the cron scheduler with the given frequency string.
 * Stops any existing job before starting a new one.
 */
export function startScheduler(frequency: string): void {
  // Stop any existing job first
  stopScheduler()

  const cronExpression = CRON_MAP[frequency]
  if (!cronExpression) {
    log('error', `[SCHEDULER] Unknown frequency "${frequency}". Valid: 1h, 4h, 12h, 24h`)
    return
  }

  log('info', `[SCHEDULER] Starting scheduler — frequency: ${frequency} (cron: ${cronExpression})`)

  scheduledTask = cron.schedule(cronExpression, async () => {
    log('info', '[SCHEDULER] Cron trigger fired — starting pipeline cycle...')
    try {
      const cycleId = await runPipelineCycle()
      log('success', `[SCHEDULER] Cron-triggered cycle completed: ${cycleId}`)
    } catch (err) {
      log('error', `[SCHEDULER] Cron-triggered cycle failed: ${err}`)
    }
  })

  currentFrequency = frequency
  log('success', `[SCHEDULER] Scheduler active — next run at cron schedule: ${cronExpression}`)
}

/**
 * Stop the active cron job if one is running.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask = null
    log('info', `[SCHEDULER] Scheduler stopped (was: ${currentFrequency})`)
    currentFrequency = null
  }
}

/**
 * Returns true if the scheduler has an active cron job.
 */
export function isRunning(): boolean {
  return scheduledTask !== null
}

/**
 * Returns the current frequency string or null if not running.
 */
export function getCurrentFrequency(): string | null {
  return currentFrequency
}
