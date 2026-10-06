import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SRGBColorSpace, type MeshStandardMaterial, type Texture } from 'three';
import { SKU_CATALOG, skuById } from '../types/catalog';
import { disposeBoxMaterials, getBoxMaterials } from './materials';

beforeEach(() => {
  // A real Skia-backed 2D canvas stands in for the browser's.
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
});
afterEach(() => {
  disposeBoxMaterials();
  vi.unstubAllGlobals();
});

const size = (texture: Texture | null) => {
  const image = texture!.image as Canvas;
  return [image.width, image.height];
};

it('gives each face of Heavy Flat a canvas matching that rendered face in inches', () => {
  // 24 × 16 × 8 nominal renders 23.75 × 15.75 × 8 (1/8" seam per side).
  // BoxGeometry face order: +X, −X (width × height), +Y, −Y (length × width), +Z, −Z (length × height).
  const faces = getBoxMaterials(skuById('SKU-HF')).map(material => size(material.map));
  expect(faces).toEqual([[504, 256], [504, 256], [760, 504], [760, 504], [760, 256], [760, 256]]);
});

it('textures every SKU at one uniform pixel density, so no face is stretched', () => {
  for (const nominal of SKU_CATALOG) {
    const sku = { ...nominal, length_in: nominal.length_in - 0.25, width_in: nominal.width_in - 0.25 };
    const faceInches = [
      [sku.width_in, sku.height_in], [sku.width_in, sku.height_in],
      [sku.length_in, sku.width_in], [sku.length_in, sku.width_in],
      [sku.length_in, sku.height_in], [sku.length_in, sku.height_in],
    ];
    getBoxMaterials(nominal).forEach((material, face) => {
      const [width, height] = size(material.map);
      expect(width / faceInches[face][0]).toBe(32);
      expect(height / faceInches[face][1]).toBe(32);
      expect(size(material.bumpMap)).toEqual([width, height]);
    });
  }
});

it('builds standard materials with color, bump, and roughness maps', () => {
  for (const material of getBoxMaterials(skuById('SKU-MQ'))) {
    expect(material.type).toBe('MeshStandardMaterial');
    expect(material.map!.colorSpace).toBe(SRGBColorSpace);
    expect(material.bumpMap).toBeTruthy();
    expect(material.roughnessMap).toBeTruthy();
  }
});

it('caches materials so identical textures are generated once per SKU', () => {
  const createElement = vi.spyOn(document, 'createElement');
  const first = getBoxMaterials(skuById('SKU-LT'));
  const canvasesCreated = createElement.mock.calls.length;
  expect(getBoxMaterials(skuById('SKU-LT'))).toBe(first);
  expect(createElement.mock.calls.length).toBe(canvasesCreated);
  expect(getBoxMaterials(skuById('SKU-LB'))).not.toBe(first);
});

it('paints deterministically, including the barcode', () => {
  const pixels = (materials: readonly MeshStandardMaterial[]) =>
    materials.map(material => (material.map!.image as Canvas).toBuffer('image/png').toString('base64'));
  const first = pixels(getBoxMaterials(skuById('SKU-HC')));
  disposeBoxMaterials();
  expect(pixels(getBoxMaterials(skuById('SKU-HC')))).toEqual(first);
});

it('releases GPU resources and regenerates after disposal', () => {
  const first = getBoxMaterials(skuById('SKU-FS'));
  const disposed = vi.fn();
  first[0].addEventListener('dispose', disposed);
  first[0].map!.addEventListener('dispose', disposed);
  disposeBoxMaterials();
  expect(disposed).toHaveBeenCalledTimes(2);
  expect(getBoxMaterials(skuById('SKU-FS'))).not.toBe(first);
});
