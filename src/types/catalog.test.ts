import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { initSync, sku_catalog } from '../../pkg/pallet_sim';
import { SKU_CATALOG, skuById } from './catalog';

it('mirrors the Rust engine catalog exactly', () => {
  initSync({ module: readFileSync(new URL('../../pkg/pallet_sim_bg.wasm', import.meta.url)) });
  expect(SKU_CATALOG).toEqual(sku_catalog());
});

it('looks up SKUs by id', () => {
  expect(skuById('SKU-FS').name).toBe('Fragile Small');
});
