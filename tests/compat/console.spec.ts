import { expect, test } from '@playwright/test';

test('boots, places a carton, and switches modes without console errors or warnings', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?mode=1&seed=42');
  await expect(page.getByRole('status').first()).toHaveText('Engine initialized: v1.0.0');
  await expect(page.getByRole('img', { name: 'Interactive 48 by 40 inch stringer pallet' })).toBeVisible();
  await expect(page.getByText('WebGL is unavailable')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!window.__palletTest)).toBe(true);

  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(500); // camera easing
  const from = await page.evaluate(() => window.__palletTest!.bayCarton('SKU-MQ'));
  const to = await page.evaluate(() => window.__palletTest!.deckPoint(24, 20));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.placement-status')).toHaveText('Placed Medium Square, 12″ × 12″, at 0″. 1 case on the pallet.');

  await page.getByRole('button', { name: 'Mode 2 · Conveyor' }).click();
  await expect(page.getByLabel('Conveyor queue')).toHaveText(/^\d+$/);
  await page.getByRole('button', { name: 'Mode 1 · Free staging' }).click();
  await expect(page.getByRole('timer')).toHaveText('1:00');
  expect(problems).toEqual([]);
});
