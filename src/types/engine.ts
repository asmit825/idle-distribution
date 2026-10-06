import type { Yaw } from '../scene/coordinates';
import type { SkuId } from './catalog';

/** Shapes returned by the Wasm `Engine` (crates/pallet_sim/src/lib.rs), which wasm-bindgen types as `any`. */

export type PlacementStatus = 'valid' | 'warning' | 'invalid';
export type Rejection = 'above_ceiling' | 'excess_overhang' | 'unsupported';

export interface Validation {
  status: PlacementStatus;
  rejection: Rejection | null;
  elevation_in: number;
  overhang_in: number;
  unsupported_fraction: number;
  would_crush: number;
}

export interface PlacedCase {
  id: number;
  sku_id: SkuId;
  grid_x: number;
  grid_y: number;
  elevation_z: number;
  rotation_yaw: Yaw;
  flipped: boolean;
  crushed: boolean;
  weight_lbs: number;
  load_lbs: number;
}

export interface EngineSnapshot {
  cases_placed: number;
  total_weight_lbs: number;
  max_height_inches: number;
  volume_utilization_pct: number;
  max_overhang_inches: number;
  cog_inches: [number, number];
  cog_drift_inches: number;
  crushed_count: number;
  quality_pct: number;
  composite_score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'F';
  placed_cases: PlacedCase[];
}

/** The synchronous engine calls the UI makes. The generated `Engine` class satisfies it. */
export interface PalletEngine {
  validate_placement(skuId: string, gridX: number, gridY: number, yaw: number, flipped: boolean): Validation;
  /** Throws `placement rejected: <reason>` when the placement is invalid. */
  commit_placement(skuId: string, gridX: number, gridY: number, yaw: number, flipped: boolean): EngineSnapshot;
  get_snapshot(): EngineSnapshot;
}
