import { expect, test } from '@playwright/test';

test('round service persists snapshots once and tracks independent personal bests across reloads', async ({ page }) => {
  await page.goto('/?mode=1&seed=42');
  const saved = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    const base = {
      id: crypto.randomUUID(), timestamp: '2026-10-06T12:00:00.000Z', mode: 'free_staging_100', seed: '42',
      duration_ms: 20000, cases_placed: 1, total_weight_lbs: 18, volume_utilization_pct: 1.25,
      stability_index_pct: 95, quality_pct: 95, composite_score: 95, grade: 'S', crush_count: 0,
      overhang_inches: 0, end_reason: 'shipped', final_score: 95,
      pallet_snapshot: [{ id: '1', sku_id: 'SKU-MQ', grid_x: 9, grid_y: 7, elevation_z: 0,
        rotation_yaw: 90, flipped: true, crushed: false, weight_lbs: 18 }],
    };
    await roundService.save(base);
    await roundService.save(base);
    await roundService.save({ ...base, id: crypto.randomUUID(), duration_ms: 60000, quality_pct: 80,
      grade: 'A', composite_score: 80, final_score: 180, end_reason: 'time_up' });
    return base;
  });
  await page.reload();
  const history = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    return { rounds: await roundService.list(), bests: await roundService.bests() };
  });
  expect(history.rounds).toHaveLength(2);
  expect(history.rounds.find((r: { id: string }) => r.id === saved.id)).toEqual(saved);
  expect(history.bests).toEqual([{
    mode: 'free_staging_100', high_score: 180, highest_quality_pct: 95, max_cases_placed: 1,
    fastest_completion_ms: 20000, achieved_at: '2026-10-06T12:00:00.000Z',
  }]);
});

test('backup round-trip merges by UUID and rejects malformed data without changing history', async ({ page }) => {
  await page.goto('/?mode=1');
  const result = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    const round = {
      id: crypto.randomUUID(), timestamp: '2026-10-06T12:00:00.000Z', mode: 'conveyor_diversion', seed: '18446744073709551615',
      duration_ms: 45000, cases_placed: 1, total_weight_lbs: 18, volume_utilization_pct: 1.25,
      stability_index_pct: 85, quality_pct: 85, composite_score: 85, grade: 'A', crush_count: 1,
      overhang_inches: 2, end_reason: 'estop', final_score: 85, diversions_count: 5, estop_triggered: true,
      pallet_snapshot: [{ id: '1', sku_id: 'SKU-MQ', grid_x: -1, grid_y: 7, elevation_z: 0,
        rotation_yaw: 270, flipped: false, crushed: true, weight_lbs: 18 }],
    };
    await roundService.save(round);
    const backup = await roundService.exportData();
    await roundService.clear();
    const empty = [await roundService.list(), await roundService.bests()];
    await roundService.importData(JSON.stringify(backup));
    await roundService.importData(JSON.stringify(backup));
    const failures = [];
    for (const bad of [
      { ...backup, version: 99 },
      { ...backup, rounds: [{ ...round, seed: '18446744073709551616' }] },
      { ...backup, rounds: [{ ...round, pallet_snapshot: [{ ...round.pallet_snapshot[0], rotation_yaw: 45 }] }] },
      { ...backup, rounds: [{ ...round, quality_pct: '85' }] },
      { ...backup, personal_bests: [{ mode: round.mode, high_score: -1 }] },
    ]) {
      try { await roundService.importData(JSON.stringify(bad)); failures.push(false); }
      catch { failures.push(true); }
    }
    return { empty, failures, backup, restored: await roundService.exportData() };
  });
  expect(result.empty).toEqual([[], []]);
  expect(result.failures).toEqual([true, true, true, true, true]);
  expect(result.restored).toEqual(result.backup);
  expect(result.restored.personal_bests[0].fastest_completion_ms).toBeUndefined();
});

test('finishing a pallet automatically saves its engine coordinates and telemetry exactly once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mode=1&seed=42');
  await page.getByRole('button', { name: 'Open warehouse menu' }).click();
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.getByRole('button', { name: 'Close warehouse menu' }).click();
  const from = await page.evaluate(() => window.__palletTest!.bayCarton('SKU-MQ'));
  await page.mouse.click(from.x, from.y);
  await page.getByRole('button', { name: 'Rotate', exact: true }).click();
  await page.getByRole('button', { name: 'Flip', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  await expect(page.getByRole('status', { name: 'Round save status' })).toHaveText('Round saved on this device.');
  await page.reload();
  const rounds = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    return (await import(/* @vite-ignore */ path)).roundService.list();
  });
  expect(rounds).toHaveLength(1);
  expect(rounds[0]).toMatchObject({
    mode: 'free_staging_100', seed: '42', cases_placed: 1, total_weight_lbs: 18, end_reason: 'shipped',
    pallet_snapshot: [{ id: '0', sku_id: 'SKU-MQ', grid_x: 9, grid_y: 7, elevation_z: 0,
      rotation_yaw: 270, flipped: true, crushed: false, weight_lbs: 18 }],
  });
  expect(rounds[0].duration_ms).toBeGreaterThan(0);
});

test('gallery browses completed pallets with orbit inspection and per-mode personal bests', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=1');
  await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    await roundService.save({
      id: crypto.randomUUID(), timestamp: '2026-10-06T12:00:00.000Z', mode: 'free_staging_100', seed: '42',
      duration_ms: 22000, cases_placed: 2, total_weight_lbs: 36, volume_utilization_pct: 2.5,
      stability_index_pct: 85, quality_pct: 85, composite_score: 170, grade: 'A', crush_count: 1,
      overhang_inches: 0, end_reason: 'shipped', final_score: 170,
      pallet_snapshot: [
        { id: '0', sku_id: 'SKU-MQ', grid_x: 9, grid_y: 7, elevation_z: 0,
          rotation_yaw: 90, flipped: false, crushed: true, weight_lbs: 18 },
        { id: '1', sku_id: 'SKU-MQ', grid_x: 9, grid_y: 7, elevation_z: 10,
          rotation_yaw: 270, flipped: true, crushed: false, weight_lbs: 18 },
      ],
    });
  });
  await page.getByRole('button', { name: 'Pallet gallery', exact: true }).click();
  const gallery = page.getByRole('dialog', { name: 'Pallet gallery' });
  await expect(gallery.getByRole('region', { name: 'Mode 1 personal bests' })).toContainText('170');
  await expect(gallery.getByRole('region', { name: 'Mode 1 personal bests' })).toContainText('22.00s');
  await expect(gallery.getByRole('region', { name: 'Mode 2 personal bests' })).toContainText('No rounds yet');
  await expect(gallery.getByRole('table', { name: 'Saved case coordinates' })).toContainText('270°');
  await expect(gallery).toContainText('2 cases · 1 crushed');
  const canvas = gallery.getByRole('img', { name: 'Saved pallet: 2 cases' });
  await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 25, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('pallet-gallery-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(gallery.getByRole('button', { name: 'Close gallery' })).toBeVisible();
  expect(await gallery.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pallet-gallery-mobile.png') });
  await gallery.getByRole('button', { name: 'Close gallery' }).click();
  await expect(gallery).toBeHidden();
});

test('exports history into a fresh browser and requires two confirmations before clearing it', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?mode=1&seed=42');
  await page.getByRole('button', { name: 'Ship pallet' }).click();
  await expect(page.getByRole('status', { name: 'Round save status' })).toHaveText('Round saved on this device.');
  await page.getByRole('dialog', { name: 'Pallet shipped' }).getByRole('button', { name: 'Saved data', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Saved data' });
  const downloaded = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Export All Data (.json)', exact: true }).click();
  const download = await downloaded;
  const { readFile } = await import('node:fs/promises');
  const backup = await readFile((await download.path())!);
  expect(JSON.parse(backup.toString()).rounds).toHaveLength(1);
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const other = await fresh.newPage();
    await other.goto('http://127.0.0.1:4173/?mode=1');
    await other.getByRole('button', { name: 'Open warehouse menu' }).click();
    await other.getByRole('button', { name: 'Saved data', exact: true }).click();
    const data = other.getByRole('dialog', { name: 'Saved data' });
    await data.getByLabel('Import Data (.json)').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await expect(data.getByRole('status')).toHaveText('Imported 1 round.');
    await data.getByLabel('Import Data (.json)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
    await expect(data.getByRole('alert')).toContainText('unsupported schema version');
    await data.getByRole('button', { name: 'Clear All Saved Data', exact: true }).click();
    await data.getByRole('button', { name: 'Continue to final confirmation' }).click();
    await data.getByRole('button', { name: 'Keep saved data' }).click();
    await data.getByRole('button', { name: 'Close saved data' }).click();
    await other.getByRole('button', { name: 'Open warehouse menu' }).click();
    await other.getByRole('button', { name: 'Pallet gallery', exact: true }).click();
    await expect(other.getByRole('navigation', { name: 'Saved rounds' }).getByRole('button')).toHaveCount(1);
    await other.getByRole('button', { name: 'Close gallery' }).click();
    await other.getByRole('button', { name: 'Open warehouse menu' }).click();
    await other.getByRole('button', { name: 'Saved data', exact: true }).click();
    await data.getByRole('button', { name: 'Clear All Saved Data', exact: true }).click();
    await data.getByRole('button', { name: 'Continue to final confirmation' }).click();
    await data.getByRole('button', { name: 'Delete saved rounds and bests' }).click();
    await expect(data.getByRole('status')).toHaveText('All saved data cleared.');
    await data.getByRole('button', { name: 'Close saved data' }).click();
    await other.reload();
    await other.getByRole('button', { name: 'Open warehouse menu' }).click();
    await other.getByRole('button', { name: 'Pallet gallery', exact: true }).click();
    await expect(other.getByRole('dialog', { name: 'Pallet gallery' })).toContainText('Your first completed round will appear here.');
    await expect(other.getByText('No rounds yet', { exact: true })).toHaveCount(2);
  } finally { await fresh.close(); }
});

test('preserves utilization above 100 percent for a valid overhanging pallet', async ({ page }) => {
  await page.goto('/?mode=1');
  const saved = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    // 250 10×8×6-inch cartons fill a 50×40×60 build: the last column overhangs by 2 inches.
    const pallet_snapshot = Array.from({ length: 250 }, (_, i) => ({
      id: String(i), sku_id: 'SKU-FS', grid_x: (i % 5) * 5, grid_y: (Math.floor(i / 5) % 5) * 4,
      elevation_z: Math.floor(i / 25) * 6, rotation_yaw: 0, flipped: false, crushed: i < 150, weight_lbs: 4,
    }));
    const record = {
      id: crypto.randomUUID(), timestamp: '2026-10-06T12:00:00.000Z', mode: 'conveyor_diversion', seed: '1',
      duration_ms: 800000, cases_placed: 250, total_weight_lbs: 1000, volume_utilization_pct: 104.16666666666667,
      stability_index_pct: 0, quality_pct: 0, composite_score: 0, grade: 'F', crush_count: 150,
      overhang_inches: 2, end_reason: 'shipped', final_score: 0, diversions_count: 0, estop_triggered: false, pallet_snapshot,
    };
    await roundService.save(record);
    return roundService.get(record.id);
  });
  expect(saved.volume_utilization_pct).toBe(104.16666666666667);
  expect(saved.pallet_snapshot).toHaveLength(250);
});

test('an empty pallet does not claim a perfect personal best quality', async ({ page }) => {
  await page.goto('/?mode=1');
  const bests = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    await roundService.save({
      id: crypto.randomUUID(), timestamp: '2026-10-06T12:00:00.000Z', mode: 'conveyor_diversion', seed: '7',
      duration_ms: 30000, cases_placed: 0, total_weight_lbs: 0, volume_utilization_pct: 0,
      stability_index_pct: 100, quality_pct: 100, composite_score: 0, grade: 'S', crush_count: 0,
      overhang_inches: 0, end_reason: 'estop', final_score: 0, diversions_count: 5, estop_triggered: true, pallet_snapshot: [],
    });
    return roundService.bests();
  });
  expect(bests).toEqual([{ mode: 'conveyor_diversion', high_score: 0, highest_quality_pct: 0, max_cases_placed: 0,
    achieved_at: '2026-10-06T12:00:00.000Z' }]);
});
