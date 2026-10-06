import type { Yaw } from '../scene/coordinates';
import type { SkuId } from './catalog';

/** Shapes returned by the Wasm `Engine` (crates/pallet_sim/src/lib.rs), which wasm-bindgen types as `any`. */

export type PlacementStatus = 'valid' | 'warning' | 'invalid';
export type Rejection = 'above_ceiling' | 'excess_overhang' | 'unsupported' | 'heavy_on_light';

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
  /** The Mode 1 shift; null in the sandbox. */
  mode1: ShiftStatus | null;
}

/** A Mode 1 floor case as the seed spawned it. Its floor position is the UI's layout. */
export interface FloorCase {
  id: number;
  sku_id: SkuId;
  /** 0: length along X; 90: along Z. */
  yaw: 0 | 90;
}

export type ShiftPhase = 'staged' | 'running' | 'complete';
export type ShiftEnd = 'time_up' | 'shipped' | 'all_placed';

/** The Mode 1 shift (SPEC-01 §5.1). */
export interface ShiftStatus {
  /** The 64-bit seed, in decimal. */
  seed: string;
  /** `staged` until the first pick starts the clock. */
  phase: ShiftPhase;
  time_remaining_ms: number;
  cases_on_floor: number;
  end_reason: ShiftEnd | null;
  /** Set once complete. */
  early_finish_bonus: number | null;
  /** Composite score plus the early finish bonus, once complete. */
  final_score: number | null;
}

/** The synchronous engine calls the UI makes. The generated `Engine` class satisfies it. */
export interface PalletEngine {
  validate_placement(skuId: string, gridX: number, gridY: number, yaw: number, flipped: boolean): Validation;
  /** Throws `placement rejected: <reason>` when the placement is invalid. */
  commit_placement(skuId: string, gridX: number, gridY: number, yaw: number, flipped: boolean): EngineSnapshot;
  get_snapshot(): EngineSnapshot;
}

/** The Mode 1 shift calls. Times are `performance.now()` milliseconds. */
export interface ShiftEngine extends PalletEngine {
  /** Starts a fresh shift on an empty pallet. */
  start_mode1(seed: bigint): EngineSnapshot;
  floor_cases(): FloorCase[];
  /** Lifts a floor case; the first pick starts the clock. Throws once the shift is over. */
  pick_case(floorId: number, nowMs: number): void;
  /** Advances the clock; null outside Mode 1. */
  tick(nowMs: number): ShiftStatus | null;
  ship(nowMs: number): EngineSnapshot;
}
