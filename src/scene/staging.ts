import { Box3, Vector3 } from 'three';
import { SKU_CATALOG, type SkuDef } from '../types/catalog';
import { FLOOR_Y, orientedSize, PALLET_WIDTH_IN, type Yaw } from './coordinates';

const GAP_IN = 3;

/** A spot on the floor where one carton waits. */
export interface StagingBay {
  /** The Mode 1 floor case id; the bay's index in the sandbox. */
  id: number;
  sku: SkuDef;
  yaw: Yaw;
  /** Base-center position in scene inches. */
  position: Vector3;
  /** The carton's volume on the floor. */
  bounds: Box3;
}

/** An upright carton waiting with its base centered on floor point (x, z), in scene inches. */
export function stagingBay(id: number, sku: SkuDef, yaw: Yaw, x: number, z: number): StagingBay {
  const position = new Vector3(x, FLOOR_Y, z);
  // Domain Y runs along scene Z.
  const size = orientedSize(sku, { yaw, flipped: false });
  const half = new Vector3(size.x / 2, 0, size.y / 2);
  const bounds = new Box3(position.clone().sub(half), position.clone().add(half).setY(FLOOR_Y + size.height));
  return { id, sku, yaw, position, bounds };
}

/** The sandbox floor, refilled after every placement: one carton of each SKU, lengths along Z, four behind the pallet and four in front. */
export const STAGING_BAYS: readonly StagingBay[] = [SKU_CATALOG.slice(0, 4), SKU_CATALOG.slice(4)].flatMap((row, i) => {
  const side = i === 0 ? -1 : 1;
  let x = -(row.reduce((sum, sku) => sum + sku.width_in, 0) + (row.length - 1) * GAP_IN) / 2;
  return row.map((sku, j) => {
    const bay = stagingBay(i * row.length + j, sku, 90, x + sku.width_in / 2, side * (PALLET_WIDTH_IN / 2 + GAP_IN + sku.length_in / 2));
    x += sku.width_in + GAP_IN;
    return bay;
  });
});
