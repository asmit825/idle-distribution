import { expect, test } from '@playwright/test';

test('dashboard inspects a case and reports live load metrics after placement', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=1&seed=42');
  await expect(page.getByRole('region', { name: 'Pallet load quality' })).toBeVisible();
  await expect(page.locator('#gradeVal')).toHaveText('F');
  await expect(page.locator('#scoreVal')).toHaveText('0');
  await expect(page.getByRole('img', { name: /Center of gravity/ })).toBeVisible();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  const from = await page.evaluate(() => window.__palletTest!.bayCarton('SKU-MQ'));
  await page.mouse.click(from.x, from.y);
  await expect(page.getByRole('region', { name: 'Active case inspector' })).toContainText('Medium Square');
  await expect(page.getByRole('region', { name: 'Active case inspector' })).toContainText('18 lbs');
  const to = await page.evaluate(() => window.__palletTest!.deckPoint(24, 20));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('#scoreVal')).toHaveText('100');
  await expect(page.locator('#volVal')).toHaveText('1.3%');
  await expect(page.getByLabel('Pallet height', { exact: true })).toHaveText('10″ / 60″');
  await page.screenshot({ path: testInfo.outputPath('desktop-dashboard.png') });
  await page.waitForTimeout(500);
  const placed = await page.evaluate(() => window.__palletTest!.deckPoint(24, 20, 10));
  await page.mouse.click(placed.x, placed.y);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#scoreVal')).toHaveText('0');
  await expect(page.getByLabel('Pallet height', { exact: true })).toHaveText('0″ / 60″');
  await expect(page.locator('.viewport-label p')).toHaveText('Wave 1 · 25 cases on the floor');
});

test.describe('mobile control deck', () => {
  test.use({ hasTouch: true });
  test('tap-picks, repeats camera-relative nudges, rotates, flips, returns and confirms a carton', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mode=1&seed=42');
    await expect(page.locator('body')).toHaveClass(/compact/); // coarse pointer alone
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveClass(/compact/);
    await page.getByRole('button', { name: 'Open warehouse menu' }).click();
    await page.getByRole('button', { name: 'Top', exact: true }).click();
    await page.getByRole('button', { name: 'Close warehouse menu' }).click();
    const from = await page.evaluate(() => window.__palletTest!.bayCarton('SKU-MQ'));
    await page.touchscreen.tap(from.x, from.y);
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
    const inspector = page.getByRole('region', { name: 'Active case inspector' });
    await expect(inspector).toContainText('Grid 9, 7');
    await page.screenshot({ path: testInfo.outputPath('mobile-portrait.png') });
    await page.getByRole('button', { name: 'Nudge right' }).click();
    await expect(inspector).toContainText('Grid 10, 7');
    const left = (await page.getByRole('button', { name: 'Nudge left' }).boundingBox())!;
    await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await expect(inspector).not.toContainText('Grid 9, 7');
    const stopped = await inspector.textContent();
    await page.waitForTimeout(300);
    await expect(inspector).toHaveText(stopped!);
    await page.getByRole('button', { name: 'Rotate', exact: true }).click();
    await expect(inspector).toContainText('270° yaw');
    await page.getByRole('button', { name: 'Flip', exact: true }).click();
    await expect(inspector).toContainText('flipped');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
    await page.touchscreen.tap(from.x, from.y);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('.mobile-grade')).toHaveText('A+ · 100 pts');
    // The placed carton stays selected: the D-pad keeps fine-tuning it until a second Done.
    await expect(inspector).toContainText('SELECTED');
    await expect(inspector).toContainText('Grid 9, 7');
    await page.getByRole('button', { name: 'Nudge right' }).click();
    await expect(inspector).toContainText('Grid 10, 7');
    await expect(page.locator('.placement-status')).toHaveText('Moved Medium Square to grid 10, 7, at 0″.');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nudge right' })).toBeDisabled();
    for (const name of ['Rotate', 'Flip', 'Remove', 'Done']) {
      const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole('button', { name: 'Open warehouse menu' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const canvas = (await page.getByRole('img', { name: 'Interactive 48 by 40 inch stringer pallet' }).boundingBox())!;
    expect(canvas.height).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath('mobile-landscape.png') });
  });
});

test('ships into a glass result dialog with a complete breakdown and downloadable replay', async ({ page }) => {
  await page.goto('/?mode=1&seed=42');
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  const result = page.getByRole('dialog', { name: 'Pallet shipped' });
  await expect(result).toContainText('Volume fill');
  await expect(result).toContainText('Cases stacked');
  await expect(result).toContainText('Overhang penalty');
  await expect(result).toContainText('Crush deductions');
  await expect(result).toContainText('Early finish bonus');
  await expect(result).toHaveAttribute('aria-modal', 'true');
  await expect(result.getByRole('img', { name: /^3D reconstruction of the shipped pallet: 0 cartons, 0 crushed/ })).toBeVisible();
  await expect(result.getByLabel(/^Grade (A\+|[A-CF])$/)).toBeVisible();
  await expect(result.getByRole('button', { name: 'New shift' })).toBeFocused();
  const download = page.waitForEvent('download');
  await result.getByRole('button', { name: 'Export replay' }).click();
  expect((await download).suggestedFilename()).toBe('pallet-mode1-42.json');
  await result.getByRole('button', { name: 'New shift' }).click();
  await expect(result).toBeHidden();
  await expect(page.getByRole('timer')).toHaveText('1:00');
});

test('the result dialog rebuilds the shipped pallet in a rotatable 3D view', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=1&seed=42');
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  const from = await page.evaluate(() => window.__palletTest!.bayCarton('SKU-MQ'));
  const to = await page.evaluate(() => window.__palletTest!.deckPoint(24, 20));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  const result = page.getByRole('dialog', { name: 'Pallet shipped' });
  const view = result.getByRole('img', { name: /^3D reconstruction of the shipped pallet: 1 cartons, 0 crushed/ });
  await expect(view).toBeVisible();
  await expect(result).toContainText('SHIFT COMPLETE · CERTIFIED');
  const before = await view.screenshot();
  await page.screenshot({ path: testInfo.outputPath('result-desktop.png') });
  // Drag sideways: the camera turns around the stack.
  const box = (await view.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Buffer.compare(before, await view.screenshot())).not.toBe(0);
  // The arrow keys turn it too.
  await view.focus();
  const dragged = await view.screenshot();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Buffer.compare(dragged, await view.screenshot())).not.toBe(0);

  // Under 900px the viewport stacks above the audit with no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.locator('dialog.result-modal');
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  const viewBox = (await view.boundingBox())!, audit = (await result.locator('.f3-telemetry-table').boundingBox())!;
  expect(viewBox.y + viewBox.height).toBeLessThan(audit.y);
  await page.screenshot({ path: testInfo.outputPath('result-mobile.png'), fullPage: true });
});
