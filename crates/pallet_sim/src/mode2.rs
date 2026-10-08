//! Mode 2: deterministic conveyor arrivals and the pick-spur buffer (SPEC-01 §5.2).
//! On a sandbox line nothing diverts: arrivals pause while the recirculation lane is full.
use std::collections::VecDeque;

use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::Serialize;

use crate::grid::{Placement, Rejection, Validation, CEILING_IN};
use crate::physics::{CaseId, MoveError, Pallet, RemoveError};
use crate::scoring;
use crate::sku;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConveyorError {
    RoundOver,
    /// Only cartons on the final run, beside the pallet, can be picked.
    NotOnFinalRun,
    NotHeld,
    /// Nothing on the pallet to ship.
    EmptyPallet,
    /// No such placed case, or another rests on it.
    NotMovable,
    Rejected(Rejection),
}

/// Cartons the recirculation lane holds: those queued beyond the pick lane, round the transfer
/// corner onto the lane that runs back the other way. A carton arriving to a full lane diverts.
pub const BUFFER_CAPACITY: usize = 10;
/// The final run of belt, from the end stop at the pick spur back to the last turn, in inches.
/// Queued cartons ride lengthwise across it, each taking its width; those wholly on it can be
/// picked in any order. Mirrors the pick lane in `src/rendering/ConveyorBelt.tsx`.
pub const FINAL_RUN_IN: u32 = 116;
pub const ESTOP_DIVERSIONS: usize = 5;

/// How fast cartons arrive. Medium is the original pace; scales the arrival interval.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty {
    Easy,
    #[default]
    Medium,
    Hard,
}

impl Difficulty {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "easy" => Some(Self::Easy),
            "medium" => Some(Self::Medium),
            "hard" => Some(Self::Hard),
            _ => None,
        }
    }

    /// Multiplies the arrival interval: Easy is 1.5x slower, Hard 1.6x faster than Medium.
    fn interval_scale(self) -> f64 {
        match self {
            Self::Easy => 1.5,
            Self::Medium => 1.0,
            Self::Hard => 1.0 / 1.6,
        }
    }
}

/// Cartons on the recirculation lane at which the signal turns yellow; it is red when the lane is full.
pub const YELLOW_AT: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Signal {
    Green,
    Yellow,
    Red,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    Estop,
    Shipped,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Diversion {
    pub case: ConveyorCase,
    pub elapsed_ms: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ConveyorCase {
    pub id: u32,
    pub sku_id: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ConveyorStatus {
    pub seed: String,
    pub difficulty: Difficulty,
    /// Arrivals wait for room instead of diverting, so the line never stops.
    pub sandbox: bool,
    pub can_ship: bool,
    /// Cartons on the recirculation lane, beyond the pick lane; `BUFFER_CAPACITY` is full.
    pub recirculating: usize,
    /// Height reached as a share of the 60 inch target, in percent.
    pub fill_pct: f64,
    /// Composite score scaled by `fill_pct`, once shipped: a partial pallet counts against the score.
    pub final_score: Option<u32>,
    pub signal: Signal,
    pub end_reason: Option<EndReason>,
    pub diversions_count: usize,
    pub diversions: Vec<Diversion>,
    pub elapsed_ms: f64,
    pub arrival_interval_ms: f64,
    pub arrival_progress: f64,
    pub incoming: ConveyorCase,
    pub queue: Vec<ConveyorCase>,
    /// How many cartons at the front of the queue are on the final run, and so can be picked.
    pub final_run: usize,
}

#[derive(Debug)]
pub struct ConveyorRound {
    seed: u64,
    difficulty: Difficulty,
    sandbox: bool,
    pallet: Pallet,
    held: Option<u32>,
    rng: ChaCha8Rng,
    next_id: u32,
    incoming: ConveyorCase,
    queue: VecDeque<ConveyorCase>,
    now_ms: f64,
    elapsed_ms: f64,
    progress: f64,
    end: Option<EndReason>,
    diversions: Vec<Diversion>,
}

impl ConveyorRound {
    pub fn new(seed: u64, now_ms: f64) -> Self {
        Self::with_difficulty(seed, now_ms, Difficulty::Medium)
    }

    pub fn with_difficulty(seed: u64, now_ms: f64, difficulty: Difficulty) -> Self {
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let incoming = next_case(&mut rng, 0);
        Self {
            seed,
            difficulty,
            sandbox: false,
            pallet: Pallet::default(),
            held: None,
            rng,
            next_id: 1,
            incoming,
            queue: VecDeque::new(),
            now_ms: if now_ms.is_finite() { now_ms } else { 0.0 },
            elapsed_ms: 0.0,
            progress: 0.0,
            end: None,
            diversions: Vec::new(),
        }
    }

    /// The same line, except a carton arriving to a full recirculation lane waits at the
    /// infeed rather than diverting: no diversions, no Estop.
    pub fn sandbox(mut self) -> Self {
        self.sandbox = true;
        self
    }

    pub fn tick(&mut self, now_ms: f64) {
        if self.end.is_some() || !now_ms.is_finite() || now_ms <= self.now_ms {
            return;
        }
        let mut remaining = now_ms - self.now_ms;
        let interval = self.arrival_interval_ms();
        while remaining > 0.0 {
            let until_arrival = (1.0 - self.progress) * interval;
            if remaining + 1e-8 < until_arrival {
                self.progress += remaining / interval;
                self.elapsed_ms += remaining;
                break;
            }
            if self.sandbox && self.recirculating() >= BUFFER_CAPACITY {
                self.progress = 1.0;
                self.elapsed_ms += remaining;
                break;
            }
            remaining = (remaining - until_arrival).max(0.0);
            self.elapsed_ms += until_arrival;
            self.progress = 0.0;
            if self.recirculating() >= BUFFER_CAPACITY {
                self.diversions.push(Diversion {
                    case: self.incoming,
                    elapsed_ms: self.elapsed_ms,
                });
                if self.diversions.len() == ESTOP_DIVERSIONS {
                    self.end = Some(EndReason::Estop);
                    self.held = None;
                    break;
                }
            } else {
                self.queue.push_back(self.incoming);
            }
            self.incoming = next_case(&mut self.rng, self.next_id);
            self.next_id += 1;
        }
        self.now_ms = now_ms;
    }

    pub fn pallet(&self) -> &Pallet {
        &self.pallet
    }

    /// Any carton on the final run may be picked, whatever its place in line. It reserves its
    /// buffer slot until a valid drop, so abandoning a drag cannot free capacity or reorder the queue.
    pub fn pick(&mut self, id: u32, now_ms: f64) -> Result<(), ConveyorError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ConveyorError::RoundOver);
        }
        if !self
            .queue
            .iter()
            .take(self.final_run())
            .any(|case| case.id == id)
        {
            return Err(ConveyorError::NotOnFinalRun);
        }
        self.held = Some(id);
        Ok(())
    }

    pub fn validate(&self, placement: &Placement) -> Validation {
        self.pallet.validate(placement)
    }

    pub fn place(&mut self, placement: Placement, now_ms: f64) -> Result<CaseId, ConveyorError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ConveyorError::RoundOver);
        }
        let index = self
            .queue
            .iter()
            .position(|case| Some(case.id) == self.held && case.sku_id == placement.sku.id)
            .ok_or(ConveyorError::NotHeld)?;
        let id = self
            .pallet
            .commit(placement)
            .map_err(ConveyorError::Rejected)?;
        self.queue.remove(index);
        self.held = None;
        Ok(id)
    }

    /// Moves an exposed placed carton; the conveyor is unchanged.
    pub fn relocate(
        &mut self,
        case_id: CaseId,
        placement: Placement,
        now_ms: f64,
    ) -> Result<(), ConveyorError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ConveyorError::RoundOver);
        }
        self.pallet
            .relocate(case_id, placement)
            .map_err(|error| match error {
                MoveError::Rejected(rejection) => ConveyorError::Rejected(rejection),
                MoveError::NotFound | MoveError::Supporting => ConveyorError::NotMovable,
            })
    }

    /// Removes an exposed placed carton. It does not re-enter or reorder the incoming FIFO.
    pub fn remove(&mut self, case_id: CaseId) -> Result<(), RemoveError> {
        self.pallet.remove(case_id)
    }

    pub fn ship(&mut self, now_ms: f64) -> Result<(), ConveyorError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ConveyorError::RoundOver);
        }
        if self.pallet.cases().is_empty() {
            return Err(ConveyorError::EmptyPallet);
        }
        self.end = Some(EndReason::Shipped);
        self.held = None;
        Ok(())
    }

    fn height(&self) -> i32 {
        self.pallet
            .cases()
            .iter()
            .map(|case| case.top_in())
            .max()
            .unwrap_or(0)
    }

    /// The queue's front cartons that fit wholly on the final run, packed nose to tail.
    fn final_run(&self) -> usize {
        let mut used = 0;
        self.queue
            .iter()
            .take_while(|case| {
                used += sku::by_id(case.sku_id).map_or(0, |sku| sku.width_in);
                used <= FINAL_RUN_IN
            })
            .count()
    }

    /// Queued cartons that are not on the pick lane: on the transfer or the recirculation lane.
    fn recirculating(&self) -> usize {
        self.queue.len() - self.final_run()
    }

    fn fill_pct(&self) -> f64 {
        100.0 * f64::from(self.height().min(CEILING_IN)) / f64::from(CEILING_IN)
    }

    fn arrival_interval_ms(&self) -> f64 {
        (3_500.0 - 1_500.0 * f64::from(self.height()) / f64::from(CEILING_IN))
            * self.difficulty.interval_scale()
    }

    /// Mode 2's grade rewards work done: load quality scaled by how full the pallet is, and an
    /// Estop is a failed run whatever was stacked.
    pub fn grade(&self) -> scoring::Grade {
        if self.end == Some(EndReason::Estop) {
            return scoring::Grade::F;
        }
        scoring::Grade::from_quality(scoring::evaluate(&self.pallet).quality_pct * self.fill_pct() / 100.0)
    }

    pub fn status(&self) -> ConveyorStatus {
        ConveyorStatus {
            seed: self.seed.to_string(),
            difficulty: self.difficulty,
            sandbox: self.sandbox,
            can_ship: self.end.is_none() && !self.pallet.cases().is_empty(),
            recirculating: self.recirculating(),
            fill_pct: self.fill_pct(),
            final_score: (self.end == Some(EndReason::Shipped)).then(|| {
                (f64::from(scoring::evaluate(&self.pallet).composite_score) * self.fill_pct() / 100.0).round() as u32
            }),
            signal: match self.recirculating() {
                n if n < YELLOW_AT => Signal::Green,
                n if n < BUFFER_CAPACITY => Signal::Yellow,
                _ => Signal::Red,
            },
            end_reason: self.end,
            diversions_count: self.diversions.len(),
            diversions: self.diversions.clone(),
            elapsed_ms: self.elapsed_ms,
            arrival_interval_ms: self.arrival_interval_ms(),
            arrival_progress: self.progress,
            incoming: self.incoming,
            queue: self.queue.iter().copied().collect(),
            final_run: self.final_run(),
        }
    }
}

fn next_case(rng: &mut ChaCha8Rng, id: u32) -> ConveyorCase {
    let catalog = sku::catalog();
    ConveyorCase {
        id,
        sku_id: catalog[rng.next_u32() as usize % catalog.len()].id,
    }
}
