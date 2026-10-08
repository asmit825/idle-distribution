use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::grid::{Placement, PlacementError, Rejection};
use crate::mode1::{EndReason, Phase, Shift, ShiftError};
use crate::mode2::{ConveyorError, Difficulty, ConveyorRound, ConveyorStatus};
use crate::physics::{CaseId, MoveError, Pallet, RemoveError};
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

/// Free placement outside any round, a floor-staging shift, or a conveyor-survival round.
#[derive(Debug)]
enum Mode {
    FreePlacement(Pallet),
    Mode1(Shift),
    Mode2(ConveyorRound),
}

impl Default for Mode {
    fn default() -> Mode {
        Mode::FreePlacement(Pallet::default())
    }
}

impl Mode {
    fn pallet(&self) -> &Pallet {
        match self {
            Mode::FreePlacement(pallet) => pallet,
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
            Mode::FreePlacement(pallet) => pallet.validate(&placement),
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
            Mode::FreePlacement(pallet) => {
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

    /// Where exposed case `case_id` would settle if moved, judged as if it were already lifted.
    pub fn validate_move(
        &self,
        case_id: CaseId,
        grid_x: i32,
        grid_y: i32,
        rot_z: u16,
        flipped: bool,
    ) -> Result<JsValue, JsError> {
        let placement = self.move_target(case_id, grid_x, grid_y, rot_z, flipped)?;
        let check = match &self.mode {
            Mode::Mode1(shift) => shift.validate_move(case_id, &placement),
            Mode::FreePlacement(pallet) => pallet.validate_move(case_id, &placement),
            Mode::Mode2(round) => round.pallet().validate_move(case_id, &placement),
        };
        to_js(&check.map_err(|error| not_movable(case_id, error))?)
    }

    /// Moves an exposed case on the pallet, or throws if the move is invalid. It keeps its id.
    pub fn move_placement(
        &mut self,
        case_id: CaseId,
        grid_x: i32,
        grid_y: i32,
        rot_z: u16,
        flipped: bool,
        now_ms: Option<f64>,
    ) -> Result<JsValue, JsError> {
        let placement = self.move_target(case_id, grid_x, grid_y, rot_z, flipped)?;
        let now_ms = now_ms.unwrap_or(f64::NEG_INFINITY);
        match &mut self.mode {
            Mode::FreePlacement(pallet) => {
                pallet
                    .relocate(case_id, placement)
                    .map_err(|error| match error {
                        MoveError::Rejected(rejection) => rejected(rejection),
                        MoveError::NotFound => not_movable(case_id, RemoveError::NotFound),
                        MoveError::Supporting => not_movable(case_id, RemoveError::Supporting),
                    })?
            }
            Mode::Mode1(shift) => shift
                .relocate(case_id, placement, now_ms)
                .map_err(shift_error)?,
            Mode::Mode2(round) => round
                .relocate(case_id, placement, now_ms)
                .map_err(conveyor_error)?,
        }
        self.get_snapshot()
    }

    /// Removes an exposed case, updating the round to the action time before changing the load.
    pub fn remove_placement(
        &mut self,
        case_id: CaseId,
        now_ms: Option<f64>,
    ) -> Result<JsValue, JsError> {
        let result = match &mut self.mode {
            Mode::FreePlacement(pallet) => pallet.remove(case_id),
            Mode::Mode1(shift) => {
                shift.tick(now_ms.unwrap_or(f64::NEG_INFINITY));
                if shift.phase() == Phase::Complete {
                    return Err(JsError::new("the shift is over"));
                }
                shift.remove(case_id)
            }
            Mode::Mode2(round) => {
                round.tick(now_ms.unwrap_or(f64::NEG_INFINITY));
                if round.status().end_reason.is_some() {
                    return Err(JsError::new("the conveyor round is over"));
                }
                round.remove(case_id)
            }
        };
        result.map_err(|error| not_movable(case_id, error))?;
        self.get_snapshot()
    }

    /// Case `case_id`'s SKU at a new grid anchor and orientation.
    fn move_target(
        &self,
        case_id: CaseId,
        grid_x: i32,
        grid_y: i32,
        rot_z: u16,
        flipped: bool,
    ) -> Result<Placement, JsError> {
        let case = self
            .mode
            .pallet()
            .case(case_id)
            .ok_or_else(|| not_movable(case_id, RemoveError::NotFound))?;
        parse_placement(case.placement.sku.id, grid_x, grid_y, rot_z, flipped)
    }

    pub fn get_snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&EngineSnapshot::of(&self.mode))
    }

    /// Starts a Mode 1 shift on an empty pallet, its floor spawned from `seed` (SPEC-01 §5.1).
    /// A `sandbox` shift has no clock and keeps dealing waves until the pallet ships.
    pub fn start_mode1(&mut self, seed: u64, sandbox: Option<bool>) -> Result<JsValue, JsError> {
        let shift = Shift::new(seed);
        self.mode = Mode::Mode1(if sandbox.unwrap_or(false) { shift.sandbox() } else { shift });
        self.get_snapshot()
    }

    /// Starts Dock Survival immediately, at the caller's monotonic timestamp.
    /// `difficulty` is "easy", "medium" (the default) or "hard". On a `sandbox` line, arrivals
    /// pause while recirculation is full instead of diverting, so it never stops.
    pub fn start_mode2(
        &mut self,
        seed: u64,
        now_ms: f64,
        difficulty: Option<String>,
        sandbox: Option<bool>,
    ) -> Result<JsValue, JsError> {
        let difficulty = match difficulty.as_deref() {
            None => Difficulty::Medium,
            Some(name) => Difficulty::parse(name).ok_or_else(|| JsError::new("difficulty must be easy, medium or hard"))?,
        };
        let round = ConveyorRound::with_difficulty(seed, now_ms, difficulty);
        self.mode = Mode::Mode2(if sandbox.unwrap_or(false) { round.sandbox() } else { round });
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

    /// The shift's arrived floor cases, in id order, as `{ id, sku_id, yaw, on_floor }`; empty
    /// outside Mode 1. Cases of later waves are left out until they arrive.
    pub fn floor_cases(&self) -> Result<JsValue, JsError> {
        let floor: Vec<FloorCaseDto> = match &self.mode {
            Mode::FreePlacement(_) | Mode::Mode2(_) => Vec::new(),
            Mode::Mode1(shift) => shift
                .released()
                .iter()
                .map(|case| FloorCaseDto {
                    id: case.id,
                    sku_id: case.sku.id,
                    yaw: case.yaw_deg,
                    on_floor: shift.is_on_floor(case.id),
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
            Mode::FreePlacement(_) => Err(JsError::new("no shift is running")),
        }
    }

    /// Advances the shift clock to `now_ms` and returns the shift status; null outside Mode 1.
    pub fn tick(&mut self, now_ms: f64) -> Result<JsValue, JsError> {
        match &mut self.mode {
            Mode::FreePlacement(_) | Mode::Mode2(_) => Ok(JsValue::NULL),
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
            Mode::FreePlacement(_) => return Err(JsError::new("no shift is running")),
        }
        self.get_snapshot()
    }
}

fn conveyor_error(error: ConveyorError) -> JsError {
    match error {
        ConveyorError::RoundOver => JsError::new("the conveyor round is over"),
        ConveyorError::NotOnFinalRun => JsError::new("only cartons on the final run can be picked"),
        ConveyorError::NotHeld => JsError::new("drop the case that was picked"),
        ConveyorError::EmptyPallet => JsError::new("place at least one case before shipping"),
        ConveyorError::NotMovable => JsError::new("only exposed cases on the pallet can move"),
        ConveyorError::Rejected(rejection) => rejected(rejection),
    }
}

fn not_movable(case_id: CaseId, error: RemoveError) -> JsError {
    match error {
        RemoveError::NotFound => JsError::new(&format!("no case {case_id}")),
        RemoveError::Supporting => {
            JsError::new(&format!("case {case_id} is supporting another case"))
        }
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
        ShiftError::NotMovable => JsError::new("only exposed cases on the pallet can move"),
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
    crush_penalty: f64,
    overhang_penalty: f64,
    drift_penalty: f64,
    interlock_bonus: f64,
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
    /// Waiting on the floor, rather than on the pallet.
    on_floor: bool,
}

#[derive(Serialize)]
struct ShiftDto {
    /// Decimal, since a u64 outgrows a JS number.
    seed: String,
    /// No clock, and the floor refills wave after wave until the pallet ships.
    sandbox: bool,
    phase: Phase,
    /// The full shift throughout a sandbox shift.
    time_remaining_ms: u32,
    /// Since the first pick; frozen once complete.
    elapsed_ms: u32,
    /// The floor wave, from 1; each brings up to 25 cases.
    wave: u32,
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
            sandbox: shift.is_sandbox(),
            phase: shift.phase(),
            time_remaining_ms: shift.time_remaining_ms(),
            elapsed_ms: shift.elapsed_ms(),
            wave: shift.wave(),
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
            crush_penalty: score.crush_penalty,
            overhang_penalty: score.overhang_penalty,
            drift_penalty: score.drift_penalty,
            interlock_bonus: score.interlock_bonus,
            composite_score: score.composite_score,
            grade: match mode {
                Mode::Mode2(round) => round.grade(),
                _ => score.grade,
            },
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
                Mode::FreePlacement(_) | Mode::Mode2(_) => None,
                Mode::Mode1(shift) => Some(ShiftDto::of(shift)),
            },
            mode2: match mode {
                Mode::Mode2(round) => Some(round.status()),
                _ => None,
            },
        }
    }
}
