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
  crush_penalty: number;
  overhang_penalty: number;
  drift_penalty: number;
  interlock_bonus: number;
  composite_score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'F';
  placed_cases: PlacedCase[];
  /** The Mode 1 shift; null outside Mode 1. */
  mode1: ShiftStatus | null;
  mode2: ConveyorStatus | null;
}

/** A Mode 1 floor case as the seed spawned it. Its floor position is the UI's layout. */
export interface FloorCase {
  id: number;
  sku_id: SkuId;
  /** 0: length along X; 90: along Z. */
  yaw: 0 | 90;
  /** Waiting on the floor, rather than on the pallet. */
  on_floor: boolean;
}

/** Mode 1 floor cases arrive in waves of this many (`WAVE_CASES` in mode1.rs). */
export const WAVE_CASES = 25;

export type ShiftPhase = 'staged' | 'running' | 'complete';
export type ShiftEnd = 'time_up' | 'shipped' | 'all_placed';

/** The Mode 1 shift (SPEC-01 §5.1). */
export interface ShiftStatus {
  /** The 64-bit seed, in decimal. */
  seed: string;
  /** No clock, and the floor refills wave after wave until the pallet ships. */
  sandbox: boolean;
  /** `staged` until the first pick starts the clock. */
  phase: ShiftPhase;
  /** The full 60 s throughout a sandbox shift. */
  time_remaining_ms: number;
  /** Since the first pick; frozen once complete. */
  elapsed_ms: number;
  /** The floor wave, from 1. The next arrives once every case on the floor is placed. */
  wave: number;
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
  remove_placement(caseId: number, nowMs?: number): EngineSnapshot;
  /** Where exposed case `caseId` would settle if moved; throws if it is not exposed. */
  validate_move(caseId: number, gridX: number, gridY: number, yaw: number, flipped: boolean): Validation;
  /** Moves an exposed case, keeping its id; throws `placement rejected: <reason>` when invalid. */
  move_placement(caseId: number, gridX: number, gridY: number, yaw: number, flipped: boolean, nowMs?: number): EngineSnapshot;
}

/** The Mode 1 shift calls. Times are `performance.now()` milliseconds. */
export interface ShiftEngine extends PalletEngine {
  /** Starts a fresh shift on an empty pallet; a sandbox shift has no clock and endless waves. */
  start_mode1(seed: bigint, sandbox?: boolean): EngineSnapshot;
  /** Every floor case that has arrived, waiting or placed, in id order. */
  floor_cases(): FloorCase[];
  /** Lifts a floor case; the first pick starts the clock. Throws once the shift is over. */
  pick_case(floorId: number, nowMs: number): void;
  /** Advances the clock; null outside Mode 1. */
  tick(nowMs: number): ShiftStatus | null;
  ship(nowMs: number): EngineSnapshot;
}


/** Authoritative FIFO arrivals and telemetry from the Mode 2 engine. */
export interface ConveyorCase { id: number; sku_id: SkuId }
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface ConveyorStatus {
  seed: string;
  difficulty: Difficulty;
  /** Arrivals pause while recirculation is full instead of diverting, so the line never stops. */
  sandbox: boolean;
  elapsed_ms: number;
  arrival_interval_ms: number;
  /** Normalized travel of the incoming case; preserved when the line accelerates. */
  arrival_progress: number;
  incoming: ConveyorCase;
  queue: ConveyorCase[];
  /** How many cartons at the front of the queue are on the final run: any of them can be picked. */
  final_run: number;
  signal: 'green' | 'yellow' | 'red';
  diversions_count: number;
  diversions: { case: ConveyorCase; elapsed_ms: number }[];
  end_reason: 'estop' | 'shipped' | null;
  can_ship: boolean;
  /** Cartons beyond the pick lane, on the lane running back the other way; 10 is full. */
  recirculating: number;
  /** Pallet height reached as a percentage of the 60 inch target. */
  fill_pct: number;
  /** Once shipped: the composite score scaled by `fill_pct`. */
  final_score: number | null;
}

export interface ConveyorEngine extends ShiftEngine {
  start_mode2(seed: bigint, nowMs: number, difficulty?: Difficulty, sandbox?: boolean): EngineSnapshot;
  tick_mode2(nowMs: number): ConveyorStatus | null;
}
