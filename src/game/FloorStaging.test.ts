import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { FLOOR_Y, PALLET_LENGTH_IN, PALLET_WIDTH_IN } from '../scene/coordinates';
import { SKU_CATALOG } from '../types/catalog';
import type { FloorCase } from '../types/engine';
import { BAY_IN, stageFloor, type FloorLayout } from './FloorStaging';

/** 100 cases cycling through the catalog, alternating which way they lie. */
const FLOOR: FloorCase[] = Array.from({ length: 100 }, (_, id) => ({
  id, sku_id: SKU_CATALOG[(id * 3) % 8].id, yaw: id % 3 === 0 ? 90 : 0,
}));

/** The deck plus the 2" a case may overhang it, at floor level and up. */
const OVERHANG_ZONE = new Box3(
  new Vector3(-PALLET_LENGTH_IN / 2 - 2, FLOOR_Y, -PALLET_WIDTH_IN / 2 - 2),
  new Vector3(PALLET_LENGTH_IN / 2 + 2, 100, PALLET_WIDTH_IN / 2 + 2),
);

/** Strict overlap: boxes that only touch do not count. */
function overlaps(a: Box3, b: Box3) {
  return a.min.x < b.max.x && b.min.x < a.max.x && a.min.z < b.max.z && b.min.z < a.max.z;
}

describe.each<FloorLayout>(['radial', 'portrait', 'landscape'])('the %s floor', layout => {
  const bays = stageFloor(FLOOR, layout);

  it('stages every case once, sized and turned as spawned, on the floor', () => {
    expect(bays.map(bay => bay.id)).toEqual(FLOOR.map(c => c.id));
    for (const bay of bays) {
      const spawned = FLOOR[bay.id];
      expect(bay.sku.id).toBe(spawned.sku_id);
      expect(bay.yaw).toBe(spawned.yaw);
      const size = bay.bounds.getSize(new Vector3());
      const [along, across] = spawned.yaw === 0 ? [size.x, size.z] : [size.z, size.x];
      expect([along, across, size.y]).toEqual([bay.sku.length_in, bay.sku.width_in, bay.sku.height_in]);
      expect(bay.position.y).toBe(FLOOR_Y);
      expect(bay.bounds.min.y).toBe(FLOOR_Y);
      expect(bay.bounds.getCenter(new Vector3()).setY(FLOOR_Y)).toEqual(bay.position);
    }
  });

  it('keeps cartons apart and clear of the pallet and its overhang zone', () => {
    for (const [i, bay] of bays.entries()) {
      expect(overlaps(bay.bounds, OVERHANG_ZONE), `case ${bay.id}`).toBe(false);
      for (const other of bays.slice(i + 1)) expect(overlaps(bay.bounds, other.bounds), `${bay.id}/${other.id}`).toBe(false);
    }
  });

  it('surrounds the pallet on every side', () => {
    const centers = bays.map(bay => bay.position);
    expect(centers.some(c => c.x > PALLET_LENGTH_IN / 2)).toBe(true);
    expect(centers.some(c => c.x < -PALLET_LENGTH_IN / 2)).toBe(true);
    expect(centers.some(c => c.z > PALLET_WIDTH_IN / 2)).toBe(true);
    expect(centers.some(c => c.z < -PALLET_WIDTH_IN / 2)).toBe(true);
  });
});

describe('radial floor clusters', () => {
  it('pack the floor within reach of the pallet', () => {
    // 100 cartons and their aisles cover about 33,000 in², roughly a 180" square around the pallet.
    const bays = stageFloor(FLOOR, 'radial');
    const reach = Math.max(...bays.map(bay => bay.position.length()));
    expect(reach).toBeLessThan(200);
  });
});

describe('26" bay slots', () => {
  it('center each carton in its own slot on a 26" lattice', () => {
    for (const layout of ['portrait', 'landscape'] as const) {
      const bays = stageFloor(FLOOR, layout);
      const slots = new Set<string>();
      for (const bay of bays) {
        const slot = new Vector3(Math.floor(bay.position.x / BAY_IN), 0, Math.floor(bay.position.z / BAY_IN));
        expect(bay.position.x).toBe((slot.x + 0.5) * BAY_IN);
        expect(bay.position.z).toBe((slot.z + 0.5) * BAY_IN);
        slots.add(`${slot.x},${slot.z}`);
      }
      expect(slots.size).toBe(bays.length);
    }
  });

  it('stretch toward the screen\'s long side under the isometric camera', () => {
    // The iso camera looks along the X = Z diagonal: X + Z runs up the screen, X − Z across it.
    const spread = (layout: FloorLayout) => {
      const bays = stageFloor(FLOOR, layout);
      const range = (values: number[]) => Math.max(...values) - Math.min(...values);
      return {
        across: range(bays.map(({ position: p }) => p.x - p.z)),
        up: range(bays.map(({ position: p }) => p.x + p.z)),
      };
    };
    const portrait = spread('portrait');
    const landscape = spread('landscape');
    expect(portrait.up).toBeGreaterThan(1.5 * portrait.across);
    expect(landscape.across).toBeGreaterThan(landscape.up);
  });
});
