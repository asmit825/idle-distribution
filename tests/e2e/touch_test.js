// Headless Chrome mobile touch suite (SPEC-01 §10.1.3): 23 assertions over phone and tablet
// viewports, driven by raw Chrome DevTools Protocol touch events, plus desktop mouse and hotkey
// regressions. Run with `npm run test:e2e` (builds Wasm first) or `node tests/e2e/touch_test.js`.
import { devices } from '@playwright/test';
import { assert, Checklist, launchBrowser, openPage, settled, sleep, startDevServer, TouchScreen, until } from './harness.js';

const ASSERTIONS = 23;
const PORT = 4175;
const IPHONE = devices['iPhone 13'];
const IPAD = devices['iPad Pro 11 landscape'];
/** A touch drag aims this far above the finger (PointerManager's TOUCH_LIFT_PX). */
const LIFT_PX = 64;
const CANVAS = { role: 'img', name: 'Interactive 48 by 40 inch stringer pallet' };

// The run itself is at the end of the file, once every helper below is initialized.
let server, browser;
const checklist = new Checklist();
const problems = [];

/** One Mode 1 shift on a phone, from tap-picking in portrait to stacking in landscape. */
async function phoneShift() {
  const { page, touch } = await open(IPHONE, '/?mode=1&seed=42');
  const inspector = page.getByRole('region', { name: 'Active case inspector' });
  const done = page.getByRole('button', { name: 'Done', exact: true });

  await check('portrait activates the compact HUD: control deck, D-pad, and menu replace the desktop panes', async () => {
    assert(await page.evaluate(() => document.body.classList.contains('compact')), 'body is not compact');
    assert(await inspector.isVisible(), 'mobile control deck hidden');
    for (const direction of ['up', 'down', 'left', 'right']) {
      assert(await page.getByRole('button', { name: `Nudge ${direction}` }).isVisible(), `no Nudge ${direction}`);
    }
    assert(await page.getByRole('button', { name: 'Open warehouse menu' }).isVisible(), 'no menu button');
    assert(!(await page.getByRole('region', { name: 'Pallet load quality' }).isVisible()), 'desktop quality pane still visible');
  });

  await check('thumb controls are at least 48px and the page never scrolls sideways', async () => {
    for (const name of ['Rotate', 'Flip', 'Remove', 'Done', 'Nudge up', 'Nudge left', 'Nudge right', 'Nudge down']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert(box.width >= 48 && box.height >= 48, `${name} is ${box.width}×${box.height}`);
    }
    assert(await noSidewaysScroll(page), 'page scrolls horizontally');
  });

  await check('portrait stages the floor up the screen and frames all of it inside the canvas', async () => {
    const floor = await framedFloor(page);
    assert(floor.bottom - floor.top > floor.right - floor.left, `floor is ${extent(floor)}, not portrait`);
  });

  await check('a tap with finger jitter under 6px picks the carton at the deck center, not under the finger', async () => {
    const carton = await bayCarton(page, 'SKU-MQ');
    await touch.down(0, carton);
    await touch.move({ 0: { x: carton.x + 3, y: carton.y + 2 } });
    await touch.up(0);
    await until(() => inspector.textContent(), text => text.includes('HOLDING') && text.includes('Grid 9, 7'),
      text => `inspector: ${text}`);
    assert(await done.isEnabled(), 'Done is disabled');
  });

  const nudgeRight = await centerOf(page.getByRole('button', { name: 'Nudge right' }));
  const nudgeLeft = await centerOf(page.getByRole('button', { name: 'Nudge left' }));

  await check('D-pad taps move the held carton one 2″ cell the way the arrow points on screen, and back', async () => {
    const before = await heldGrid(inspector);
    await touch.tap(nudgeRight);
    const after = await until(() => heldGrid(inspector), grid => cells(before, grid) > 0, grid => `grid stayed ${grid}`);
    assert(cells(before, after) === 1, `moved from ${before} to ${after}`);
    const shift = await screenShift(page, before, after, 12);
    assert(shift.x > Math.abs(shift.y), `Nudge right moved the carton ${JSON.stringify(shift)} on screen`);
    await touch.tap(nudgeLeft);
    const back = await until(() => heldGrid(inspector), grid => cells(after, grid) > 0, grid => `grid stayed ${grid}`);
    assert(back.join() === before.join(), `right then left went ${before} → ${after} → ${back}`);
  });

  await check('holding a D-pad arrow repeats steps, and they stop on release', async () => {
    const before = await heldGrid(inspector);
    await touch.down(0, nudgeLeft);
    await sleep(650);
    await touch.up(0);
    const released = await heldGrid(inspector);
    assert(cells(before, released) >= 3, `held for 650ms but moved ${cells(before, released)} cells`);
    await sleep(300);
    const later = await heldGrid(inspector);
    assert(cells(released, later) === 0, `kept moving after release: ${released} → ${later}`);
  });

  await check('Remove returns the held carton to the floor', async () => {
    await touch.tap(await centerOf(page.getByRole('button', { name: 'Remove', exact: true })));
    await until(() => status(page), text => text === 'Medium Square went back to its bay.', text => `status: ${text}`);
    assert(await done.isDisabled(), 'Done still enabled');
  });

  // Aim at the deck's (40, 32): a 12″ square centered there lands on cell (17, 13).
  const target = await settled(() => page.evaluate(() => window.__palletTest.deckPoint(40, 32)));

  await check('a touch drag aims 64px above the finger', async () => {
    const carton = await bayCarton(page, 'SKU-MQ');
    await touch.down(0, carton);
    await touch.slide({ 0: { x: target.x - carton.x, y: target.y + LIFT_PX - carton.y } });
    await until(() => inspector.textContent(), text => text.includes('HOLDING') && text.includes('Grid 17, 13'),
      text => `inspector: ${text}`);
  });

  let rotatedYaw;
  await check('a second finger tapping mid-drag turns the held carton 90°', async () => {
    const yaw = Number((await inspector.textContent()).match(/(\d+)° yaw/)[1]);
    const canvas = await page.getByRole(CANVAS.role, { name: CANVAS.name }).boundingBox();
    await touch.down(1, { x: canvas.x + 30, y: canvas.y + 30 });
    await touch.up(1);
    rotatedYaw = (yaw + 270) % 360;
    await until(() => inspector.textContent(), text => text.includes(`${rotatedYaw}° yaw`), text => `from ${yaw}°: ${text}`);
  });

  await check('lifting the finger drops the turned carton onto the pallet where the ghost was', async () => {
    await touch.up(0);
    await until(() => status(page), text => text === 'Placed Medium Square, 12″ × 12″, at 0″. 1 case on the pallet.',
      text => `status: ${text}`);
    await touch.tap(await settled(() => page.evaluate(() => window.__palletTest.deckPoint(40, 32, 10))));
    await until(() => inspector.textContent(), text => text.includes('SELECTED') && text.includes(`${rotatedYaw}° yaw`),
      text => `selected: ${text}`);
  });

  await page.setViewportSize({ width: IPHONE.viewport.height, height: IPHONE.viewport.width });

  await check('landscape keeps the compact HUD with the control deck beside the canvas', async () => {
    const canvas = page.getByRole(CANVAS.role, { name: CANVAS.name });
    const layout = async () => ({ canvas: await canvas.boundingBox(), deck: await inspector.boundingBox() });
    await until(layout, ({ canvas, deck }) => deck.x >= canvas.x + canvas.width - 1 && deck.x > canvas.x,
      boxes => `deck is not beside the canvas: ${JSON.stringify(boxes)}`);
    assert(await page.evaluate(() => document.body.classList.contains('compact')), 'body is not compact');
    assert(await noSidewaysScroll(page), 'page scrolls horizontally');
  });

  await check('landscape re-stages the floor across the screen and reframes it inside the canvas', async () => {
    const floor = await framedFloor(page);
    assert(floor.right - floor.left > floor.bottom - floor.top, `floor is ${extent(floor)}, not landscape`);
  });

  await check('landscape touch drag-and-drop places a second carton', async () => {
    const carton = await bayCarton(page, 'SKU-MQ');
    const to = await settled(() => page.evaluate(() => window.__palletTest.deckPoint(10, 10)));
    await touchDrag(touch, carton, to);
    await until(() => status(page), text => text === 'Placed Medium Square, 12″ × 12″, at 0″. 2 cases on the pallet.',
      text => `status: ${text}`);
  });
  await page.close();
}

/** Orbit, pinch, and pan on an untouched floor, judged by where the deck's corners project. */
async function cameraGestures() {
  const { page, touch } = await open(IPHONE, '/?mode=1&seed=42');
  const start = await settled(() => deckPose(page));

  let orbited;
  await check('a one-finger swipe across empty deck orbits the camera without picking anything', async () => {
    await touch.down(0, start.center);
    await touch.slide({ 0: { x: 120, y: 0 } });
    await touch.up(0);
    orbited = await settled(() => deckPose(page));
    const turn = Math.abs(Math.atan2(Math.sin(orbited.angle - start.angle), Math.cos(orbited.angle - start.angle))) * 180 / Math.PI;
    assert(turn > 10, `deck turned ${turn.toFixed(1)}°`);
    assert(await page.getByRole('button', { name: 'Done', exact: true }).isDisabled(), 'something was picked');
  });

  let zoomed;
  await check('a two-finger pinch zooms in on the pallet', async () => {
    const [a, b] = orbited.fingers;
    const outward = { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
    await touch.down(0, a);
    await touch.down(1, b);
    await touch.slide({ 0: { x: -outward.x, y: -outward.y }, 1: outward });
    await touch.up(1);
    await touch.up(0);
    zoomed = await settled(() => deckPose(page));
    assert(zoomed.size > orbited.size * 1.15, `deck grew from ${orbited.size.toFixed(0)}px to ${zoomed.size.toFixed(0)}px`);
  });

  await check('a two-finger drag pans the view without zooming', async () => {
    const [a, b] = zoomed.fingers;
    await touch.down(0, a);
    await touch.down(1, b);
    await touch.slide({ 0: { x: 0, y: 80 }, 1: { x: 0, y: 80 } });
    await touch.up(1);
    await touch.up(0);
    const panned = await settled(() => deckPose(page));
    const shift = Math.hypot(panned.center.x - zoomed.center.x, panned.center.y - zoomed.center.y);
    assert(shift > 30, `deck center moved ${shift.toFixed(0)}px`);
    assert(Math.abs(panned.size / zoomed.size - 1) < 0.1, `deck size changed ${zoomed.size.toFixed(0)} → ${panned.size.toFixed(0)}px`);
  });
  await page.close();
}

async function tablet() {
  const { page, touch } = await open(IPAD, '/?mode=1&seed=42');

  await check('a wide tablet uses the compact HUD from its coarse pointer alone', async () => {
    assert(IPAD.viewport.width > 900 && IPAD.viewport.height > 540, 'viewport would be compact by size');
    assert(await page.evaluate(() => document.body.classList.contains('compact')), 'body is not compact');
  });

  await check('tablet touch drag-and-drop places a carton on the pallet', async () => {
    const carton = await bayCarton(page, 'SKU-MQ');
    const to = await settled(() => page.evaluate(() => window.__palletTest.deckPoint(24, 20)));
    await touchDrag(touch, carton, to);
    await until(() => status(page), text => text === 'Placed Medium Square, 12″ × 12″, at 0″. 1 case on the pallet.',
      text => `status: ${text}`);
  });
  await page.close();
}

async function modeToggling() {
  // Seed 2149's conveyor opens with Light Talls.
  const { page, touch } = await open(IPHONE, '/?mode=1&seed=2149');
  const timer = page.getByRole('timer');

  await check('tapping Mode 2 starts a conveyor run on a fresh pallet', async () => {
    await touch.tap(await centerOf(page.getByRole('button', { name: 'Mode 2 · Conveyor' })));
    await until(() => timer.getAttribute('aria-label'), label => label === 'Conveyor elapsed time', label => `timer: ${label}`);
    assert(await page.getByRole('button', { name: 'Mode 2 · Conveyor' }).getAttribute('aria-pressed') === 'true', 'Mode 2 not pressed');
    assert(await page.getByRole('button', { name: 'Ship pallet' }).isDisabled(), 'can ship an empty pallet');
  });

  await check('the oldest conveyor carton can be touch-dragged from the pick spur onto the pallet', async () => {
    // Wait for the first arrival, a 12″-deep Light Tall, to reach the end stop at the pick spur.
    await until(() => page.evaluate(() => {
      const head = window.__palletTest?.conveyorCartons()[0];
      return head ? Math.hypot(head.x - 52, head.z - 46) : Infinity;
    }), distance => distance < 0.05, distance => `head is ${distance}″ from the spur`, { timeout: 10_000 });
    const carton = await settled(() => page.evaluate(() => window.__palletTest.bayCarton('SKU-LT')));
    const to = await settled(() => page.evaluate(() => window.__palletTest.deckPoint(24, 20)));
    await touchDrag(touch, carton, to);
    await until(() => status(page), text => /^Placed Light Tall, .* at 0″\. 1 case on the pallet\.$/.test(text),
      text => `status: ${text}`);
  });

  await check('tapping Mode 1 returns to a fresh, unstarted shift', async () => {
    await touch.tap(await centerOf(page.getByRole('button', { name: 'Mode 1 · Free staging' })));
    await until(() => timer.textContent(), text => text === '1:00', text => `timer: ${text}`);
    assert(await timer.getAttribute('aria-label') === 'Shift time remaining', 'not the shift clock');
    const grade = await page.locator('.mobile-grade').textContent();
    assert(grade === 'A+ · 0 pts', `grade: ${grade}`);
  });
  await page.close();
}

async function desktop() {
  const { page } = await open({ viewport: { width: 1280, height: 800 } }, '/?mode=1&seed=42');
  const inspector = page.getByRole('region', { name: 'Active case inspector' });

  await check('desktop mouse drag-and-drop still places, with R and F working mid-drag', async () => {
    assert(!(await page.evaluate(() => document.body.classList.contains('compact'))), 'desktop is compact');
    // A Heavy Flat lying turned 90° (16″ × 24″) on the floor.
    const from = await settled(() => page.evaluate(() => window.__palletTest.bayCarton('SKU-HF', 90)));
    const to = await settled(() => page.evaluate(() => window.__palletTest.deckPoint(24, 20)));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.keyboard.press('f');
    await until(() => inspector.textContent(), text => text.includes('flipped'), text => `after F: ${text}`);
    await page.keyboard.press('f');
    await until(() => inspector.textContent(), text => !text.includes('flipped'), text => `after second F: ${text}`);
    await page.keyboard.press('r');
    await until(() => inspector.textContent(), text => / 0° yaw/.test(text), text => `after R: ${text}`);
    await page.mouse.up();
    await until(() => status(page), text => text === 'Placed Heavy Flat, 24″ × 16″, at 0″. 1 case on the pallet.',
      text => `status: ${text}`);
  });

  await check('desktop arrow and WASD keys nudge the dragged carton one cell per press', async () => {
    const from = await settled(() => page.evaluate(() => window.__palletTest.bayCarton('SKU-MQ')));
    const to = await settled(() => page.evaluate(() => window.__palletTest.deckPoint(24, 20, 8)));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    const origin = await until(() => heldGrid(inspector), grid => grid?.join() === '9,7', grid => `aimed at ${grid}`);
    const after = async key => {
      const before = await heldGrid(inspector);
      await page.keyboard.press(key);
      return until(() => heldGrid(inspector), grid => cells(before, grid) === 1, grid => `${key}: ${before} → ${grid}`);
    };
    const right = await after('ArrowRight');
    const rightward = await screenShift(page, origin, right, 12, 8);
    assert(rightward.x > Math.abs(rightward.y), `ArrowRight moved the carton ${JSON.stringify(rightward)} on screen`);
    const twice = await after('d');
    assert(twice[0] - right[0] === right[0] - origin[0] && twice[1] - right[1] === right[1] - origin[1], `D went ${right} → ${twice}`);
    const left = [await after('ArrowLeft'), await after('a')];
    assert(left[1].join() === origin.join(), `right then left went ${[origin, right, twice, ...left].join(' → ')}`);
    const up = await after('ArrowUp');
    assert(Math.abs(up[0] - origin[0]) !== Math.abs(right[0] - origin[0]), `up ${up} is parallel to right ${right}`);
    const upward = await screenShift(page, origin, up, 12, 8);
    assert(upward.y < 0, `ArrowUp moved the carton ${JSON.stringify(upward)} on screen`);
    const down = [await after('w'), await after('ArrowDown'), await after('s')];
    assert(down[2].join() === origin.join(), `up then down went ${[origin, up, ...down].join(' → ')}`);
    await page.mouse.up();
    await until(() => status(page), text => text === 'Placed Medium Square, 12″ × 12″, at 8″. 2 cases on the pallet.',
      text => `status: ${text}`);
  });
  await page.close();
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────

function check(name, run) {
  return checklist.check(name, run);
}

async function open(device, path) {
  const page = await openPage(browser, device, server.url + path, problems);
  return { page, touch: await TouchScreen.attach(page) };
}

const bayCarton = (page, skuId) => settled(() => page.evaluate(id => window.__palletTest.bayCarton(id), skuId));

/**
 * Where the deck sits on screen: its center, the length of the diagonal that runs across the iso
 * view (the other one points at the camera), the angle of its long edge, and two fingertip spots
 * on the empty deck along that diagonal.
 */
function deckPose(page) {
  return page.evaluate(() => {
    const point = (x, y) => window.__palletTest.deckPoint(x, y);
    const [origin, end, across] = [point(0, 0), point(48, 0), point(0, 40)];
    const along = t => ({ x: end.x + (across.x - end.x) * t, y: end.y + (across.y - end.y) * t });
    return {
      center: point(24, 20),
      size: Math.hypot(across.x - end.x, across.y - end.y),
      angle: Math.atan2(end.y - origin.y, end.x - origin.x),
      fingers: [along(0.3), along(0.7)],
    };
  });
}

/** The settled floor extent, asserted to lie inside the canvas. */
async function framedFloor(page) {
  const floor = await settled(() => page.evaluate(() => window.__palletTest.floorBounds()));
  const canvas = await page.getByRole(CANVAS.role, { name: CANVAS.name }).boundingBox();
  const inside = floor.left >= canvas.x - 1 && floor.right <= canvas.x + canvas.width + 1
    && floor.top >= canvas.y - 1 && floor.bottom <= canvas.y + canvas.height + 1;
  assert(inside, `floor ${extent(floor)} spills out of canvas ${JSON.stringify(canvas)}`);
  return floor;
}

const extent = ({ left, top, right, bottom }) => `${(right - left).toFixed(0)}×${(bottom - top).toFixed(0)}px`;

/** Drags with one finger so that the lifted aim point ends on `to`. */
async function touchDrag(touch, from, to) {
  await touch.down(0, from);
  await touch.slide({ 0: { x: to.x - from.x, y: to.y + LIFT_PX - from.y } });
  await sleep(50);
  await touch.up(0);
}

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The status line's text, even where the layout hides it. */
const status = page => page.locator('.placement-status').textContent();

async function heldGrid(inspector) {
  const match = (await inspector.textContent()).match(/Grid (-?\d+), (-?\d+)/);
  return match && [Number(match[1]), Number(match[2])];
}

/** How far a square case `size` inches across moves on screen between two grid aims at `elevation`. */
function screenShift(page, from, to, size, elevation = 0) {
  return page.evaluate(([from, to, half, elevation]) => {
    const [a, b] = [from, to].map(([x, y]) => window.__palletTest.deckPoint(x * 2 + half, y * 2 + half, elevation));
    return { x: b.x - a.x, y: b.y - a.y };
  }, [from, to, size / 2, elevation]);
}

/** Grid cells between two aims (Manhattan); NaN while either is unknown. */
const cells = (a, b) => (a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) : NaN);

const noSidewaysScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ── run ──────────────────────────────────────────────────────────────────────────────────

server = await startDevServer(PORT);
browser = await launchBrowser();
let ok = false;
try {
  console.log('iPhone portrait → landscape (Mode 1, seed 42)');
  await phoneShift();
  console.log('iPhone camera gestures');
  await cameraGestures();
  console.log('iPad landscape');
  await tablet();
  console.log('Mode toggling by touch');
  await modeToggling();
  console.log('Desktop regressions');
  await desktop();
  ok = checklist.report(ASSERTIONS);
  if (problems.length) {
    ok = false;
    console.log(`\nConsole was not clean:\n  ${problems.join('\n  ')}`);
  }
} finally {
  await browser.close();
  server.stop();
}
process.exit(ok ? 0 : 1);
