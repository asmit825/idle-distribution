// Frame-rate profile (SPEC-01 §10.2): a Mode 1 shift keeps all 100 cartons in the scene (a
// seeded floor cannot fit on one pallet), with a layer of 12 stacked on the pallet. Frame cadence is
// sampled at rest and while a carton is dragged over the stack, revalidating every move.
// Needs a hardware GPU: run with `npm run test:perf` on a machine with one.
import { devices } from '@playwright/test';
import { assert, Checklist, launchBrowser, openPage, settled, sleep, startDevServer, until } from './harness.js';

const PORT = 4176;
/** 60 FPS within normal vsync jitter. */
const MIN_FPS = 58;
/** One layer of Medium Squares, 4 × 3 across the deck. */
const LAYER = [[6, 6], [18, 6], [30, 6], [42, 6], [6, 18], [18, 18], [30, 18], [42, 18], [6, 30], [18, 30], [30, 30], [42, 30]];
/** A frame slower than this is a visible hitch (a skipped 60 Hz vsync). */
const HITCH_MS = 25;
const MAX_HITCH_SHARE = 0.02;
const SAMPLE_FRAMES = 240;
const DEVICES = [
  { label: 'Desktop 1440×900 @2x', device: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { label: 'iPhone 13 viewport (emulated on this GPU)', device: devices['iPhone 13'] },
];

let server, browser;
const checklist = new Checklist();
const problems = [];

async function profile({ label, device }) {
  const page = await openPage(browser, device, `${server.url}/?seed=42`, problems);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
  });
  console.log(`${label} — ${gpu}`);
  assert(!/swiftshader|llvmpipe|software/i.test(gpu), `software renderer (${gpu}); run on a machine with a GPU`);

  // Stack the layer with real drags; every carton stays in the scene, on the floor or the pallet.
  for (const [x, y] of LAYER) {
    const to = await settled(() => page.evaluate(([x, y]) => window.__palletTest.deckPoint(x, y), [x, y]));
    await drag(page, 'SKU-MQ', [to]);
    await page.mouse.up();
    await until(status(page), text => text.startsWith('Placed Medium Square'), text => `drop at ${x}, ${y}: ${text}`);
  }
  const load = `${LAYER.length} cartons stacked on the pallet, ${100 - LAYER.length} on the floor`;
  const running = async () => (await page.getByRole('timer').textContent()) !== '0:00';

  await check(`${label}: holds 60 FPS at rest with 100 cartons in the scene`, async () => {
    const summary = report(await sampleFrames(page, () => sleep(50)));
    assert(await running(), 'the shift ended while sampling');
    return `${summary}; ${load}`;
  });

  await check(`${label}: holds 60 FPS while dragging a carton over the stack`, async () => {
    const corners = await page.evaluate(() => [[2, 2], [46, 2], [46, 38], [2, 38]].map(([x, y]) => window.__palletTest.deckPoint(x, y, 10)));
    await drag(page, 'SKU-HF', corners.slice(0, 1));
    let corner = 1;
    const sample = await sampleFrames(page, () => {
      const to = corners[corner++ % corners.length];
      return page.mouse.move(to.x, to.y, { steps: 20 });
    });
    // Still holding: every move above revalidated the ghost against the stack.
    const holding = await status(page)();
    await page.mouse.up();
    assert(holding === 'Holding Heavy Flat.', `not dragging while sampling: ${holding}`);
    assert(await running(), 'the shift ended while sampling');
    return report(sample);
  });
  await page.close();
}

/** Presses a floor carton and drags it through `points`, asserting it was picked; the button stays down. */
async function drag(page, skuId, points) {
  const from = await settled(() => page.evaluate(id => window.__palletTest.bayCarton(id), skuId));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Lift clear of the 6px tap threshold first: a carton can project right next to its target.
  await page.mouse.move(from.x, from.y - 24, { steps: 4 });
  for (const to of points) await page.mouse.move(to.x, to.y, { steps: 8 });
  await until(status(page), text => text.startsWith('Holding'), text => `pick of ${skuId}: ${text}`);
}

const status = page => () => page.locator('.placement-status').textContent();

/**
 * Records `SAMPLE_FRAMES` animation frames while `drive` runs repeatedly. A blank page is timed
 * first: on battery or in Low Power Mode, macOS can cap every page's frame clock at 30 Hz, and
 * that says nothing about the game.
 */
async function sampleFrames(page, drive) {
  const blank = await page.context().newPage();
  const hostFps = await blank.evaluate(async () => {
    const times = [];
    await new Promise(done => {
      const record = time => (times.push(time) < 61 ? requestAnimationFrame(record) : done());
      requestAnimationFrame(record);
    });
    return 60_000 / (times.at(-1) - times[0]);
  });
  await blank.close();
  // The probe tab hid the game for a moment; let it come back to full speed before sampling.
  await page.bringToFront();
  await sleep(500);
  assert(hostFps >= MIN_FPS, `the host caps every page at ${hostFps.toFixed(0)} FPS (on battery or in Low Power Mode?); plug in and rerun`);

  await page.evaluate(count => {
    window.__frames = [];
    const record = time => {
      window.__frames.push(time);
      if (window.__frames.length <= count) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  }, SAMPLE_FRAMES);
  while (await page.evaluate(count => window.__frames.length <= count, SAMPLE_FRAMES)) await drive();
  const times = await page.evaluate(() => window.__frames);
  const intervals = times.slice(1).map((time, i) => time - times[i]);
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    fps: 1000 * intervals.length / (times.at(-1) - times[0]),
    p95: sorted[Math.floor(sorted.length * 0.95)],
    worst: sorted.at(-1),
    hitches: intervals.filter(interval => interval > HITCH_MS).length / intervals.length,
  };
}

/** The sample's summary, asserted to meet the 60 FPS budget. */
function report({ fps, p95, worst, hitches }) {
  const summary = `${fps.toFixed(1)} FPS, p95 ${p95.toFixed(1)} ms, worst ${worst.toFixed(1)} ms, ${(hitches * 100).toFixed(1)}% over ${HITCH_MS} ms`;
  assert(fps >= MIN_FPS && hitches <= MAX_HITCH_SHARE, summary);
  return summary;
}

function check(name, run) {
  return checklist.check(name, run);
}

server = await startDevServer(PORT);
browser = await launchBrowser();
let ok = false;
try {
  for (const scenario of DEVICES) await profile(scenario);
  ok = checklist.report(DEVICES.length * 2);
  if (problems.length) {
    ok = false;
    console.log(`\nConsole was not clean:\n  ${problems.join('\n  ')}`);
  }
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
