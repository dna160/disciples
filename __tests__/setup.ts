/**
 * Jest Global Setup
 * Runs after the test framework is installed but before tests execute.
 * Sets environment variables and mocks that must be in place for every test file.
 */

// ── Environment Variables ────────────────────────────────────────────────────

// Point Prisma at an isolated test database so tests never touch production data
process.env.DATABASE_URL = 'file:./data/test.db'

// Provide a dummy key so imports of the Anthropic SDK don't throw at initialisation
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-00000000000000000000000000000000'

// Mock WordPress endpoint – tests that call the WP API will hit this
process.env.WP_URL = 'http://localhost:3000/api/mock-wordpress'
process.env.WP_USERNAME = 'admin'
process.env.WP_APP_PASSWORD = 'mock_password'

// Ensure we are always in test mode (cast needed — Jest sets this anyway)
;(process.env as Record<string, string>).NODE_ENV = 'test'

// ── node-cron mock ───────────────────────────────────────────────────────────
// Prevent actual cron jobs from being scheduled during tests.
// Any file that calls `cron.schedule(...)` will receive a no-op scheduler.
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
  }),
  validate: jest.fn().mockReturnValue(true),
}))

// ── Global test utilities ────────────────────────────────────────────────────

// Silence console output during tests unless the CI env flag is set.
// Remove this block if you want verbose output while debugging.
if (!process.env.VERBOSE_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    // Keep warn and error so test failures are visible
    warn: console.warn,
    error: console.error,
  }
}
