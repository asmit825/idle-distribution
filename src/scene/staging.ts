import { Box3, Vector3 } from 'three';
import { SKU_CATALOG, type SkuDef } from '../types/catalog';
import { FLOOR_Y, PALLET_WIDTH_IN, type Yaw } from './coordinates';

const GAP_IN = 3;

/** A floor bay that holds one carton and refills when it is placed (until Mode 1's staging, ticket 05). */
export interface StagingBay {
  sku: SkuDef;
  yaw: Yaw;
  /** Base-center position in scene inches. */
  position: Vector3;
  /** The carton's volume on the floor. */
  bounds: Box3;
}

/** One carton of each SKU on the floor, lengths along Z: four behind the pallet, four in front. */
export const STAGING_BAYS: readonly StagingBay[] = [SKU_CATALOG.slice(0, 4), SKU_CATALOG.slice(4)].flatMap((row, i) => {
  const side = i === 0 ? -1 : 1;
  let x = -(row.reduce((sum, sku) => sum + sku.width_in, 0) + (row.length - 1) * GAP_IN) / 2;
  return row.map(sku => {
    const position = new Vector3(x + sku.width_in / 2, FLOOR_Y, side * (PALLET_WIDTH_IN / 2 + GAP_IN + sku.length_in / 2));
    x += sku.width_in + GAP_IN;
    const half = new Vector3(sku.width_in / 2, 0, sku.length_in / 2);
    const bounds = new Box3(position.clone().sub(half), position.clone().add(half).setY(FLOOR_Y + sku.height_in));
    return { sku, yaw: 90 as const, position, bounds };
  });
});
