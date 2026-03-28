import { EventEmitter } from 'events'

// Next.js creates separate module bundles per route, so module-level singletons
// are NOT shared across routes. Storing on `global` ensures one instance per process.
declare global {
  // eslint-disable-next-line no-var
  var __pantheonLogEmitter: EventEmitter | undefined
}

if (!global.__pantheonLogEmitter) {
  global.__pantheonLogEmitter = new EventEmitter()
  global.__pantheonLogEmitter.setMaxListeners(50)
}

export const logEmitter: EventEmitter = global.__pantheonLogEmitter

export type LogLevel = 'info' | 'success' | 'error' | 'warn'

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
}

export function log(level: LogLevel, message: string): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  }
  logEmitter.emit('log', entry)
  console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`)
}
