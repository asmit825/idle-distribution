import { expect, test, type Page } from '@playwright/test';

test('switches to Dock Survival, signals saturation, diverts five cases, and stops', async ({ page }) => {
  // Observe the real browser audio boundary; the game still creates and starts actual nodes.
  await page.addInitScript(() => {
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when = 0) {
      Reflect.set(window, 'conveyorTestToneStarts', (Reflect.get(window, 'conveyorTestToneStarts') ?? 0) + 1);
      start.call(this, when);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.clock.install();
  await page.goto('/?mode=1&seed=2149');
  await page.getByRole('button', { name: 'Mode 2 · Conveyor' }).click();
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0');
  const sound = page.getByRole('button', { name: /conveyor sound/ });
  await expect(sound).toBeVisible();
  if (await sound.getAttribute('aria-pressed') !== 'true') await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeDisabled();
  // Cartons wrap the pick lane first (eight fit); only those beyond it are on the recirculation lane.
  await page.clock.fastForward(31_500);
  await expect(page.getByLabel('Conveyor queue')).toHaveText('9');
  await expect(page.getByLabel('Recirculation lane')).toHaveText('1 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Normal');
  await page.clock.fastForward(10_500);
  await expect(page.getByLabel('Recirculation lane')).toHaveText('4 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Normal');
  await page.clock.fastForward(3_500);
  await expect(page.getByLabel('Recirculation lane')).toHaveText('5 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Recirculation filling');
  await expect(page.getByLabel('Overflow countdown')).toHaveCount(0);
  await page.clock.fastForward(14_000);
  await expect(page.getByLabel('Recirculation lane')).toHaveText('9 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Recirculation filling');
  await page.clock.fastForward(3_500);
  await expect(page.getByLabel('Recirculation lane')).toHaveText('10 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Recirculation full');
  await expect(page.getByLabel('Overflow countdown')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'conveyorTestToneStarts') ?? 0)).toBeGreaterThan(0);
  const saturationTones = await page.evaluate(() => Reflect.get(window, 'conveyorTestToneStarts'));
  await page.clock.fastForward(3_500);
  await expect(page.getByLabel('Recirculation lane')).toHaveText('10 / 10');
  await expect(page.getByLabel('Diversions')).toHaveText('1 / 5');
  const { from, to } = await settledPickPoints(page, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('.placement-status')).toHaveText('Holding Light Tall.');
  await page.clock.fastForward(14_000);
  const result = page.getByRole('dialog', { name: 'Warehouse Estop' });
  await expect(result).toBeVisible();
  await expect(page.locator('.placement-status')).toHaveText('Light Tall went back to its bay.');
  await page.mouse.up();
  await expect(page.getByLabel('Diversions')).toHaveText('5 / 5');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'conveyorTestToneStarts'))).toBeGreaterThan(saturationTones);
  const frozen = await page.getByRole('timer').textContent();
  await page.clock.fastForward(60_000);
  await expect(page.getByRole('timer')).toHaveText(frozen!);
  await result.getByRole('button', { name: 'New conveyor run' }).click();
  await expect(result).toBeHidden();
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0');
  await page.getByRole('button', { name: 'Mode 1 · Free staging' }).click();
  await expect(page.locator('.viewport-label p')).toHaveText('Wave 1 · 25 cases on the floor');
  await expect(page.getByRole('timer')).toHaveText('1:00');
  expect(errors).toEqual([]);
});

test('picks any carton on the final run, not just the oldest', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=2&seed=42'); // a Heavy Flat, then a Light Tall
  await expect.poll(() => page.evaluate(() => !!window.__palletTest)).toBe(true);
  await page.clock.runFor(150);
  await page.clock.fastForward(7_500);
  await expect(page.getByLabel('Conveyor queue')).toHaveText('2');
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  // The Light Tall, second in line, settles nose to tail behind the 16″-deep Heavy Flat.
  await expect.poll(() => page.evaluate(() => {
    const second = window.__palletTest!.conveyorCartons()[1];
    return second ? Math.hypot(second.x - 52, second.z - 30) : Infinity;
  })).toBeLessThan(0.05);
  await page.waitForTimeout(1_000); // camera easing
  const from = await page.evaluate(() => window.__palletTest!.bayCarton('SKU-LT'));
  const to = await page.evaluate(() => window.__palletTest!.deckPoint(24, 20));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(page.locator('.placement-status')).toHaveText('Holding Light Tall.');
  await page.mouse.up();
  await expect(page.locator('.placement-status')).toHaveText(/^Placed Light Tall, .* 1 case on the pallet\.$/);
  // The Light Tall left the line ahead of the Heavy Flat, which is still there to pick.
  const onLine = await page.evaluate(() => Object.keys(window.__palletTest!.conveyorCartons()).map(Number));
  expect(onLine).toContain(0);
  expect(onLine).not.toContain(1);
  await page.evaluate(() => window.__palletTest!.bayCarton('SKU-HF'));
  expect(errors).toEqual([]);
});

test('keeps a drag through new arrivals and ships a 60-inch pallet, which a hauler replaces', async ({ page }) => {
  // The haul plays ~8 s of clock time frame by frame, and SwiftShader renders the whole warehouse each frame.
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=2&seed=2149');
  const soundButton = page.getByRole('button', { name: /conveyor sound/ });
  await expect(soundButton).toHaveAttribute('aria-pressed', 'false');
  await soundButton.click();
  await expect(soundButton).toHaveAttribute('aria-pressed', 'true');
  await soundButton.click();
  await expect(soundButton).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => !!window.__palletTest)).toBe(true);
  await page.clock.runFor(150); // Let the mounted game loop schedule its first tick.
  await page.clock.fastForward(14_000); // Four known 15-inch Light Tall cases.
  await expect(page.getByLabel('Conveyor queue')).toHaveText(/^[4-5]$/);
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  for (let layer = 0; layer < 4; layer++) {
    const { from, to } = await settledPickPoints(page, layer * 15);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(page.locator('.placement-status')).toHaveText('Holding Light Tall.');
    if (layer === 0) {
      await page.clock.fastForward(3_500);
      await expect(page.locator('.placement-status')).toHaveText('Holding Light Tall.');
    }
    await page.mouse.up();
    await expect(page.locator('.placement-status')).toHaveText(new RegExp(`Placed Light Tall, .* at ${layer * 15}″\\. ${layer + 1} case`));
    await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeEnabled(); // any moment, once a case is down
  }
  await expect(page.getByLabel('Arrival interval')).toHaveText('2.0s / case');
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  // The shipped pallet is hauled away rather than held in a dialog; the line freezes meanwhile.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Line status')).toHaveText('Shipped');
  const stoppedCartons = await page.evaluate(() => window.__palletTest!.conveyorCartons());
  await page.clock.runFor(1_000);
  expect(await page.evaluate(() => window.__palletTest!.conveyorCartons())).toEqual(stoppedCartons);
  await page.clock.runFor(7_000);
  // Then a new pallet is delivered and a fresh run begins.
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0');
  await expect(page.getByText(/Last pallet shipped: .* pts/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeDisabled();
  expect(errors).toEqual([]);
});


test('conveyor speed follows the chosen difficulty', async ({ page }) => {
  await page.goto('/?mode=2&seed=2149');
  const interval = page.getByLabel('Arrival interval');
  const level = (name: string) => page.getByRole('group', { name: 'Conveyor speed' }).getByRole('button', { name });
  await expect(interval).toHaveText('3.5s / case');
  await level('easy').click();
  await expect(interval).toHaveText('5.3s / case');
  await level('hard').click();
  await expect(interval).toHaveText('2.2s / case');
  await level('medium').click();
  await expect(interval).toHaveText('3.5s / case');
});

test('a partial pallet ships at any moment and reports how full it was', async ({ page }) => {
  // The haul plays ~8 s of clock time frame by frame, and SwiftShader renders the whole warehouse each frame.
  test.slow();
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?mode=2&seed=2149');
  await expect.poll(() => page.evaluate(() => !!window.__palletTest)).toBe(true);
  await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeDisabled();
  await page.clock.runFor(150);
  await page.clock.fastForward(14_000);
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  for (let layer = 0; layer < 2; layer++) {
    const { from, to } = await settledPickPoints(page, layer * 15);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.placement-status')).toHaveText(new RegExp(`Placed Light Tall, .* at ${layer * 15}″\\. ${layer + 1} case`));
  }
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  await page.clock.runFor(8_000);
  await expect(page.getByText(/Last pallet shipped: .*\(50% full\)/)).toBeVisible();
});

/** Wait for the camera's height tracking and orbit damping before sending real pointer events. */
async function settledPickPoints(page: Page, elevation: number) {
  // Seed 2149 starts with four Light Talls. Let the oldest physically reach the end stop.
  await expect.poll(() => page.evaluate(id => {
    const position = window.__palletTest!.conveyorCartons()[id];
    return position ? Math.hypot(position.x - 52, position.z - 46) : Infinity; // 12″ deep, against the end stop
  }, elevation / 15)).toBeLessThan(0.05);
  const project = () => page.evaluate(height => ({
    from: window.__palletTest!.bayCarton('SKU-LT'),
    to: window.__palletTest!.deckPoint(24, 20, height),
  }), elevation);
  let previous = await project();
  await page.waitForTimeout(100);
  await expect.poll(async () => {
    const next = await project();
    const movement = Math.max(Math.hypot(next.from.x - previous.from.x, next.from.y - previous.from.y), Math.hypot(next.to.x - previous.to.x, next.to.y - previous.to.y));
    previous = next;
    return movement;
  }, { intervals: [100, 100, 100], timeout: 4_000 }).toBeLessThan(0.2);
  return previous;
}
