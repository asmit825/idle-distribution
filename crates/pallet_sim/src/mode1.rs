//! Mode 1: 100-Case Free Staging, the 60-second shift rush (SPEC-01 §5.1). The 100 cases
//! reach the floor in waves of 25: the next wave arrives once every case on the floor is placed.
//! A sandbox shift has no clock and no last wave: the floor keeps refilling until the pallet ships.

use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::Serialize;

use crate::grid::{Placement, Rejection, Validation};
use crate::physics::{CaseId, MoveError, Pallet, RemoveError};
use crate::scoring::{self, Score};
use crate::sku::{self, SkuDef};

pub const SHIFT_CASES: usize = 100;
/// Cases per wave on the floor.
pub const WAVE_CASES: usize = 25;
/// The shift countdown, from the first pick.
pub const SHIFT_MS: u32 = 60_000;

/// A case waiting on the warehouse floor. Where it sits is the UI's layout; which SKU it is,
/// and which way it lies, come from the seed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FloorCase {
    pub id: u32,
    pub sku: &'static SkuDef,
    /// 0 or 90: the case's length runs along X or along Z.
    pub yaw_deg: u16,
}

/// The shift's floor inventory, identical on every device for the same seed (SPEC-01 §3.2).
pub fn spawn(seed: u64) -> Vec<FloorCase> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    (0..SHIFT_CASES as u32).map(|id| draw(&mut rng, id)).collect()
}

/// The next case from a seed's supply.
fn draw(rng: &mut ChaCha8Rng, id: u32) -> FloorCase {
    let catalog = sku::catalog();
    FloorCase {
        id,
        // Eight SKUs divide 2³² evenly, so the modulo is unbiased.
        sku: &catalog[rng.next_u32() as usize % catalog.len()],
        yaw_deg: if rng.next_u32() & 1 == 0 { 0 } else { 90 },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Cases on the floor, clock paused until the first pick.
    Staged,
    Running,
    Complete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    TimeUp,
    Shipped,
    /// Every wave placed before time ran out. A sandbox shift never runs out of waves.
    AllPlaced,
}

/// The final evaluation of a completed shift.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShiftResult {
    pub score: Score,
    pub early_finish_bonus: u32,
    /// Composite score plus the early finish bonus.
    pub final_score: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShiftError {
    /// The shift is complete; the floor is closed.
    ShiftOver,
    /// No such floor case, its wave has not arrived, or it is already on the pallet.
    NotOnFloor,
    /// No such placed case, or another rests on it.
    NotMovable,
    /// A drop with no case picked, or of a different SKU than the one picked.
    NotHeld,
    Rejected(Rejection),
}

/// One Mode 1 shift: the floor inventory, the pallet being built, and the shift clock.
#[derive(Debug)]
pub struct Shift {
    seed: u64,
    floor: Vec<FloorCase>,
    /// How many floor cases, in id order, have arrived.
    released: usize,
    on_floor: Vec<bool>,
    pallet: Pallet,
    held: Option<u32>,
    placed_sources: Vec<(CaseId, u32)>,
    /// Deals the sandbox's endless waves once the spawned floor runs out.
    supply: ChaCha8Rng,
    sandbox: bool,
    /// The latest timestamp seen, in the caller's milliseconds (`performance.now()`).
    now_ms: f64,
    started_ms: Option<f64>,
    remaining_ms: u32,
    end: Option<EndReason>,
}

impl Shift {
    pub fn new(seed: u64) -> Shift {
        let mut shift = Shift::with_floor(seed, Vec::new());
        shift.floor = (0..SHIFT_CASES as u32)
            .map(|id| draw(&mut shift.supply, id))
            .collect();
        shift.on_floor = vec![true; SHIFT_CASES];
        shift.released = WAVE_CASES;
        shift
    }

    /// A shift over a given floor, ids `0..floor.len()` in order.
    pub fn with_floor(seed: u64, floor: Vec<FloorCase>) -> Shift {
        Shift {
            seed,
            supply: ChaCha8Rng::seed_from_u64(seed),
            sandbox: false,
            released: floor.len().min(WAVE_CASES),
            on_floor: vec![true; floor.len()],
            floor,
            pallet: Pallet::default(),
            held: None,
            placed_sources: Vec::new(),
            now_ms: f64::NEG_INFINITY,
            started_ms: None,
            remaining_ms: SHIFT_MS,
            end: None,
        }
    }

    /// The same shift without a clock, its floor refilling wave after wave until the pallet ships.
    pub fn sandbox(mut self) -> Shift {
        self.sandbox = true;
        self
    }

    pub fn is_sandbox(&self) -> bool {
        self.sandbox
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// Every case of the shift, arrived or not.
    pub fn floor(&self) -> &[FloorCase] {
        &self.floor
    }

    /// The cases whose wave has arrived, waiting or placed.
    pub fn released(&self) -> &[FloorCase] {
        &self.floor[..self.released]
    }

    /// Whether arrived case `id` is waiting on the floor.
    pub fn is_on_floor(&self, id: u32) -> bool {
        (id as usize) < self.released && self.on_floor[id as usize]
    }

    /// The current wave, from 1.
    pub fn wave(&self) -> u32 {
        self.released.div_ceil(WAVE_CASES) as u32
    }

    pub fn pallet(&self) -> &Pallet {
        &self.pallet
    }

    pub fn cases_on_floor(&self) -> u32 {
        self.on_floor[..self.released]
            .iter()
            .filter(|&&waiting| waiting)
            .count() as u32
    }

    pub fn phase(&self) -> Phase {
        match (self.end, self.started_ms) {
            (Some(_), _) => Phase::Complete,
            (None, Some(_)) => Phase::Running,
            (None, None) => Phase::Staged,
        }
    }

    pub fn end_reason(&self) -> Option<EndReason> {
        self.end
    }

    /// Whole milliseconds left, rounded up, as of the latest timestamp. Frozen once complete;
    /// a sandbox shift always has the full shift left.
    pub fn time_remaining_ms(&self) -> u32 {
        self.remaining_ms
    }

    /// Whole milliseconds since the first pick, as of the latest timestamp. Frozen once complete.
    pub fn elapsed_ms(&self) -> u32 {
        if !self.sandbox {
            return SHIFT_MS - self.remaining_ms;
        }
        self.started_ms
            .map_or(0, |started| (self.now_ms - started).max(0.0) as u32)
    }

    /// Advances the clock to `now_ms`, ending a timed shift at 0:00. Earlier timestamps are ignored.
    pub fn tick(&mut self, now_ms: f64) {
        if self.end.is_some() {
            return;
        }
        self.now_ms = self.now_ms.max(now_ms);
        if self.sandbox {
            return;
        }
        if let Some(started) = self.started_ms {
            let left = (f64::from(SHIFT_MS) - (self.now_ms - started)).max(0.0);
            self.remaining_ms = left.ceil() as u32;
            if self.remaining_ms == 0 {
                self.finish(EndReason::TimeUp);
            }
        }
    }

    /// Lifts floor case `id`. The first pick starts the clock.
    pub fn pick(&mut self, id: u32, now_ms: f64) -> Result<(), ShiftError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ShiftError::ShiftOver);
        }
        if !self.is_on_floor(id) {
            return Err(ShiftError::NotOnFloor);
        }
        self.started_ms.get_or_insert(self.now_ms);
        self.held = Some(id);
        Ok(())
    }

    /// The pallet's verdict. A heavy case may go on a light one; crushing it costs Load Quality.
    pub fn validate(&self, placement: &Placement) -> Validation {
        self.pallet.validate(placement)
    }

    /// The verdict on moving exposed case `case_id` to `placement`, as if it were lifted.
    pub fn validate_move(
        &self,
        case_id: CaseId,
        placement: &Placement,
    ) -> Result<Validation, RemoveError> {
        self.pallet.validate_move(case_id, placement)
    }

    /// Moves an exposed case on the pallet; the floor is unchanged.
    pub fn relocate(
        &mut self,
        case_id: CaseId,
        placement: Placement,
        now_ms: f64,
    ) -> Result<(), ShiftError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ShiftError::ShiftOver);
        }
        self.pallet
            .relocate(case_id, placement)
            .map_err(|error| match error {
                MoveError::Rejected(rejection) => ShiftError::Rejected(rejection),
                MoveError::NotFound | MoveError::Supporting => ShiftError::NotMovable,
            })
    }

    /// Drops the picked case at `placement`; it must be the picked case's SKU.
    pub fn place(&mut self, placement: Placement, now_ms: f64) -> Result<CaseId, ShiftError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ShiftError::ShiftOver);
        }
        let id = self
            .held
            .filter(|&id| self.floor[id as usize].sku == placement.sku)
            .ok_or(ShiftError::NotHeld)?;
        let case = self
            .pallet
            .commit(placement)
            .map_err(ShiftError::Rejected)?;
        self.placed_sources.push((case, id));
        self.on_floor[id as usize] = false;
        self.held = None;
        if self.cases_on_floor() == 0 {
            if self.sandbox && self.released == self.floor.len() {
                for _ in 0..WAVE_CASES {
                    let case = draw(&mut self.supply, self.floor.len() as u32);
                    self.floor.push(case);
                    self.on_floor.push(true);
                }
            }
            if self.released < self.floor.len() {
                self.released = self.floor.len().min(self.released + WAVE_CASES);
            } else {
                self.finish(EndReason::AllPlaced);
            }
        }
        Ok(case)
    }

    /// Returns an exposed carton to its original floor slot. The engine checks the clock first.
    pub fn remove(&mut self, case_id: CaseId) -> Result<(), RemoveError> {
        self.pallet.remove(case_id)?;
        if let Some(index) = self
            .placed_sources
            .iter()
            .position(|(id, _)| *id == case_id)
        {
            let (_, floor_id) = self.placed_sources.remove(index);
            self.on_floor[floor_id as usize] = true;
        }
        Ok(())
    }

    /// Ships the pallet as it stands, ending the shift.
    pub fn ship(&mut self, now_ms: f64) {
        self.tick(now_ms);
        if self.end.is_none() {
            self.finish(EndReason::Shipped);
        }
    }

    /// The final evaluation, once the shift is complete.
    pub fn result(&self) -> Option<ShiftResult> {
        self.end?;
        let score = scoring::evaluate(&self.pallet);
        // SPEC-01 §5.1: Remaining Seconds × 100 × Quality, quality as a fraction, so each second
        // saved is worth a case placed at the same quality.
        let early_finish_bonus = if self.end == Some(EndReason::AllPlaced) {
            (f64::from(self.remaining_ms) / 1000.0 * score.quality_pct).round() as u32
        } else {
            0
        };
        Some(ShiftResult {
            score,
            early_finish_bonus,
            final_score: score.composite_score + early_finish_bonus,
        })
    }

    fn finish(&mut self, reason: EndReason) {
        self.end = Some(reason);
        self.held = None;
    }
}
