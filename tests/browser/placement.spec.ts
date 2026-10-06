import { expect, test, type Page } from '@playwright/test';

/** Client coordinates from the development-only scene hooks. */
const bayCarton = (page: Page, skuId: string) => page.evaluate(id => window.__palletTest!.bayCarton(id), skuId);
const projectDeckPoint = (page: Page, x: number, y: number, elevation: number) =>
  page.evaluate(([x, y, elevation]) => window.__palletTest!.deckPoint(x, y, elevation), [x, y, elevation]);

/** A deck point's client position once the camera has finished easing toward the stack height. */
async function deckPoint(page: Page, x: number, y: number, elevation = 0) {
  let previous = await projectDeckPoint(page, x, y, elevation);
  for (;;) {
    await page.waitForTimeout(100);
    const current = await projectDeckPoint(page, x, y, elevation);
    if (Math.hypot(current.x - previous.x, current.y - previous.y) < 0.25) return current;
    previous = current;
  }
}

/** Presses on a floor carton and drags it to `to`, running `during` before release. */
async function drag(page: Page, skuId: string, to: { x: number; y: number }, during?: () => Promise<void>) {
  const from = await bayCarton(page, skuId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await during?.();
  await page.mouse.up();
}

test('drags floor cartons onto the pallet with a mouse, rotating, stacking, and returning rejected drops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__palletTest)).toBe(true);
  const status = page.locator('.placement-status');
  const rotate = page.getByRole('button', { name: /Rotate/ });
  await expect(rotate).toBeDisabled();

  // Heavy Flat waits on the floor turned 90° (16" × 24"); R turns it to 24" × 16" mid-drag.
  await drag(page, 'SKU-HF', await deckPoint(page, 24, 20), async () => {
    await expect(status).toHaveText('Holding Heavy Flat.');
    await expect(rotate).toBeEnabled();
    await page.keyboard.press('r');
  });
  await expect(status).toHaveText('Placed Heavy Flat, 24″ × 16″, at 0″. 1 case on the pallet.');
  await expect(rotate).toBeDisabled();

  // Aiming at the Heavy Flat's top stacks onto it.
  await drag(page, 'SKU-MQ', await deckPoint(page, 24, 20, 8));
  await expect(status).toHaveText('Placed Medium Square, 12″ × 12″, at 8″. 2 cases on the pallet.');

  // Dropping far off the pallet is red: the carton goes back to its bay.
  await drag(page, 'SKU-LT', await deckPoint(page, -30, 20));
  await expect(status).toHaveText('Light Tall went back to its bay: it would overhang more than 2″.');

  // A press that moves under 6px is a tap: it selects without moving anything.
  const fragile = await bayCarton(page, 'SKU-FS');
  await page.mouse.move(fragile.x, fragile.y);
  await page.mouse.down();
  await page.mouse.move(fragile.x + 3, fragile.y + 2);
  await page.mouse.up();
  await expect(status).toHaveText('Selected Fragile Small.');

  expect(errors).toEqual([]);
});
