import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // Software WebGL is CPU-heavy; parallel scenes introduce wall-clock drift in timed gestures.
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { args: ['--enable-unsafe-swiftshader'] } },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    stdout: 'pipe',
    env: { PALLET_BROWSER_TEST: '1' },
    timeout: 120_000,
  },
});
