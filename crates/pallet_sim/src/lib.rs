use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::grid::{Placement, PlacementError};
use crate::physics::{CaseId, Pallet, RemoveError};
use crate::scoring::Grade;

pub mod grid;
pub mod physics;
pub mod scoring;
pub mod sku;

/// Main-thread entry point for the pallet simulation. Every call is synchronous.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    pallet: Pallet,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine::default()
    }

    pub fn ping(&self) -> String {
        format!("v{}", env!("CARGO_PKG_VERSION"))
    }

    /// Where the case would settle and whether it may drop there; the pallet is unchanged.
    pub fn validate_placement(
        &self,
        sku_id: &str,
        grid_x: i32,
        grid_y: i32,
        rot_z: u16,
        flipped: bool,
    ) -> Result<JsValue, JsError> {
        let placement = parse_placement(sku_id, grid_x, grid_y, rot_z, flipped)?;
        to_js(&self.pallet.validate(&placement))
    }

    /// Places the case, or throws if the placement is invalid.
    pub fn commit_placement(
        &mut self,
        sku_id: &str,
        grid_x: i32,
        grid_y: i32,
        rot_z: u16,
        flipped: bool,
    ) -> Result<JsValue, JsError> {
        let placement = parse_placement(sku_id, grid_x, grid_y, rot_z, flipped)?;
        self.pallet.commit(placement).map_err(|rejection| {
            JsError::new(&format!("placement rejected: {}", rejection.as_str()))
        })?;
        self.get_snapshot()
    }

    /// Removes a case with nothing resting on it.
    pub fn remove_placement(&mut self, case_id: CaseId) -> Result<JsValue, JsError> {
        self.pallet.remove(case_id).map_err(|error| match error {
            RemoveError::NotFound => JsError::new(&format!("no case {case_id}")),
            RemoveError::Supporting => {
                JsError::new(&format!("case {case_id} is supporting another case"))
            }
        })?;
        self.get_snapshot()
    }

    pub fn get_snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&EngineSnapshot::of(&self.pallet))
    }
}

/// The SKU catalog as plain JS objects, for parity with `src/types/catalog.ts`.
#[wasm_bindgen]
pub fn sku_catalog() -> Result<JsValue, JsValue> {
    Ok(serde_wasm_bindgen::to_value(sku::catalog())?)
}

fn parse_placement(
    sku_id: &str,
    grid_x: i32,
    grid_y: i32,
    rot_z: u16,
    flipped: bool,
) -> Result<Placement, JsError> {
    Placement::new(sku_id, grid_x, grid_y, rot_z, flipped).map_err(|error| match error {
        PlacementError::UnknownSku => JsError::new(&format!("unknown SKU {sku_id}")),
        PlacementError::OffPallet => {
            JsError::new(&format!("grid cell ({grid_x}, {grid_y}) is off the pallet"))
        }
        PlacementError::InvalidYaw => {
            JsError::new(&format!("yaw must be 0, 90, 180, or 270 (got {rot_z})"))
        }
    })
}

/// Plain objects, with `None` as `null`.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsError::new(&error.to_string()))
}

/// What React reads to render the pallet and HUD (SPEC-01 §3.1).
#[derive(Serialize)]
struct EngineSnapshot {
    cases_placed: u32,
    total_weight_lbs: u32,
    max_height_inches: i32,
    volume_utilization_pct: f64,
    max_overhang_inches: i32,
    cog_inches: (f64, f64),
    cog_drift_inches: f64,
    crushed_count: u32,
    quality_pct: f64,
    composite_score: u32,
    grade: Grade,
    placed_cases: Vec<PlacedCaseDto>,
}

/// Field names follow the stored `PlacedCaseSnapshot` (SPEC-01 §4.2).
#[derive(Serialize)]
struct PlacedCaseDto {
    id: CaseId,
    sku_id: &'static str,
    grid_x: i32,
    grid_y: i32,
    elevation_z: i32,
    rotation_yaw: u16,
    flipped: bool,
    crushed: bool,
    weight_lbs: u32,
    load_lbs: f64,
}

impl EngineSnapshot {
    fn of(pallet: &Pallet) -> EngineSnapshot {
        let score = scoring::evaluate(pallet);
        let cases = pallet.cases();
        EngineSnapshot {
            cases_placed: score.cases_placed,
            total_weight_lbs: score.total_weight_lbs,
            max_height_inches: score.max_height_in,
            volume_utilization_pct: score.volume_utilization_pct,
            max_overhang_inches: score.max_overhang_in,
            cog_inches: score.cog_in,
            cog_drift_inches: score.cog_drift_in,
            crushed_count: score.crushed_count,
            quality_pct: score.quality_pct,
            composite_score: score.composite_score,
            grade: score.grade,
            placed_cases: cases
                .iter()
                .map(|case| PlacedCaseDto {
                    id: case.id,
                    sku_id: case.placement.sku.id,
                    grid_x: case.placement.grid_x,
                    grid_y: case.placement.grid_y,
                    elevation_z: case.elevation_in,
                    rotation_yaw: case.placement.yaw_deg,
                    flipped: case.placement.flipped,
                    crushed: case.crushed,
                    weight_lbs: case.placement.sku.weight_lbs,
                    load_lbs: case.load_lbs,
                })
                .collect(),
        }
    }
}
