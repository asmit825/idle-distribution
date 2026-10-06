//! Seeded random placement sequences: invariants that hold for every stack, not just worked examples.

use pallet_sim::grid::{Placement, Status, CEILING_IN};
use pallet_sim::physics::Pallet;
use pallet_sim::scoring::evaluate;
use pallet_sim::sku;
use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;

const SEEDS: u64 = 64;
const ATTEMPTS: usize = 150;

/// A random placement anywhere a case could overhang by up to the grid's reach.
fn random_placement(rng: &mut ChaCha8Rng) -> Placement {
    let catalog = sku::catalog();
    let sku = &catalog[rng.next_u32() as usize % catalog.len()];
    let grid_x = (rng.next_u32() % 28) as i32 - 2;
    let grid_y = (rng.next_u32() % 24) as i32 - 2;
    let yaw = (rng.next_u32() % 4) as u16 * 90;
    let flipped = rng.next_u32().is_multiple_of(5);
    Placement::new(sku.id, grid_x, grid_y, yaw, flipped).unwrap()
}

/// Every attempted placement, in order, with whether it was committed.
fn build(seed: u64) -> (Pallet, Vec<(Placement, bool)>) {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut pallet = Pallet::default();
    let mut log = Vec::new();
    for _ in 0..ATTEMPTS {
        let placement = random_placement(&mut rng);
        let check = pallet.validate(&placement);
        let committed = pallet.commit(placement);
        // Validation predicts the commit exactly: invalid aims are refused, the rest land where shown.
        match committed {
            Ok(id) => {
                assert_ne!(
                    check.status,
                    Status::Invalid,
                    "seed {seed}: committed an invalid aim"
                );
                assert_eq!(pallet.case(id).unwrap().elevation_in, check.elevation_in);
            }
            Err(rejection) => assert_eq!(check.rejection, Some(rejection), "seed {seed}"),
        }
        log.push((placement, committed.is_ok()));
    }
    (pallet, log)
}

#[test]
fn every_case_stays_under_the_ceiling_with_its_weight_reaching_the_deck() {
    for seed in 0..SEEDS {
        let (pallet, _) = build(seed);
        let mut deck_load = 0.0;
        let mut total_weight = 0.0;
        for case in pallet.cases() {
            assert!(
                case.top_in() <= CEILING_IN,
                "seed {seed}: case {} tops out at {}",
                case.id,
                case.top_in()
            );
            assert!(
                case.placement.footprint().overhang() <= 2,
                "seed {seed}: case {} overhangs",
                case.id
            );
            let overloaded = case.load_lbs > case.placement.sku.top_load_capacity_lbs as f64;
            assert!(
                case.crushed || !overloaded,
                "seed {seed}: case {} carries {} lbs uncrushed",
                case.id,
                case.load_lbs
            );
            total_weight += case.placement.sku.weight_lbs as f64;
            if case.elevation_in == 0 {
                deck_load += case.placement.sku.weight_lbs as f64 + case.load_lbs;
            }
        }
        assert!(
            (deck_load - total_weight).abs() < 1e-6,
            "seed {seed}: {deck_load} lbs reach the deck of {total_weight}"
        );
    }
}

#[test]
fn quality_stays_within_bounds_and_under_the_crush_penalty_ceiling() {
    let (mut crushes, mut stacked) = (0, 0);
    for seed in 0..SEEDS {
        let pallet = build(seed).0;
        let score = evaluate(&pallet);
        assert!(
            (0.0..=100.0).contains(&score.quality_pct),
            "seed {seed}: {}",
            score.quality_pct
        );
        // Interlocking can win back at most 10 points (SPEC-01 §2.4).
        let ceiling = 110.0 - 15.0 * score.crushed_count as f64;
        assert!(
            score.quality_pct <= ceiling.max(0.0),
            "seed {seed}: {}% with {} crushed",
            score.quality_pct,
            score.crushed_count
        );
        crushes += score.crushed_count;
        stacked += pallet
            .cases()
            .iter()
            .filter(|case| case.elevation_in > 0)
            .count();
    }
    // The random sequences really do stack and crush, so the invariants above are not vacuous.
    assert!(
        crushes > 0 && stacked > 0,
        "{crushes} crushes, {stacked} stacked cases"
    );
}

#[test]
fn replaying_the_same_seed_rebuilds_the_identical_stack() {
    for seed in 0..SEEDS {
        let (first, first_log) = build(seed);
        let (second, second_log) = build(seed);
        assert_eq!(first_log, second_log);
        assert_eq!(first.cases(), second.cases());
    }
}

#[test]
fn crushing_is_permanent_as_the_stack_grows() {
    for seed in 0..SEEDS {
        let (_, log) = build(seed);
        let mut pallet = Pallet::default();
        let mut crushed = Vec::new();
        for (placement, _) in log.into_iter().filter(|(_, committed)| *committed) {
            pallet.commit(placement).unwrap();
            for id in &crushed {
                assert!(
                    pallet.case(*id).unwrap().crushed,
                    "seed {seed}: case {id} uncrushed"
                );
            }
            crushed = pallet
                .cases()
                .iter()
                .filter(|case| case.crushed)
                .map(|case| case.id)
                .collect();
        }
    }
}
