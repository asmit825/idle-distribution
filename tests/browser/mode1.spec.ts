import { expect, test, type Page } from '@playwright/test';

const bayCarton = (page: Page, skuId: string) => page.evaluate(id => window.__palletTest!.bayCarton(id), skuId);

/** A deck point's client position once the camera has finished easing toward the stack height. */
async function deckPoint(page: Page, x: number, y: number, elevation = 0) {
  const project = () => page.evaluate(([x, y, elevation]) => window.__palletTest!.deckPoint(x, y, elevation), [x, y, elevation]);
  let previous = await project();
  for (;;) {
    await page.waitForTimeout(100);
    const current = await project();
    if (Math.hypot(current.x - previous.x, current.y - previous.y) < 0.25) return current;
    previous = current;
  }
}

/** Presses a floor carton and drags it to `to`; releases unless `hold`. */
async function drag(page: Page, skuId: string, to: { x: number; y: number }, { hold = false } = {}) {
  const from = await bayCarton(page, skuId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (!hold) await page.mouse.up();
}

async function open(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Fake timers drive `performance.now()` and animation frames, so the test can jump the shift clock.
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?mode=1&seed=42');
  await expect.poll(() => page.evaluate(() => !!window.__palletTest)).toBe(true);
}

test('runs a 60-second shift from the first pick, letting heavy crush light, and ends it at 0:00 mid-drag', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const timer = page.getByRole('timer', { name: 'Shift time remaining' });
  const status = page.locator('.placement-status');
  const label = page.locator('.viewport-label p');
  await expect(timer).toHaveText('1:00');
  await expect(label).toHaveText('Wave 1 · 25 cases on the floor');

  // Inspecting the floor costs nothing: the clock waits for the first pick.
  await page.clock.fastForward(20_000);
  await page.waitForTimeout(100);
  await expect(timer).toHaveText('1:00');

  await drag(page, 'SKU-LT', await deckPoint(page, 24, 20));
  await expect(status).toHaveText(/^Placed Light Tall, .* at 0″\. 1 case on the pallet\.$/);
  await expect(label).toHaveText('Wave 1 · 24 cases on the floor');
  await page.clock.fastForward(5_000);
  await expect(timer).toHaveText(/^0:5[45]$/);

  // A Heavy Cube may go on the Light Tall's top; it lands, crushing the Light Tall.
  await drag(page, 'SKU-HC', await deckPoint(page, 24, 20, 15));
  await expect(status).toHaveText(/^Placed Heavy Cube, .* at 15″\. 2 cases on the pallet\.$/);
  await expect(label).toHaveText('Wave 1 · 23 cases on the floor');

  // Time runs out while a case is held: the drag is cancelled and the shift is scored.
  await drag(page, 'SKU-MQ', await deckPoint(page, 10, 10), { hold: true });
  await expect(status).toHaveText('Holding Medium Square.');
  await page.clock.fastForward(60_000);
  await expect(timer).toHaveText('0:00');
  await expect(status).toHaveText('Medium Square went back to its bay.');
  await page.mouse.up();
  const result = page.getByRole('dialog', { name: 'Shift over' });
  await expect(result).toBeVisible();
  await expect(result.locator('.f3-table-row', { hasText: 'Cases stacked' }).locator('dd')).toHaveText(/^2 cartons \(/);
  await expect(result).toContainText('1 case collapsed');
  await expect(page.getByRole('button', { name: 'Ship pallet' })).toBeDisabled();

  // The floor is closed.
  const closed = await bayCarton(page, 'SKU-FS');
  await page.mouse.move(closed.x, closed.y);
  await page.mouse.down();
  await page.mouse.move(closed.x + 60, closed.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(label).toHaveText('Wave 1 · 23 cases on the floor');

  // A new shift stages a fresh floor, its clock waiting again.
  await result.getByRole('button', { name: 'New shift' }).click();
  await expect(result).toBeHidden();
  await expect(timer).toHaveText('1:00');
  await expect(label).toHaveText('Wave 1 · 25 cases on the floor');
  expect(errors).toEqual([]);
});

test('ships the pallet early with its score', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await drag(page, 'SKU-MQ', await deckPoint(page, 24, 20));
  await expect(page.locator('.placement-status')).toHaveText(/^Placed Medium Square/);
  await page.clock.fastForward(10_000);
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  const result = page.getByRole('dialog', { name: 'Pallet shipped' });
  await expect(result).toBeVisible();
  const timer = page.getByRole('timer', { name: 'Shift time remaining' });
  const frozen = await timer.textContent();
  expect(frozen).toMatch(/^0:(49|50)$/);
  await page.clock.fastForward(30_000);
  await expect(timer).toHaveText(frozen!);
  await expect(result.locator('.final-score')).toHaveText(/^[\d,]+$/);
  await expect(result.locator('.f3-table-row', { hasText: 'Early finish bonus' }).locator('dd')).toHaveText('+0 pts');
  expect(errors).toEqual([]);
});
