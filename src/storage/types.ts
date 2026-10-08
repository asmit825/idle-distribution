import type { SkuId } from '../types/catalog';
import type { Yaw } from '../scene/coordinates';
import type { EngineSnapshot, ShiftEnd } from '../types/engine';

export type RoundMode = 'free_staging_100' | 'conveyor_diversion';
export interface PlacedCaseSnapshot {
  id: string; sku_id: SkuId; grid_x: number; grid_y: number; elevation_z: number;
  rotation_yaw: Yaw; flipped: boolean; crushed: boolean; weight_lbs: number;
}
export interface RoundRecord {
  id: string; timestamp: string; mode: RoundMode; seed: string; duration_ms: number;
  cases_placed: number; total_weight_lbs: number; volume_utilization_pct: number;
  stability_index_pct: number; quality_pct: number; composite_score: number;
  grade: EngineSnapshot['grade']; crush_count: number; overhang_inches: number;
  diversions_count?: number; estop_triggered?: boolean;
  /** Played as a sandbox: kept in the gallery, but never counted toward bests or career stats. */
  sandbox?: true;
  pallet_snapshot: PlacedCaseSnapshot[];
  end_reason: ShiftEnd | 'estop'; final_score: number;
}
export interface PersonalBestRecord {
  mode: RoundMode; high_score: number; highest_quality_pct: number; max_cases_placed: number;
  fastest_completion_ms?: number; achieved_at: string;
}
export interface Backup {
  version: 1; rounds: RoundRecord[]; personal_bests: PersonalBestRecord[];
}
