import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Box3, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { skuById } from '../types/catalog';
import { createBoxMesh } from './BoxMesh';
import { disposeBoxMaterials, getBoxMaterials } from './materials';

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
});
afterEach(() => {
  disposeBoxMaterials();
  vi.unstubAllGlobals();
});

const bounds = (object: Object3D) => {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const round = (v: Vector3) => v.toArray().map(n => Math.round(n * 1e4) / 1e4);
  return { size: round(box.getSize(new Vector3())), min: round(box.min), max: round(box.max) };
};

it('rests a carton on its base, inset by a 1/8" seam inside its grid footprint', () => {
  // Heavy Flat: 24" long (X) × 16" wide (Z) × 8" tall (Y).
  expect(bounds(createBoxMesh(skuById('SKU-HF')))).toEqual({
    size: [23.75, 8, 15.75], min: [-11.875, 0, -7.875], max: [11.875, 8, 7.875],
  });
});

it('renders with the cached procedural corrugate materials', () => {
  const carton = createBoxMesh(skuById('SKU-MS'));
  const meshes: Mesh[] = [];
  carton.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
  expect(meshes).toHaveLength(1);
  expect(meshes[0].material).toEqual(getBoxMaterials(skuById('SKU-MS')));
  expect(meshes[0].material).not.toBe(getBoxMaterials(skuById('SKU-MS'))); // per-mesh array, shared materials
  expect(meshes[0].castShadow && meshes[0].receiveShadow).toBe(true);
});

it('squashes a crushed carton to 92% height, staying a hairline inside its grid footprint', () => {
  // Fragile Small 10 × 8 × 6 renders 9.75 × 7.75; each side bulges (under 1.03) until 1/64" short of its grid lines.
  const fragile = bounds(createBoxMesh(skuById('SKU-FS'), { crushed: true }));
  expect(fragile.size).toEqual([9.9688, 5.52, 7.9688]);
  expect(fragile.min[1]).toBe(0);
  const heavy = bounds(createBoxMesh(skuById('SKU-HF'), { crushed: true }));
  expect(heavy.size).toEqual([23.9688, 7.36, 15.9688]);
});

it('sinks the top and bows the sides of a crushed carton', () => {
  const hit = (object: Object3D, origin: Vector3, direction: Vector3) => {
    object.updateMatrixWorld(true);
    return new Raycaster(origin, direction).intersectObject(object, true)[0].point;
  };
  const down = new Vector3(0, -1, 0);
  const left = new Vector3(-1, 0, 0);
  const intact = createBoxMesh(skuById('SKU-HC'));
  expect(hit(intact, new Vector3(0, 50, 0), down).y).toBeCloseTo(12);
  expect(hit(intact, new Vector3(50, 6, 0), left).x).toBeCloseTo(7.875);

  const crushed = createBoxMesh(skuById('SKU-HC'), { crushed: true });
  const center = hit(crushed, new Vector3(0, 50, 0), down).y;
  const nearCorner = hit(crushed, new Vector3(7, 50, 7), down).y;
  expect(nearCorner).toBeGreaterThan(10.9);
  expect(center).toBeLessThan(nearCorner - 0.25);
  const waist = hit(crushed, new Vector3(50, 5.5, 0), left).x;
  const base = hit(crushed, new Vector3(50, 0.2, 0), left).x;
  expect(waist).toBeGreaterThan(base + 0.1);
  expect(waist).toBeLessThan(8);
});

it('eases into and out of the crushed shape instead of snapping', () => {
  const carton = createBoxMesh(skuById('SKU-HC'));
  carton.crushed = true;
  expect(bounds(carton).size[1]).toBe(12);
  carton.update(0.05);
  const midway = bounds(carton).size[1];
  expect(midway).toBeLessThan(12);
  expect(midway).toBeGreaterThan(11.04);
  carton.update(1);
  expect(bounds(carton).size[1]).toBe(11.04);
  carton.crushed = false;
  carton.update(1);
  expect(bounds(carton).size).toEqual([15.75, 12, 15.75]);
});

it('rolls a flipped carton onto its side: its width becomes its height', () => {
  // Heavy Flat 24 × 16 × 8 flipped stands 16" tall on a 24" × 8" footprint, still inset 1/8" per side.
  expect(bounds(createBoxMesh(skuById('SKU-HF'), { flipped: true }))).toEqual({
    size: [23.75, 16, 7.75], min: [-11.875, 0, -3.875], max: [11.875, 16, 3.875],
  });
  // Crushing squashes the new height and bulges up to 1/64" inside the new footprint.
  expect(bounds(createBoxMesh(skuById('SKU-HF'), { flipped: true, crushed: true })).size).toEqual([23.9688, 14.72, 7.9688]);
});
