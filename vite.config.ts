import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  // Browser tests use a fixed build; cloud-sync file events must not reload mid-gesture.
  server: process.env.PALLET_BROWSER_TEST === '1' ? { watch: null } : undefined,
  // The Playwright server and an open dev preview must not rewrite each other's dependency cache.
  cacheDir: process.env.PALLET_BROWSER_TEST === '1' ? 'node_modules/.vite-browser-tests' : 'node_modules/.vite',
});
