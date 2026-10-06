//! Mode 2: deterministic conveyor arrivals and the pick-spur buffer (SPEC-01 §5.2).
use std::collections::VecDeque;

use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::Serialize;

use crate::grid::{Placement, Rejection, Validation, CEILING_IN};
use crate::physics::{CaseId, Pallet, RemoveError};
use crate::sku;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConveyorError {
    RoundOver,
    NotAtPickSpur,
    NotHeld,
    HeightNotReached,
    Rejected(Rejection),
}

pub const BUFFER_CAPACITY: usize = 10;
pub const ESTOP_DIVERSIONS: usize = 5;

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
    pub can_ship: bool,
    pub signal: Signal,
    pub end_reason: Option<EndReason>,
    pub diversions_count: usize,
    pub diversions: Vec<Diversion>,
    pub elapsed_ms: f64,
    pub arrival_interval_ms: f64,
    pub arrival_progress: f64,
    pub incoming: ConveyorCase,
    pub queue: Vec<ConveyorCase>,
}

#[derive(Debug)]
pub struct ConveyorRound {
    seed: u64,
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
        let mut rng = ChaCha8Rng::seed_from_u64(seed);
        let incoming = next_case(&mut rng, 0);
        Self {
            seed,
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
            remaining = (remaining - until_arrival).max(0.0);
            self.elapsed_ms += until_arrival;
            self.progress = 0.0;
            if self.queue.len() == BUFFER_CAPACITY {
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

    /// Only the oldest waiting case may be picked. It reserves its buffer slot until a valid
    /// drop, so abandoning a drag cannot free capacity or reorder the queue.
    pub fn pick(&mut self, id: u32, now_ms: f64) -> Result<(), ConveyorError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ConveyorError::RoundOver);
        }
        if self.queue.front().map(|case| case.id) != Some(id) {
            return Err(ConveyorError::NotAtPickSpur);
        }
        self.held = Some(id);
        Ok(())
    }

    pub fn validate(&self, placement: &Placement) -> Validation {
        // Heavy-on-light is a Mode 1 rule. Mode 2 uses the shared support/crushing solver.
        self.pallet.validate(placement)
    }

    pub fn place(&mut self, placement: Placement, now_ms: f64) -> Result<CaseId, ConveyorError> {
        self.tick(now_ms);
        if self.end.is_some() {
            return Err(ConveyorError::RoundOver);
        }
        let head = self.queue.front().ok_or(ConveyorError::NotHeld)?;
        if self.held != Some(head.id) || head.sku_id != placement.sku.id {
            return Err(ConveyorError::NotHeld);
        }
        let id = self
            .pallet
            .commit(placement)
            .map_err(ConveyorError::Rejected)?;
        self.queue.pop_front();
        self.held = None;
        Ok(id)
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
        if self.height() != CEILING_IN {
            return Err(ConveyorError::HeightNotReached);
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

    fn arrival_interval_ms(&self) -> f64 {
        3_500.0 - 1_500.0 * f64::from(self.height()) / f64::from(CEILING_IN)
    }

    pub fn status(&self) -> ConveyorStatus {
        ConveyorStatus {
            seed: self.seed.to_string(),
            can_ship: self.end.is_none() && self.height() == CEILING_IN,
            signal: match self.queue.len() {
                0..=5 => Signal::Green,
                6..=8 => Signal::Yellow,
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
