import { defineConfig, devices } from '@playwright/test'
import { SMOKE } from './e2e/env'

// ROADMAP E10.01: smoke tests of the critical public and sign-in routes, in Chromium, against the
// built web app, the compiled API and a migrated database holding `e2e/fixtures.sql`, as CI runs
// them (.github/workflows/ci.yml). They start no server themselves (addresses in e2e/env.ts).
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/results',
  // One browser, tests in file order: the sign-in tests share the mailbox.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: SMOKE.web,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
