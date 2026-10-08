import { SKU_CATALOG } from '../types/catalog';
import { orientedSize } from '../scene/coordinates';
import type { Backup, RoundRecord } from './types';

const MAX_UTILIZATION_PCT = 100 * (52 * 44) / (48 * 40);

function requireValue(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid backup: ${field}.`);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected an object');
}
function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, 'numeric field out of range');
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  number(value, min, max); requireValue(Number.isInteger(value), 'expected an integer');
}
function date(value: unknown) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'timestamp');
}
function mode(value: unknown) {
  requireValue(value === 'free_staging_100' || value === 'conveyor_diversion', 'mode');
}
export function validateRound(value: unknown): asserts value is RoundRecord {
  object(value); mode(value.mode); date(value.timestamp);
  requireValue(typeof value.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id), 'round UUID');
  requireValue(typeof value.seed === 'string' && /^\d{1,20}$/.test(value.seed) && BigInt(value.seed) <= 18446744073709551615n, 'u64 seed');
  for (const field of ['duration_ms', 'total_weight_lbs', 'composite_score', 'final_score']) number(value[field]);
  // Utilization is measured against the 48×40 deck, so 2″ overhang on every side can exceed 100%.
  number(value.volume_utilization_pct, 0, MAX_UTILIZATION_PCT);
  for (const field of ['stability_index_pct', 'quality_pct']) number(value[field], 0, 100);
  integer(value.cases_placed, 0, 1000); integer(value.crush_count, 0, value.cases_placed);
  number(value.overhang_inches, 0, 2);
  requireValue(['S', 'A', 'B', 'C', 'F'].includes(String(value.grade)), 'grade');
  requireValue(value.sandbox === undefined || value.sandbox === true, 'sandbox flag');
  const sandbox = value.sandbox === true;
  if (value.mode === 'free_staging_100') {
    // A sandbox shift has no clock to run out, and its endless waves never all get placed.
    requireValue((sandbox ? ['shipped'] : ['time_up', 'shipped', 'all_placed']).includes(String(value.end_reason)), 'shift ending');
    if (!sandbox) number(value.duration_ms, 0, 60000);
  } else {
    // Nothing diverts on a sandbox line, so it can only ship.
    requireValue(value.end_reason === 'shipped' || (!sandbox && value.end_reason === 'estop'), 'conveyor ending');
    integer(value.diversions_count, 0, 5);
    requireValue(typeof value.estop_triggered === 'boolean' && value.estop_triggered === (value.end_reason === 'estop'), 'Estop flag');
  }
  requireValue(Array.isArray(value.pallet_snapshot) && value.pallet_snapshot.length === value.cases_placed, 'snapshot case count');
  const ids = new Set<string>();
  let weight = 0, crushed = 0;
  for (const placed of value.pallet_snapshot) {
    object(placed);
    requireValue(typeof placed.id === 'string' && placed.id.length > 0 && placed.id.length <= 100 && !ids.has(placed.id), 'unique case ID');
    ids.add(placed.id);
    const sku = SKU_CATALOG.find(s => s.id === placed.sku_id);
    requireValue(sku, 'SKU');
    integer(placed.grid_x, -1, 24); integer(placed.grid_y, -1, 20); number(placed.elevation_z, 0, 60);
    requireValue(placed.rotation_yaw === 0 || placed.rotation_yaw === 90 || placed.rotation_yaw === 180 || placed.rotation_yaw === 270, 'rotation');
    requireValue(typeof placed.flipped === 'boolean' && typeof placed.crushed === 'boolean', 'case flags');
    requireValue(placed.weight_lbs === sku.weight_lbs, 'case weight');
    const size = orientedSize(sku, { yaw: placed.rotation_yaw, flipped: placed.flipped });
    requireValue(placed.grid_x * 2 + size.x <= 50 && placed.grid_y * 2 + size.y <= 42 && placed.elevation_z + size.height <= 60, 'case bounds');
    weight += sku.weight_lbs; crushed += Number(placed.crushed);
  }
  requireValue(weight === value.total_weight_lbs && crushed === value.crush_count, 'snapshot totals');
}
export function parseBackup(json: string): Backup {
  const value: unknown = JSON.parse(json);
  object(value);
  requireValue(value.version === 1, 'unsupported schema version');
  requireValue(Array.isArray(value.rounds) && Array.isArray(value.personal_bests), 'rounds and personal bests');
  const ids = new Set<string>();
  for (const round of value.rounds) {
    validateRound(round);
    requireValue(!ids.has(round.id), 'duplicate round UUID'); ids.add(round.id);
  }
  const modes = new Set<unknown>();
  for (const best of value.personal_bests) {
    object(best); mode(best.mode); date(best.achieved_at);
    requireValue(!modes.has(best.mode), 'duplicate personal best'); modes.add(best.mode);
    number(best.high_score); number(best.highest_quality_pct, 0, 100); integer(best.max_cases_placed, 0, 1000);
    if (best.fastest_completion_ms !== undefined) number(best.fastest_completion_ms);
  }
  // All nested records have been checked above. Bests are rebuilt from rounds during import.
  return value as unknown as Backup;
}
