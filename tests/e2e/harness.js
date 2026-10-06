// Shared plumbing for the standalone CDP suites: a private dev server, a GPU-backed headless
// Chromium, numbered assertions, polling, and raw CDP touch input.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

/** Starts Vite on `port` with the browser-test settings (no file watching, isolated cache). */
export async function startDevServer(port) {
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, PALLET_BROWSER_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`Vite exited (${server.exitCode}):\n${output}`);
    try {
      if ((await fetch(url)).ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`Vite did not start:\n${output}`);
    await sleep(250);
  }
  return {
    url,
    stop: () => {
      try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
    },
  };
}

/**
 * Chromium's full build in new headless mode renders WebGL on the host GPU (Metal on macOS);
 * the default headless shell falls back to SwiftShader.
 */
export function launchBrowser() {
  return chromium.launch({ channel: 'chromium' });
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Polls `read` until `accept` holds, returning the last value; fails with `describe(last)`. */
export async function until(read, accept, describe, { timeout = 5_000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let value;
  for (;;) {
    value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(describe(value));
    await sleep(interval);
  }
}

/** Polls a client-space reading until two consecutive reads agree (camera damping has settled). */
export async function settled(read) {
  let previous = await read();
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(100);
    const current = await read();
    if (maxDifference(previous, current) < 0.25) return current;
    previous = current;
  }
  throw new Error(`reading never settled: ${JSON.stringify(previous)}`);
}

function maxDifference(a, b) {
  if (typeof a === 'number') return Math.abs(a - b);
  return Math.max(...Object.keys(a).map(key => maxDifference(a[key], b[key])));
}

/**
 * A page in its own emulated device context (closed with the page), logging console problems
 * into `problems`, loaded at `path` with the scene hooks ready.
 */
export async function openPage(browser, device, url, problems) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  page.on('close', () => context.close());
  watchConsole(page, problems);
  await page.goto(url);
  await until(() => page.evaluate(() => !!window.__palletTest), Boolean, () => 'scene hooks never appeared', { timeout: 30_000 });
  return page;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Runs numbered checks in order, printing each (and any note a check returns); `report` tallies them. */
export class Checklist {
  results = [];

  async check(name, run) {
    const number = this.results.length + 1;
    try {
      const note = await run();
      this.results.push({ name, ok: true });
      console.log(`  ✓ ${String(number).padStart(2)} ${name}${note ? `\n       ${note}` : ''}`);
    } catch (error) {
      this.results.push({ name, ok: false });
      console.log(`  ✗ ${String(number).padStart(2)} ${name}\n       ${String(error?.message ?? error).split('\n').join('\n       ')}`);
    }
  }

  /** Prints the tally; true when every check passed and there were `expected` of them. */
  report(expected) {
    const passed = this.results.filter(result => result.ok).length;
    console.log(`\n${passed}/${this.results.length} assertions passed`);
    if (this.results.length !== expected) console.log(`expected ${expected} assertions, ran ${this.results.length}`);
    return passed === expected && this.results.length === expected;
  }
}

/** Console errors, warnings, and uncaught exceptions on a page. */
export function watchConsole(page, problems) {
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
}

/**
 * Multi-touch input through `Input.dispatchTouchEvent`. CDP diffs each event's touch list
 * against the previous one, so every call sends all fingers still down; lifting one finger of
 * several is a move that leaves it out, since `touchEnd` lifts them all.
 */
export class TouchScreen {
  #fingers = new Map();
  #cdp;

  constructor(cdp) {
    this.#cdp = cdp;
  }

  static async attach(page) {
    return new TouchScreen(await page.context().newCDPSession(page));
  }

  #send(type) {
    const touchPoints = [...this.#fingers].map(([id, { x, y }]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 }));
    return this.#cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }

  async down(id, point) {
    this.#fingers.set(id, point);
    await this.#send('touchStart');
  }

  async move(moves) {
    for (const [id, point] of Object.entries(moves)) this.#fingers.set(Number(id), point);
    await this.#send('touchMove');
  }

  async up(id) {
    this.#fingers.delete(id);
    await this.#send(this.#fingers.size ? 'touchMove' : 'touchEnd');
  }

  /** Slides fingers from their current points by `delta` each, over `steps` frames. */
  async slide(deltas, steps = 12) {
    const starts = Object.fromEntries(Object.keys(deltas).map(id => [id, this.#fingers.get(Number(id))]));
    for (let step = 1; step <= steps; step++) {
      await this.move(Object.fromEntries(Object.entries(deltas).map(([id, { x, y }]) =>
        [id, { x: starts[id].x + x * step / steps, y: starts[id].y + y * step / steps }])));
      await sleep(16);
    }
  }

  async tap(point) {
    await this.down(0, point);
    await sleep(50);
    await this.up(0);
  }
}
