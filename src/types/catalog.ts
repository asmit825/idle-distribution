/** Mirror of `crates/pallet_sim/src/sku.rs` (SPEC-01 §2.2). Parity is enforced by catalog.test.ts. */

export type TapeType = 'reinforced' | 'paper' | 'pressure_sensitive_clear' | 'pressure_sensitive_tan';

/** Handling class; drives markings and the Mode 1 heavy-on-light rule. */
export type HandlingClass = 'heavy' | 'medium' | 'light' | 'fragile';

export type SkuId = typeof SKU_CATALOG[number]['id'];

export interface SkuDef {
  readonly id: string;
  readonly name: string;
  readonly length_in: number;
  readonly width_in: number;
  readonly height_in: number;
  /** Footprint in 2" cells along the case length. */
  readonly cells_x: number;
  /** Footprint in 2" cells along the case width. */
  readonly cells_y: number;
  readonly weight_lbs: number;
  readonly top_load_capacity_lbs: number;
  readonly tape: TapeType;
  readonly handling: HandlingClass;
}

export const SKU_CATALOG = [
  { id: 'SKU-HC', name: 'Heavy Cube', length_in: 16, width_in: 16, height_in: 12, cells_x: 8, cells_y: 8, weight_lbs: 45, top_load_capacity_lbs: 250, tape: 'reinforced', handling: 'heavy' },
  { id: 'SKU-HF', name: 'Heavy Flat', length_in: 24, width_in: 16, height_in: 8, cells_x: 12, cells_y: 8, weight_lbs: 40, top_load_capacity_lbs: 220, tape: 'reinforced', handling: 'heavy' },
  { id: 'SKU-MS', name: 'Medium Standard', length_in: 20, width_in: 12, height_in: 10, cells_x: 10, cells_y: 6, weight_lbs: 24, top_load_capacity_lbs: 100, tape: 'pressure_sensitive_tan', handling: 'medium' },
  { id: 'SKU-ML', name: 'Medium Long', length_in: 24, width_in: 10, height_in: 8, cells_x: 12, cells_y: 5, weight_lbs: 20, top_load_capacity_lbs: 90, tape: 'paper', handling: 'medium' },
  { id: 'SKU-MQ', name: 'Medium Square', length_in: 12, width_in: 12, height_in: 10, cells_x: 6, cells_y: 6, weight_lbs: 18, top_load_capacity_lbs: 80, tape: 'pressure_sensitive_clear', handling: 'medium' },
  { id: 'SKU-LT', name: 'Light Tall', length_in: 16, width_in: 12, height_in: 15, cells_x: 8, cells_y: 6, weight_lbs: 10, top_load_capacity_lbs: 30, tape: 'paper', handling: 'light' },
  { id: 'SKU-LB', name: 'Light Bulky', length_in: 20, width_in: 16, height_in: 12, cells_x: 10, cells_y: 8, weight_lbs: 8, top_load_capacity_lbs: 25, tape: 'pressure_sensitive_clear', handling: 'light' },
  { id: 'SKU-FS', name: 'Fragile Small', length_in: 10, width_in: 8, height_in: 6, cells_x: 5, cells_y: 4, weight_lbs: 4, top_load_capacity_lbs: 15, tape: 'paper', handling: 'fragile' },
] as const satisfies readonly SkuDef[];

export function skuById(id: SkuId): SkuDef {
  return SKU_CATALOG.find(sku => sku.id === id)!;
}
