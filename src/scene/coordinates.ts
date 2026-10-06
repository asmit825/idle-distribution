import { Box3, Vector3 } from 'three';
import { skuById, type SkuDef } from '../types/catalog';
import type { PlacedCase } from '../types/engine';

/**
 * Domain ↔ scene conversion. The engine uses corner-based inches: X along the 48" length,
 * Y along the 40" width, Z up from the top deck. The scene is Y up with the pallet's
 * geometric center at the origin.
 */
export const PALLET_LENGTH_IN = 48;
export const PALLET_WIDTH_IN = 40;
export const CELL_IN = 2;
export const DECK_Y = 2.375;
/** Pallet underside, where floor-staged cartons rest. */
export const FLOOR_Y = -2.375;

/** Degrees; 90 is a quarter turn. */
export type Yaw = 0 | 90 | 180 | 270;

export interface Orientation {
  yaw: Yaw;
  /** Rolled onto its side: the case's width becomes its height. */
  flipped: boolean;
}

/** Footprint along domain X and Y, and height, in inches. Mirrors `Placement` in grid.rs. */
export function orientedSize(sku: SkuDef, { yaw, flipped }: Orientation) {
  const depth = flipped ? sku.height_in : sku.width_in;
  const height = flipped ? sku.width_in : sku.height_in;
  return yaw % 180 === 0 ? { x: sku.length_in, y: depth, height } : { x: depth, y: sku.length_in, height };
}

/** Scene position of a domain point. */
export function toScene(x: number, y: number, elevation: number) {
  return new Vector3(x - PALLET_LENGTH_IN / 2, elevation + DECK_Y, y - PALLET_WIDTH_IN / 2);
}

/** Domain X/Y of a scene position. */
export function toDomain(point: Vector3) {
  return { x: point.x + PALLET_LENGTH_IN / 2, y: point.z + PALLET_WIDTH_IN / 2 };
}

/** The scene volume of a case anchored at a grid cell, at `elevation` inches above the deck. */
export function caseBox(sku: SkuDef, orientation: Orientation, gridX: number, gridY: number, elevation: number) {
  const size = orientedSize(sku, orientation);
  const min = toScene(gridX * CELL_IN, gridY * CELL_IN, elevation);
  return new Box3(min, min.clone().add(new Vector3(size.x, size.height, size.y)));
}

/** The scene volume of a case on the pallet. */
export function placedCaseBox(placed: PlacedCase) {
  const orientation = { yaw: placed.rotation_yaw, flipped: placed.flipped };
  return caseBox(skuById(placed.sku_id), orientation, placed.grid_x, placed.grid_y, placed.elevation_z);
}
