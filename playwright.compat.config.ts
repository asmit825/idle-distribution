import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/** Edge runs only where it is installed; `npx playwright install msedge` adds it. */
const EDGE_PATHS = [
  '/Applications/Microsoft Edge.app',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/opt/microsoft/msedge/msedge',
];

export default defineConfig({
  testDir: './tests/compat',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4177' },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit (Safari)', use: devices['Desktop Safari'] },
    ...EDGE_PATHS.some(path => existsSync(path)) ? [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }] : [],
  ],
  webServer: {
    command: 'npm run dev -- --port 4177 --strictPort',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
    stdout: 'pipe',
    env: { PALLET_BROWSER_TEST: '1' },
    timeout: 120_000,
  },
});
