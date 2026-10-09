import { expect, test, type Page } from '@playwright/test';

const headline = (page: Page) => page.getByRole('heading', { name: 'Master Pallet Staging. Build Higher. Crush Less.' });
const floorMode = (page: Page) => page.getByRole('button', { name: 'Mode 01: 100-Case Floor Rush', exact: true });
const conveyorMode = (page: Page) => page.getByRole('button', { name: 'Mode 02: Conveyor Line Sorter', exact: true });
const galleryMode = (page: Page) => page.getByRole('button', { name: 'Mode 03: 3D Pallet Inspection Bay', exact: true });

test('opens the dispatch terminal at the root and selects the launch action without starting a shift', async ({ page }) => {
  await page.goto('/');
  await expect(headline(page)).toBeVisible();
  await expect(floorMode(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Launch 100-Case Sprint' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.locator('.landing-bottom-bar').getByText(/^v\d+\.\d+\.\d+ · \w+$/)).toBeVisible();

  await conveyorMode(page).click();
  await expect(conveyorMode(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(floorMode(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Launch Conveyor Mode' })).toBeVisible();
  await expect(page.getByLabel('Conveyor queue')).toHaveCount(0);

  await galleryMode(page).click();
  await expect(galleryMode(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(conveyorMode(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Open 3D Pallet Gallery' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

for (const mode of [1, 2] as const) {
  test(`launches Mode ${mode} and returns to the terminal while retaining URL context`, async ({ page }) => {
    await page.goto('/?seed=42&source=dispatch#bay-2b');
    await (mode === 1 ? floorMode(page) : conveyorMode(page)).click();
    await page.getByRole('button', { name: mode === 1 ? 'Launch 100-Case Sprint' : 'Launch Conveyor Mode' }).click();
    await expect(page.getByRole('img', { name: 'Interactive 48 by 40 inch stringer pallet' })).toBeVisible();
    if (mode === 1) await expect(page.getByRole('timer', { name: 'Shift time remaining' })).toHaveText('1:00');
    else await expect(page.getByLabel('Conveyor queue')).toBeVisible();
    const launched = new URL(page.url());
    expect(launched.searchParams.get('mode')).toBe(String(mode));
    expect(launched.searchParams.get('seed')).toBe('42');
    expect(launched.searchParams.get('source')).toBe('dispatch');
    expect(launched.hash).toBe('#bay-2b');

    await page.getByRole('button', { name: 'Exit to Terminal' }).click();
    await expect(headline(page)).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(0);
    const returned = new URL(page.url());
    expect(returned.searchParams.has('mode')).toBe(false);
    expect(returned.searchParams.has('gallery')).toBe(false);
    expect(returned.searchParams.get('seed')).toBe('42');
    expect(returned.searchParams.get('source')).toBe('dispatch');
    expect(returned.hash).toBe('#bay-2b');
  });
}

test('double-click launches the floor rush and browser history restores each screen', async ({ page }) => {
  await page.goto('/?seed=42#dispatch');
  await floorMode(page).dblclick();
  await expect(page.getByRole('timer', { name: 'Shift time remaining' })).toHaveText('1:00');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('1');

  await page.goBack();
  await expect(headline(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
  await page.goForward();
  await expect(page.getByRole('timer', { name: 'Shift time remaining' })).toHaveText('1:00');
  await expect(headline(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('seed')).toBe('42');
  expect(new URL(page.url()).hash).toBe('#dispatch');
});

test('opens the saved pallet gallery from its tile and supports a direct gallery URL', async ({ page }) => {
  await page.goto('/?seed=42#inspection');
  await galleryMode(page).click();
  await page.getByRole('button', { name: 'Open 3D Pallet Gallery' }).click();
  const gallery = page.getByRole('dialog', { name: 'Pallet gallery' });
  await expect(gallery).toBeVisible();
  await expect(gallery).toContainText('Your first completed round will appear here.');
  expect(new URL(page.url()).searchParams.get('gallery')).toBe('true');
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
  await gallery.getByRole('button', { name: 'Close gallery' }).click();
  await expect(gallery).toBeHidden();
  await expect(headline(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('seed')).toBe('42');
  expect(new URL(page.url()).hash).toBe('#inspection');

  await page.goto('/?gallery=true&seed=42#inspection');
  await expect(gallery).toBeVisible();
  await gallery.getByRole('button', { name: 'Close gallery' }).click();
  await expect(headline(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.has('gallery')).toBe(false);
});

test('loads career statistics and saved-build telemetry without counting empty perfect pallets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    const shipped = {
      id: crypto.randomUUID(), timestamp: '2026-10-07T12:00:00.000Z', mode: 'free_staging_100', seed: '42',
      duration_ms: 20000, cases_placed: 1, total_weight_lbs: 18, volume_utilization_pct: 1.25,
      stability_index_pct: 85, quality_pct: 85, composite_score: 85, grade: 'A', crush_count: 0,
      overhang_inches: 0, end_reason: 'shipped', final_score: 85,
      pallet_snapshot: [{ id: '0', sku_id: 'SKU-MQ', grid_x: 9, grid_y: 7, elevation_z: 0,
        rotation_yaw: 0, flipped: false, crushed: false, weight_lbs: 18 }],
    };
    await roundService.save(shipped);
    await roundService.save({ ...shipped, id: crypto.randomUUID(), timestamp: '2026-10-07T13:00:00.000Z',
      duration_ms: 60000, end_reason: 'time_up', stability_index_pct: 95, quality_pct: 95,
      composite_score: 95, final_score: 95, grade: 'S' });
    await roundService.save({ ...shipped, id: crypto.randomUUID(), timestamp: '2026-10-07T14:00:00.000Z',
      cases_placed: 0, total_weight_lbs: 0, volume_utilization_pct: 0, stability_index_pct: 100,
      quality_pct: 100, composite_score: 0, final_score: 0, grade: 'S', pallet_snapshot: [] });
  });
  await page.reload();
  const stats = page.getByLabel('Career statistics');
  await expect(stats).toHaveAttribute('aria-busy', 'false');
  await expect(stats.locator('dd').nth(0)).toHaveText('1');
  await expect(stats.locator('dd').nth(1)).toHaveText('95%');
  await expect(stats.locator('dd').nth(2)).toHaveText('60″');
  await expect(floorMode(page)).toContainText('Best: S (95%)');
  await expect(galleryMode(page)).toContainText('Saved Builds: 3 Pallets');
  await galleryMode(page).click();
  await page.getByRole('button', { name: 'Open 3D Pallet Gallery' }).click();
  await expect(page.getByRole('navigation', { name: 'Saved rounds' }).getByRole('button')).toHaveCount(3);
});

test('opens and dismisses the rules with keyboard focus restored and toggles terminal sound', async ({ page }) => {
  await page.goto('/');
  const openRules = page.getByRole('button', { name: 'View Rule Specifications' });
  const rules = page.getByRole('dialog', { name: 'Rules & pallet physics' });
  await openRules.click();
  await expect(rules).toBeVisible();
  await expect(rules.getByRole('button', { name: 'Close rules' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rules).toBeHidden();
  await expect(openRules).toBeFocused();

  const sound = page.getByRole('button', { name: 'Sound on', exact: true });
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(page.getByRole('button', { name: 'Sound off', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Sound off', exact: true }).click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the terminal controls usable without horizontal overflow on narrow screens', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const size of [{ width: 1440, height: 900 }, { width: 959, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect(headline(page)).toBeVisible();
    await expect(floorMode(page)).toBeVisible();
    await expect(conveyorMode(page)).toBeVisible();
    await expect(galleryMode(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await conveyorMode(page).click();
    await expect(page.getByRole('button', { name: 'Launch Conveyor Mode' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`homepage-${size.width}x${size.height}.png`), fullPage: true });
  }
});

test('top-left brand box links to idlemullet.com and reveals home icon on hover', async ({ page }) => {
  await page.goto('/');
  const homeLink = page.getByRole('link', { name: 'Return to idleMullet homepage' });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute('href', 'https://idlemullet.com');
  await expect(homeLink).toHaveAttribute('title', 'Return to idleMullet (idlemullet.com)');

  const boxIcon = homeLink.locator('.brand-icon-box');
  const homeIcon = homeLink.locator('.brand-icon-home');
  await expect(boxIcon).toBeVisible();
  await expect(homeIcon).toBeAttached();

  const initialBoxOpacity = await boxIcon.evaluate(el => window.getComputedStyle(el).opacity);
  const initialHomeOpacity = await homeIcon.evaluate(el => window.getComputedStyle(el).opacity);
  expect(Number(initialBoxOpacity)).toBe(1);
  expect(Number(initialHomeOpacity)).toBe(0);

  await homeLink.hover();
  await expect.poll(async () => {
    return homeIcon.evaluate(el => Number(window.getComputedStyle(el).opacity));
  }).toBe(1);
  await expect.poll(async () => {
    return boxIcon.evaluate(el => Number(window.getComputedStyle(el).opacity));
  }).toBe(0);
});

