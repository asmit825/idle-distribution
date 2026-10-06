//! Mode 1: 100-Case Free Staging, the 60-second shift rush (SPEC-01 §5.1).

use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::Serialize;

use crate::grid::{Placement, Rejection, Status, Validation};
use crate::physics::{CaseId, Pallet};
use crate::scoring::{self, Score};
use crate::sku::{self, HandlingClass, SkuDef};

pub const SHIFT_CASES: usize = 100;
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
    let catalog = sku::catalog();
    (0..SHIFT_CASES as u32)
        .map(|id| FloorCase {
            id,
            // Eight SKUs divide 2³² evenly, so the modulo is unbiased.
            sku: &catalog[rng.next_u32() as usize % catalog.len()],
            yaw_deg: if rng.next_u32() & 1 == 0 { 0 } else { 90 },
        })
        .collect()
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
    /// All 100 cases placed before time ran out.
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
    /// No such floor case, or it is already on the pallet.
    NotOnFloor,
    /// A drop with no case picked, or of a different SKU than the one picked.
    NotHeld,
    Rejected(Rejection),
}

/// One Mode 1 shift: the floor inventory, the pallet being built, and the shift clock.
#[derive(Debug)]
pub struct Shift {
    seed: u64,
    floor: Vec<FloorCase>,
    on_floor: Vec<bool>,
    pallet: Pallet,
    held: Option<u32>,
    /// The latest timestamp seen, in the caller's milliseconds (`performance.now()`).
    now_ms: f64,
    started_ms: Option<f64>,
    remaining_ms: u32,
    end: Option<EndReason>,
}

impl Shift {
    pub fn new(seed: u64) -> Shift {
        Shift::with_floor(seed, spawn(seed))
    }

    /// A shift over a given floor, ids `0..floor.len()` in order.
    pub fn with_floor(seed: u64, floor: Vec<FloorCase>) -> Shift {
        Shift {
            seed,
            on_floor: vec![true; floor.len()],
            floor,
            pallet: Pallet::default(),
            held: None,
            now_ms: f64::NEG_INFINITY,
            started_ms: None,
            remaining_ms: SHIFT_MS,
            end: None,
        }
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn floor(&self) -> &[FloorCase] {
        &self.floor
    }

    pub fn pallet(&self) -> &Pallet {
        &self.pallet
    }

    pub fn cases_on_floor(&self) -> u32 {
        self.on_floor.iter().filter(|&&waiting| waiting).count() as u32
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

    /// Whole milliseconds left, rounded up, as of the latest timestamp. Frozen once complete.
    pub fn time_remaining_ms(&self) -> u32 {
        self.remaining_ms
    }

    /// Advances the clock to `now_ms`, ending the shift at 0:00. Earlier timestamps are ignored.
    pub fn tick(&mut self, now_ms: f64) {
        if self.end.is_some() {
            return;
        }
        self.now_ms = self.now_ms.max(now_ms);
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
        if !self.on_floor.get(id as usize).copied().unwrap_or(false) {
            return Err(ShiftError::NotOnFloor);
        }
        self.started_ms.get_or_insert(self.now_ms);
        self.held = Some(id);
        Ok(())
    }

    /// The pallet's verdict, plus the Mode 1 rule: no heavy case directly on a light or fragile one.
    pub fn validate(&self, placement: &Placement) -> Validation {
        let mut check = self.pallet.validate(placement);
        if check.rejection.is_none() && self.heavy_on_light(placement, check.elevation_in) {
            check.status = Status::Invalid;
            check.rejection = Some(Rejection::HeavyOnLight);
            check.would_crush = 0;
        }
        check
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
        if let Some(rejection) = self.validate(&placement).rejection {
            return Err(ShiftError::Rejected(rejection));
        }
        let case = self
            .pallet
            .commit(placement)
            .map_err(ShiftError::Rejected)?;
        self.on_floor[id as usize] = false;
        self.held = None;
        if self.cases_on_floor() == 0 {
            self.finish(EndReason::AllPlaced);
        }
        Ok(case)
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

    fn heavy_on_light(&self, placement: &Placement, elevation: i32) -> bool {
        placement.sku.handling == HandlingClass::Heavy
            && self
                .pallet
                .beneath(&placement.footprint(), elevation)
                .any(|case| {
                    matches!(
                        case.placement.sku.handling,
                        HandlingClass::Light | HandlingClass::Fragile
                    )
                })
    }
}
