import { expect, test } from '@playwright/test';

test('boots the main-thread engine and renders a responsive, interactive pallet', async ({ page }) => {
  const errors: string[] = [];
  const messages: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    messages.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Engine initialized: v1.0.0');
  const canvas = page.getByRole('img', { name: 'Interactive 48 by 40 inch stringer pallet' });
  await expect(canvas).toBeVisible();
  await expect.poll(() => messages.some(text => text === 'Engine initialized: v1.0.0')).toBe(true);
  await expect.poll(() => messages.some(text => text.includes('[vite] connected'))).toBe(true);
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => canvas.evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio, 2);
      return Math.abs(canvas.width - Math.floor(rect.width * ratio)) <= 1 && Math.abs(canvas.height - Math.floor(rect.height * ratio)) <= 1;
    })).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const before = await canvas.screenshot();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 150, bounds.y + bounds.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  expect(errors).toEqual([]);
});
