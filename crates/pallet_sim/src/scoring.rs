//! Load Quality and composite score (SPEC-01 §2.4).

use std::collections::BTreeSet;

use serde::Serialize;

use crate::grid::{CEILING_IN, PALLET_LENGTH_IN, PALLET_WIDTH_IN};
use crate::physics::Pallet;

/// The most one crushed case docks, once loaded to double its rating. Less overload docks
/// proportionally less, so a heavy case on a light one costs more the heavier it is.
const CRUSH_PENALTY_CAP_PCT: f64 = 15.0;
/// Overload, as a fraction of the rating, that docks the full crush penalty.
const FULL_CRUSH_OVERLOAD: f64 = 1.0;
const OVERHANG_PENALTY_PCT_PER_IN: f64 = 5.0;
/// Drift penalty ramps linearly to its cap at this distance from the deck center.
const DRIFT_CAP_IN: f64 = 12.0;
const DRIFT_PENALTY_CAP_PCT: f64 = 20.0;
const INTERLOCK_BONUS_PCT_PER_TIER: f64 = 2.0;
const INTERLOCK_BONUS_CAP_PCT: f64 = 10.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Grade {
    S,
    A,
    B,
    C,
    F,
}

impl Grade {
    pub fn from_quality(quality_pct: f64) -> Grade {
        match quality_pct {
            q if q >= 90.0 => Grade::S,
            q if q >= 80.0 => Grade::A,
            q if q >= 70.0 => Grade::B,
            q if q >= 60.0 => Grade::C,
            _ => Grade::F,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Score {
    pub cases_placed: u32,
    pub total_weight_lbs: u32,
    /// Highest case top above the deck.
    pub max_height_in: i32,
    /// Case volume as a share of the 48" × 40" × 60" build envelope.
    pub volume_utilization_pct: f64,
    pub crushed_count: u32,
    pub max_overhang_in: i32,
    /// Weighted center of mass over the deck plane; the deck center when empty.
    pub cog_in: (f64, f64),
    pub cog_drift_in: f64,
    pub crush_penalty: f64,
    pub overhang_penalty: f64,
    pub drift_penalty: f64,
    pub interlock_bonus: f64,
    pub quality_pct: f64,
    /// Cases placed × quality percentage, rounded.
    pub composite_score: u32,
    pub grade: Grade,
}

pub fn evaluate(pallet: &Pallet) -> Score {
    let cases = pallet.cases();
    let crushed_count = cases.iter().filter(|case| case.crushed).count() as u32;
    let max_overhang_in = cases
        .iter()
        .map(|case| case.footprint.overhang())
        .max()
        .unwrap_or(0);

    let center = (
        f64::from(PALLET_LENGTH_IN) / 2.0,
        f64::from(PALLET_WIDTH_IN) / 2.0,
    );
    let total_weight_lbs: u32 = cases.iter().map(|case| case.placement.sku.weight_lbs).sum();
    let max_height_in = cases.iter().map(|case| case.top_in()).max().unwrap_or(0);
    let case_volume: i64 = cases
        .iter()
        .map(|case| case.footprint.area() * i64::from(case.placement.height()))
        .sum();
    let envelope = i64::from(PALLET_LENGTH_IN * PALLET_WIDTH_IN * CEILING_IN);
    let volume_utilization_pct = 100.0 * case_volume as f64 / envelope as f64;
    let cog_in = if cases.is_empty() {
        center
    } else {
        let (x, y) = cases.iter().fold((0.0, 0.0), |(x, y), case| {
            let weight = f64::from(case.placement.sku.weight_lbs);
            let (cx, cy) = case.footprint.center();
            (x + weight * cx, y + weight * cy)
        });
        (
            x / f64::from(total_weight_lbs),
            y / f64::from(total_weight_lbs),
        )
    };
    let cog_drift_in = (cog_in.0 - center.0).hypot(cog_in.1 - center.1);

    // A tier interlocks when any case at that elevation bridges two or more cases below.
    let interlocking_tiers = cases
        .iter()
        .filter(|case| case.supports.len() >= 2)
        .map(|case| case.elevation_in)
        .collect::<BTreeSet<_>>()
        .len();

    let crush_penalty: f64 = cases
        .iter()
        .filter(|case| case.crushed)
        .map(|case| CRUSH_PENALTY_CAP_PCT * (case.overload() / FULL_CRUSH_OVERLOAD).min(1.0))
        .sum();
    let overhang_penalty = OVERHANG_PENALTY_PCT_PER_IN * f64::from(max_overhang_in);
    let drift_penalty =
        (cog_drift_in / DRIFT_CAP_IN * DRIFT_PENALTY_CAP_PCT).min(DRIFT_PENALTY_CAP_PCT);
    let interlock_bonus =
        (INTERLOCK_BONUS_PCT_PER_TIER * interlocking_tiers as f64).min(INTERLOCK_BONUS_CAP_PCT);
    let quality_pct = (100.0 - crush_penalty - overhang_penalty - drift_penalty + interlock_bonus)
        .clamp(0.0, 100.0);

    Score {
        cases_placed: cases.len() as u32,
        total_weight_lbs,
        max_height_in,
        volume_utilization_pct,
        crushed_count,
        max_overhang_in,
        cog_in,
        cog_drift_in,
        crush_penalty,
        overhang_penalty,
        drift_penalty,
        interlock_bonus,
        quality_pct,
        composite_score: (cases.len() as f64 * quality_pct).round() as u32,
        // Nothing stacked is no work done, however flawless the empty deck.
        grade: if cases.is_empty() { Grade::F } else { Grade::from_quality(quality_pct) },
    }
}
