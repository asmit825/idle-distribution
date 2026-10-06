use pallet_sim::sku::{self, HandlingClass, TapeType};

/// Literal rows from SPEC-01 §2.2: id, L, W, H, cells X, cells Y, lbs, top-load lbs, tape, handling class.
#[rustfmt::skip]
type Row = (&'static str, &'static str, u32, u32, u32, u32, u32, u32, u32, TapeType, HandlingClass);

#[rustfmt::skip]
const SPEC_TABLE: [Row; 8] = [
    ("SKU-HC", "Heavy Cube", 16, 16, 12, 8, 8, 45, 250, TapeType::Reinforced, HandlingClass::Heavy),
    ("SKU-HF", "Heavy Flat", 24, 16, 8, 12, 8, 40, 220, TapeType::Reinforced, HandlingClass::Heavy),
    ("SKU-MS", "Medium Standard", 20, 12, 10, 10, 6, 24, 100, TapeType::PressureSensitiveTan, HandlingClass::Medium),
    ("SKU-ML", "Medium Long", 24, 10, 8, 12, 5, 20, 90, TapeType::Paper, HandlingClass::Medium),
    ("SKU-MQ", "Medium Square", 12, 12, 10, 6, 6, 18, 80, TapeType::PressureSensitiveClear, HandlingClass::Medium),
    ("SKU-LT", "Light Tall", 16, 12, 15, 8, 6, 10, 30, TapeType::Paper, HandlingClass::Light),
    ("SKU-LB", "Light Bulky", 20, 16, 12, 10, 8, 8, 25, TapeType::PressureSensitiveClear, HandlingClass::Light),
    ("SKU-FS", "Fragile Small", 10, 8, 6, 5, 4, 4, 15, TapeType::Paper, HandlingClass::Fragile),
];

#[test]
fn catalog_matches_spec_table_in_order() {
    let catalog = sku::catalog();
    assert_eq!(catalog.len(), SPEC_TABLE.len());
    for (sku, &(id, name, l, w, h, cx, cy, lbs, cap, tape, handling)) in
        catalog.iter().zip(SPEC_TABLE.iter())
    {
        assert_eq!(sku.id, id);
        assert_eq!(sku.name, name);
        assert_eq!(
            (sku.length_in, sku.width_in, sku.height_in),
            (l, w, h),
            "{id} dimensions"
        );
        assert_eq!((sku.cells_x, sku.cells_y), (cx, cy), "{id} grid footprint");
        assert_eq!(sku.weight_lbs, lbs, "{id} weight");
        assert_eq!(sku.top_load_capacity_lbs, cap, "{id} top-load capacity");
        assert_eq!(sku.tape, tape, "{id} tape");
        assert_eq!(sku.handling, handling, "{id} handling class");
    }
}

#[test]
fn looks_up_skus_by_id() {
    assert_eq!(sku::by_id("SKU-LT").map(|sku| sku.name), Some("Light Tall"));
    assert!(sku::by_id("SKU-XX").is_none());
}
