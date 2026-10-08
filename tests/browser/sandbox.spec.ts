import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('the landing toggle launches a Mode 1 sandbox with no clock, remembered across reloads', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const style = page.getByRole('group', { name: 'Play style' });
  await expect(style.getByRole('button', { name: /^Timed/ })).toHaveAttribute('aria-pressed', 'true');
  await style.getByRole('button', { name: /^Sandbox/ }).click();
  await page.getByRole('button', { name: 'Launch Floor Sandbox' }).click();

  await expect(page.locator('.viewport-label .eyebrow')).toHaveText('MODE 1 · FREE STAGING · SANDBOX');
  await expect(page.getByRole('timer', { name: 'Shift elapsed time' })).toHaveText('0:00');
  await expect(page.locator('.viewport-label p')).toHaveText('Wave 1 · 25 cases on the floor');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: 'Sandbox' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Ship pallet' }).click();
  const result = page.getByRole('dialog', { name: 'Pallet shipped' });
  await expect(result).toContainText('SANDBOX REPORT · UNRANKED');
  await expect(result).not.toContainText('Early finish bonus');
  expect(errors).toEqual([]);
});

test('a Mode 2 sandbox pauses the full line instead of diverting, and switching back is timed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.setItem('idle-distribution:sandbox', 'true'));
  await page.clock.install();
  await page.goto('/?mode=2&seed=2149');
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0');
  await page.clock.fastForward(180_000);
  await expect(page.getByLabel('Recirculation lane')).toHaveText('10 / 10');
  await expect(page.getByLabel('Line status')).toHaveText('Line paused');
  await expect(page.getByLabel('Overflow countdown')).toHaveCount(0);
  await expect(page.getByLabel('Diversions')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Warehouse Estop' })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: 'Sandbox' }).click();
  await expect(page.getByLabel('Conveyor queue')).toHaveText('0');
  await expect(page.getByLabel('Diversions')).toHaveText('0 / 5');
  expect(errors).toEqual([]);
});

test('sandbox rounds are saved for the gallery but never count toward personal bests', async ({ page }) => {
  await page.goto('/?mode=1');
  const { rounds, bests, estop } = await page.evaluate(async () => {
    const path = '/src/storage/roundService.ts';
    const { roundService } = await import(/* @vite-ignore */ path);
    await roundService.clear();
    const round = {
      id: crypto.randomUUID(), timestamp: '2026-10-07T12:00:00.000Z', mode: 'free_staging_100', seed: '42',
      duration_ms: 600_000, cases_placed: 1, total_weight_lbs: 18, volume_utilization_pct: 1.25,
      stability_index_pct: 95, quality_pct: 95, composite_score: 95, grade: 'S', crush_count: 0,
      overhang_inches: 0, end_reason: 'shipped', final_score: 95, sandbox: true,
      pallet_snapshot: [{ id: '1', sku_id: 'SKU-MQ', grid_x: 9, grid_y: 7, elevation_z: 0,
        rotation_yaw: 90, flipped: true, crushed: false, weight_lbs: 18 }],
    };
    await roundService.save(round);
    const estop = await roundService.save({ ...round, id: crypto.randomUUID(), mode: 'conveyor_diversion',
      end_reason: 'estop', diversions_count: 5, estop_triggered: true }).then(() => 'saved', (error: Error) => error.message);
    return { rounds: await roundService.list(), bests: await roundService.bests(), estop };
  });
  expect(rounds).toHaveLength(1);
  expect(bests).toEqual([]);
  expect(estop).toBe('Invalid backup: conveyor ending.');

  await page.goto('/?gallery=true');
  await expect(page.getByRole('navigation', { name: 'Saved rounds' })).toContainText('Mode 1 Sandbox');
});
