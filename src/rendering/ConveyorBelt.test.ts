import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Engine, initSync } from '../../pkg/pallet_sim';
import { skuById } from '../types/catalog';
import type { ConveyorStatus } from '../types/engine';
import { conveyorPickBays, queueSpots } from './ConveyorBelt';

const where = (spots: ReturnType<typeof queueSpots>) => spots.map(({ x, z }) => [x, z]);

it('presses each queued carton against the one ahead, the first against the end stop', () => {
  // Heavy Flat is 16″ deep along the lane, Light Tall and Medium Square 12″.
  const spots = queueSpots((['SKU-HF', 'SKU-LT', 'SKU-MQ'] as const).map(skuById));
  expect(where(spots)).toEqual([[52, 44], [52, 30], [52, 18]]);
});

it('starts a carton on the next leg rather than bend it round a corner', () => {
  // The pick lane holds seven 16″-deep Heavy Flats (112″ of 116″). The eighth crosses the
  // transfer lengthwise (24″ along X), and the ninth starts up the infeed lane.
  const spots = queueSpots(Array.from({ length: 9 }, () => skuById('SKU-HF')));
  expect(where(spots).slice(6)).toEqual([[52, -52], [64, -64], [80, -56]]);
});

it('agrees with the engine on which cartons are on the final run', () => {
  initSync({ module: readFileSync(new URL('../../pkg/pallet_sim_bg.wasm', import.meta.url)) });
  for (const seed of [2149n, 42n, 7n, 99n]) {
    const engine = new Engine();
    engine.start_mode2(seed, 0);
    const status: ConveyorStatus = engine.tick_mode2(35_000); // ten queued
    const spots = queueSpots(status.queue.map(item => skuById(item.sku_id)));
    // The final run is the pick lane at x = 52.
    expect(spots.map(spot => spot.x === 52).lastIndexOf(true) + 1).toBe(status.final_run);
    expect(conveyorPickBays(status).map(bay => bay.id)).toEqual(status.queue.slice(0, status.final_run).map(item => item.id));
    engine.free();
  }
});
