import { defineConfig, devices } from '@playwright/test';

const onCi = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  forbidOnly: onCi,
  // One retry at most, and only on CI. The summary of the run names each test that used it.
  retries: onCi ? 1 : 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }], ['./reporter/summary-reporter.ts']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
