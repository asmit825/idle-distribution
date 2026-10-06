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
  await page.goto('/?seed=2149');
  await page.getByRole('button', { name: 'Mode 2 · Conveyor' }).click();
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0 / 10');
  const sound = page.getByRole('button', { name: /conveyor sound/ });
  await expect(sound).toBeVisible();
  if (await sound.getAttribute('aria-pressed') !== 'true') await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeDisabled();
  await page.clock.fastForward(21_000);
  await expect(page.getByLabel('Conveyor queue')).toHaveText('6 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Bottleneck');
  await page.clock.fastForward(10_500);
  await expect(page.getByLabel('Conveyor queue')).toHaveText('9 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Saturated');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'conveyorTestToneStarts') ?? 0)).toBeGreaterThan(0);
  const saturationTones = await page.evaluate(() => Reflect.get(window, 'conveyorTestToneStarts'));
  await page.clock.fastForward(7_000);
  await expect(page.getByLabel('Conveyor queue')).toHaveText('10 / 10');
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
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0 / 10');
  await page.getByRole('button', { name: 'Mode 1 · Free staging' }).click();
  await expect(page.locator('.viewport-label p')).toHaveText('100 cases on the floor');
  await expect(page.getByRole('timer')).toHaveText('1:00');
  expect(errors).toEqual([]);
});

test('keeps a drag through new arrivals and ships a 60-inch pallet with a frozen result', async ({ page }) => {
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
  await expect(page.getByLabel('Conveyor queue')).toHaveText(/^[4-5] \/ 10$/);
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
    if (layer < 3) await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeDisabled();
  }
  await expect(page.getByLabel('Arrival interval')).toHaveText('2.0s / case');
  const inTransit = await page.evaluate(() => Math.max(...Object.keys(window.__palletTest!.conveyorCartons()).map(Number)));
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  const result = page.getByRole('dialog', { name: 'Pallet shipped' });
  await expect(result).toBeVisible();
  await expect(result.locator('dd').nth(1)).toHaveText('4');
  await expect.poll(() => page.evaluate(id => !!window.__palletTest!.conveyorCartons()[id], inTransit)).toBe(true);
  const stoppedCartons = await page.evaluate(() => window.__palletTest!.conveyorCartons());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__palletTest!.conveyorCartons())).toEqual(stoppedCartons);
  const frozen = await result.textContent();
  await page.clock.fastForward(60_000);
  await expect(result).toHaveText(frozen!);
  expect(errors).toEqual([]);
});


/** Wait for the camera's height tracking and orbit damping before sending real pointer events. */
async function settledPickPoints(page: Page, elevation: number) {
  // Seed 2149 starts with four Light Talls. Let this FIFO head physically reach the pick spur.
  await expect.poll(() => page.evaluate(id => {
    const position = window.__palletTest!.conveyorCartons()[id];
    return position ? Math.hypot(position.x - 52, position.z - 40) : Infinity;
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
