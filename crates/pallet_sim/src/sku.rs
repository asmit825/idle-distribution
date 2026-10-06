//! The 8-SKU modular corrugated carton catalog (SPEC-01 §2.2).
//! Mirrored in `src/types/catalog.ts`; field names are the JS wire format.

use serde::Serialize;

/// Grid cell edge length in inches.
pub const CELL_IN: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TapeType {
    /// White cross-weave fiberglass filament in kraft backing.
    Reinforced,
    /// Water-activated gummed kraft paper.
    Paper,
    PressureSensitiveClear,
    PressureSensitiveTan,
}

/// Handling class; drives markings and the Mode 1 heavy-on-light rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HandlingClass {
    Heavy,
    Medium,
    Light,
    Fragile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct SkuDef {
    pub id: &'static str,
    pub name: &'static str,
    pub length_in: u32,
    pub width_in: u32,
    pub height_in: u32,
    /// Footprint in 2" cells along the case length.
    pub cells_x: u32,
    /// Footprint in 2" cells along the case width.
    pub cells_y: u32,
    pub weight_lbs: u32,
    pub top_load_capacity_lbs: u32,
    pub tape: TapeType,
    pub handling: HandlingClass,
}

const fn sku(
    id: &'static str,
    name: &'static str,
    [length_in, width_in, height_in]: [u32; 3],
    weight_lbs: u32,
    top_load_capacity_lbs: u32,
    tape: TapeType,
    handling: HandlingClass,
) -> SkuDef {
    SkuDef {
        id,
        name,
        length_in,
        width_in,
        height_in,
        cells_x: length_in / CELL_IN,
        cells_y: width_in / CELL_IN,
        weight_lbs,
        top_load_capacity_lbs,
        tape,
        handling,
    }
}

#[rustfmt::skip]
const CATALOG: [SkuDef; 8] = [
    sku("SKU-HC", "Heavy Cube", [16, 16, 12], 45, 250, TapeType::Reinforced, HandlingClass::Heavy),
    sku("SKU-HF", "Heavy Flat", [24, 16, 8], 40, 220, TapeType::Reinforced, HandlingClass::Heavy),
    sku("SKU-MS", "Medium Standard", [20, 12, 10], 24, 100, TapeType::PressureSensitiveTan, HandlingClass::Medium),
    sku("SKU-ML", "Medium Long", [24, 10, 8], 20, 90, TapeType::Paper, HandlingClass::Medium),
    sku("SKU-MQ", "Medium Square", [12, 12, 10], 18, 80, TapeType::PressureSensitiveClear, HandlingClass::Medium),
    sku("SKU-LT", "Light Tall", [16, 12, 15], 10, 30, TapeType::Paper, HandlingClass::Light),
    sku("SKU-LB", "Light Bulky", [20, 16, 12], 8, 25, TapeType::PressureSensitiveClear, HandlingClass::Light),
    sku("SKU-FS", "Fragile Small", [10, 8, 6], 4, 15, TapeType::Paper, HandlingClass::Fragile),
];

pub fn catalog() -> &'static [SkuDef] {
    &CATALOG
}

pub fn by_id(id: &str) -> Option<&'static SkuDef> {
    CATALOG.iter().find(|sku| sku.id == id)
}
