use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::grid::{Placement, PlacementError, Rejection};
use crate::mode1::{EndReason, Phase, Shift, ShiftError};
use crate::mode2::{ConveyorError, ConveyorRound, ConveyorStatus};
use crate::physics::{CaseId, Pallet, RemoveError};
use crate::scoring::Grade;

pub mod grid;
pub mod mode1;
pub mod mode2;
pub mod physics;
pub mod scoring;
pub mod sku;

/// Main-thread entry point for the pallet simulation. Every call is synchronous.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    mode: Mode,
}

/// Free placement, a timed floor-staging shift, or a conveyor-survival round.
#[derive(Debug)]
enum Mode {
    Sandbox(Pallet),
    Mode1(Shift),
    Mode2(ConveyorRound),
}

impl Default for Mode {
    fn default() -> Mode {
        Mode::Sandbox(Pallet::default())
    }
}

impl Mode {
    fn pallet(&self) -> &Pallet {
        match self {
            Mode::Sandbox(pallet) => pallet,
            Mode::Mode1(shift) => shift.pallet(),
            Mode::Mode2(round) => round.pallet(),
        }
    }
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
        to_js(&match &self.mode {
            Mode::Sandbox(pallet) => pallet.validate(&placement),
            Mode::Mode1(shift) => shift.validate(&placement),
            Mode::Mode2(round) => round.validate(&placement),
        })
    }

    /// Places a case, or throws if invalid. During a round this places the picked inventory
    /// case at the latest timestamp seen by the corresponding tick call.
    pub fn commit_placement(
        &mut self,
        sku_id: &str,
        grid_x: i32,
        grid_y: i32,
        rot_z: u16,
        flipped: bool,
    ) -> Result<JsValue, JsError> {
        let placement = parse_placement(sku_id, grid_x, grid_y, rot_z, flipped)?;
        match &mut self.mode {
            Mode::Sandbox(pallet) => {
                pallet.commit(placement).map_err(rejected)?;
            }
            Mode::Mode1(shift) => {
                // Timestamps only move the clock forward, so this lands at the latest one.
                shift
                    .place(placement, f64::NEG_INFINITY)
                    .map_err(shift_error)?;
            }
            Mode::Mode2(round) => {
                round
                    .place(placement, f64::NEG_INFINITY)
                    .map_err(conveyor_error)?;
            }
        }
        self.get_snapshot()
    }

    /// Removes a case with nothing resting on it. Not during a shift.
    pub fn remove_placement(&mut self, case_id: CaseId) -> Result<JsValue, JsError> {
        let Mode::Sandbox(pallet) = &mut self.mode else {
            return Err(JsError::new("cases cannot leave the pallet during a shift"));
        };
        pallet.remove(case_id).map_err(|error| match error {
            RemoveError::NotFound => JsError::new(&format!("no case {case_id}")),
            RemoveError::Supporting => {
                JsError::new(&format!("case {case_id} is supporting another case"))
            }
        })?;
        self.get_snapshot()
    }

    pub fn get_snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&EngineSnapshot::of(&self.mode))
    }

    /// Starts a Mode 1 shift on an empty pallet, its floor spawned from `seed` (SPEC-01 §5.1).
    pub fn start_mode1(&mut self, seed: u64) -> Result<JsValue, JsError> {
        self.mode = Mode::Mode1(Shift::new(seed));
        self.get_snapshot()
    }

    /// Starts Dock Survival immediately, at the caller's monotonic timestamp.
    pub fn start_mode2(&mut self, seed: u64, now_ms: f64) -> Result<JsValue, JsError> {
        self.mode = Mode::Mode2(ConveyorRound::new(seed, now_ms));
        self.get_snapshot()
    }

    /// Advances conveyor arrivals and returns telemetry; null outside Mode 2.
    pub fn tick_mode2(&mut self, now_ms: f64) -> Result<JsValue, JsError> {
        let Mode::Mode2(round) = &mut self.mode else {
            return Ok(JsValue::NULL);
        };
        round.tick(now_ms);
        to_js(&round.status())
    }

    /// The shift's floor inventory, in id order, as `{ id, sku_id, yaw }`; empty outside Mode 1.
    pub fn floor_cases(&self) -> Result<JsValue, JsError> {
        let floor: Vec<FloorCaseDto> = match &self.mode {
            Mode::Sandbox(_) | Mode::Mode2(_) => Vec::new(),
            Mode::Mode1(shift) => shift
                .floor()
                .iter()
                .map(|case| FloorCaseDto {
                    id: case.id,
                    sku_id: case.sku.id,
                    yaw: case.yaw_deg,
                })
                .collect(),
        };
        to_js(&floor)
    }

    /// Picks an inventory case at `now_ms`: any floor case in Mode 1, only the FIFO head in Mode 2.
    pub fn pick_case(&mut self, floor_id: u32, now_ms: f64) -> Result<(), JsError> {
        match &mut self.mode {
            Mode::Mode1(shift) => shift.pick(floor_id, now_ms).map_err(shift_error),
            Mode::Mode2(round) => round.pick(floor_id, now_ms).map_err(conveyor_error),
            Mode::Sandbox(_) => Err(JsError::new("no shift is running")),
        }
    }

    /// Advances the shift clock to `now_ms` and returns the shift status; null outside Mode 1.
    pub fn tick(&mut self, now_ms: f64) -> Result<JsValue, JsError> {
        match &mut self.mode {
            Mode::Sandbox(_) | Mode::Mode2(_) => Ok(JsValue::NULL),
            Mode::Mode1(shift) => {
                shift.tick(now_ms);
                to_js(&ShiftDto::of(shift))
            }
        }
    }

    /// Ships the pallet, ending the shift.
    pub fn ship(&mut self, now_ms: f64) -> Result<JsValue, JsError> {
        match &mut self.mode {
            Mode::Mode1(shift) => shift.ship(now_ms),
            Mode::Mode2(round) => round.ship(now_ms).map_err(conveyor_error)?,
            Mode::Sandbox(_) => return Err(JsError::new("no shift is running")),
        }
        self.get_snapshot()
    }
}

fn conveyor_error(error: ConveyorError) -> JsError {
    match error {
        ConveyorError::RoundOver => JsError::new("the conveyor round is over"),
        ConveyorError::NotAtPickSpur => {
            JsError::new("only the oldest case at the pick spur can be picked")
        }
        ConveyorError::NotHeld => JsError::new("drop the case that was picked"),
        ConveyorError::HeightNotReached => JsError::new("reach the 60 inch target before shipping"),
        ConveyorError::Rejected(rejection) => rejected(rejection),
    }
}

fn rejected(rejection: Rejection) -> JsError {
    JsError::new(&format!("placement rejected: {}", rejection.as_str()))
}

fn shift_error(error: ShiftError) -> JsError {
    match error {
        ShiftError::ShiftOver => JsError::new("the shift is over"),
        ShiftError::NotOnFloor => JsError::new("that case is not on the floor"),
        ShiftError::NotHeld => JsError::new("drop the case that was picked"),
        ShiftError::Rejected(rejection) => rejected(rejection),
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
    /// The Mode 1 shift; null outside Mode 1.
    mode1: Option<ShiftDto>,
    mode2: Option<ConveyorStatus>,
}

#[derive(Serialize)]
struct FloorCaseDto {
    id: u32,
    sku_id: &'static str,
    yaw: u16,
}

#[derive(Serialize)]
struct ShiftDto {
    /// Decimal, since a u64 outgrows a JS number.
    seed: String,
    phase: Phase,
    time_remaining_ms: u32,
    cases_on_floor: u32,
    end_reason: Option<EndReason>,
    /// Set once the shift is complete.
    early_finish_bonus: Option<u32>,
    /// Composite score plus the early finish bonus, once complete.
    final_score: Option<u32>,
}

impl ShiftDto {
    fn of(shift: &Shift) -> ShiftDto {
        let result = shift.result();
        ShiftDto {
            seed: shift.seed().to_string(),
            phase: shift.phase(),
            time_remaining_ms: shift.time_remaining_ms(),
            cases_on_floor: shift.cases_on_floor(),
            end_reason: shift.end_reason(),
            early_finish_bonus: result.map(|result| result.early_finish_bonus),
            final_score: result.map(|result| result.final_score),
        }
    }
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
    fn of(mode: &Mode) -> EngineSnapshot {
        let pallet = mode.pallet();
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
            mode1: match mode {
                Mode::Sandbox(_) | Mode::Mode2(_) => None,
                Mode::Mode1(shift) => Some(ShiftDto::of(shift)),
            },
            mode2: match mode {
                Mode::Mode2(round) => Some(round.status()),
                _ => None,
            },
        }
    }
}
