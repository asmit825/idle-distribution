use std::collections::BTreeSet;

use pallet_sim::grid::{Placement, Rejection, Status};
use pallet_sim::mode1::{
    spawn, EndReason, FloorCase, Phase, Shift, ShiftError, SHIFT_CASES, SHIFT_MS,
};
use pallet_sim::sku;

/// A shift whose floor holds these SKUs, ids in order, all lying at yaw 0.
fn shift_with(skus: &[&str]) -> Shift {
    let floor = skus
        .iter()
        .enumerate()
        .map(|(id, sku_id)| FloorCase {
            id: id as u32,
            sku: sku::by_id(sku_id).unwrap(),
            yaw_deg: 0,
        })
        .collect();
    Shift::with_floor(1, floor)
}

fn at(sku: &str, grid_x: i32, grid_y: i32) -> Placement {
    Placement::new(sku, grid_x, grid_y, 0, false).unwrap()
}

/// Picks floor case `id` and drops it at `placement`, `now_ms` into the session.
fn pick_and_place(
    shift: &mut Shift,
    id: u32,
    placement: Placement,
    now_ms: f64,
) -> Result<u32, ShiftError> {
    shift.pick(id, now_ms)?;
    shift.place(placement, now_ms)
}

#[test]
fn test_prng_seed_determinism() {
    let floor = spawn(0x5EED);
    assert_eq!(floor.len(), SHIFT_CASES);
    assert_eq!(
        floor.iter().map(|case| case.id).collect::<Vec<_>>(),
        (0..SHIFT_CASES as u32).collect::<Vec<_>>()
    );
    assert_eq!(spawn(0x5EED), floor);
    assert_ne!(spawn(0x5EEE), floor);

    // A 100-case floor mixes all eight SKUs, each lying lengthwise along X or Z.
    let skus: BTreeSet<_> = floor.iter().map(|case| case.sku.id).collect();
    assert_eq!(skus.len(), 8);
    assert!(floor
        .iter()
        .all(|case| case.yaw_deg == 0 || case.yaw_deg == 90));
    assert!(floor.iter().any(|case| case.yaw_deg == 90));
}

#[test]
fn test_mode1_heavy_on_light_rejection() {
    let mut shift = shift_with(&[
        "SKU-LT", "SKU-LB", "SKU-FS", "SKU-FS", "SKU-MS", "SKU-HC", "SKU-HF",
    ]);
    pick_and_place(&mut shift, 0, at("SKU-LT", 0, 0), 0.0).unwrap(); // x 0..16, y 0..12
    pick_and_place(&mut shift, 1, at("SKU-LB", 0, 10), 0.0).unwrap(); // x 0..20, y 20..36
    pick_and_place(&mut shift, 2, at("SKU-FS", 12, 0), 0.0).unwrap(); // x 24..34, y 0..8
    pick_and_place(&mut shift, 3, at("SKU-FS", 17, 0), 0.0).unwrap(); // x 34..44, y 0..8
    pick_and_place(&mut shift, 4, at("SKU-MS", 14, 12), 0.0).unwrap(); // x 28..48, y 24..36

    let heavy_flat_on_its_side = Placement::new("SKU-HF", 12, 0, 0, true).unwrap(); // x 24..48, y 0..8
    for heavy in [
        at("SKU-HC", 0, 0),
        at("SKU-HF", 0, 10),
        heavy_flat_on_its_side,
    ] {
        let check = shift.validate(&heavy);
        assert_eq!(
            (check.status, check.rejection),
            (Status::Invalid, Some(Rejection::HeavyOnLight)),
            "{heavy:?}"
        );
    }
    // Heavy on medium, or on the deck beside light cases, is fine; so is light on light.
    assert_eq!(shift.validate(&at("SKU-HC", 16, 12)).status, Status::Valid);
    assert_eq!(shift.validate(&at("SKU-HC", 10, 4)).status, Status::Valid);
    assert_eq!(shift.validate(&at("SKU-FS", 0, 0)).status, Status::Valid);

    // Dropping it there anyway is refused, and the case stays on the floor.
    shift.pick(5, 0.0).unwrap();
    assert_eq!(
        shift.place(at("SKU-HC", 0, 0), 0.0),
        Err(ShiftError::Rejected(Rejection::HeavyOnLight))
    );
    assert_eq!(shift.cases_on_floor(), 2);
    assert_eq!(shift.pallet().cases().len(), 5);
}

#[test]
fn the_shift_clock_waits_for_the_first_pick() {
    let mut shift = shift_with(&["SKU-MQ", "SKU-MQ"]);
    assert_eq!(
        (shift.phase(), shift.time_remaining_ms()),
        (Phase::Staged, SHIFT_MS)
    );
    shift.tick(45_000.0); // inspecting the floor costs nothing
    assert_eq!(
        (shift.phase(), shift.time_remaining_ms()),
        (Phase::Staged, 60_000)
    );

    shift.pick(0, 50_000.0).unwrap();
    assert_eq!(shift.phase(), Phase::Running);
    shift.tick(62_500.25);
    assert_eq!(shift.time_remaining_ms(), 47_500); // rounds up: 0:00 means truly out of time
    shift.tick(60_000.0); // a stale timestamp never winds the clock back
    assert_eq!(shift.time_remaining_ms(), 47_500);
}

#[test]
fn the_round_ends_at_zero_cancelling_the_held_case() {
    let mut shift = shift_with(&["SKU-MQ", "SKU-MQ"]);
    pick_and_place(&mut shift, 0, at("SKU-MQ", 0, 0), 1_000.0).unwrap();
    shift.pick(1, 30_000.0).unwrap();
    shift.tick(61_000.0);
    assert_eq!(shift.phase(), Phase::Complete);
    assert_eq!(shift.end_reason(), Some(EndReason::TimeUp));
    assert_eq!(shift.time_remaining_ms(), 0);

    // The held case never lands, and the floor is closed.
    assert_eq!(
        shift.place(at("SKU-MQ", 6, 0), 61_000.0),
        Err(ShiftError::ShiftOver)
    );
    assert_eq!(shift.pick(1, 61_000.0), Err(ShiftError::ShiftOver));
    assert_eq!(shift.pallet().cases().len(), 1);
    let result = shift.result().unwrap();
    assert_eq!(
        (result.score.cases_placed, result.early_finish_bonus),
        (1, 0)
    );
}

#[test]
fn a_drop_after_time_runs_out_is_refused_even_before_the_next_tick() {
    let mut shift = shift_with(&["SKU-MQ"]);
    shift.pick(0, 0.0).unwrap();
    assert_eq!(
        shift.place(at("SKU-MQ", 0, 0), 60_000.0),
        Err(ShiftError::ShiftOver)
    );
    assert_eq!(shift.end_reason(), Some(EndReason::TimeUp));
}

#[test]
fn placing_every_floor_case_ends_the_shift_with_an_early_finish_bonus() {
    let mut shift = shift_with(&["SKU-MQ", "SKU-MQ"]);
    pick_and_place(&mut shift, 0, at("SKU-MQ", 6, 7), 10_000.0).unwrap(); // x 12..24, y 14..26
    assert_eq!(shift.phase(), Phase::Running);
    pick_and_place(&mut shift, 1, at("SKU-MQ", 12, 7), 44_650.0).unwrap(); // x 24..36
    assert_eq!(shift.phase(), Phase::Complete);
    assert_eq!(shift.end_reason(), Some(EndReason::AllPlaced));
    assert_eq!(shift.time_remaining_ms(), 25_350);
    shift.tick(80_000.0);
    assert_eq!(shift.time_remaining_ms(), 25_350); // frozen

    // Centered, uncrushed, no overhang: 100% quality. Bonus = 25.35 s × 100 × 100%.
    let result = shift.result().unwrap();
    assert_eq!(result.score.composite_score, 200);
    assert_eq!(result.early_finish_bonus, 2_535);
    assert_eq!(result.final_score, 2_735);
}

#[test]
fn shipping_the_pallet_ends_the_shift_without_a_bonus() {
    let mut shift = shift_with(&["SKU-MQ", "SKU-MQ"]);
    assert!(shift.result().is_none());
    pick_and_place(&mut shift, 0, at("SKU-MQ", 9, 7), 2_000.0).unwrap(); // centered on the deck
    shift.ship(12_000.0);
    assert_eq!(
        (shift.phase(), shift.end_reason()),
        (Phase::Complete, Some(EndReason::Shipped))
    );
    assert_eq!(shift.time_remaining_ms(), 50_000);
    assert_eq!(shift.pick(1, 12_000.0), Err(ShiftError::ShiftOver));
    shift.tick(90_000.0);
    assert_eq!(shift.end_reason(), Some(EndReason::Shipped));

    let result = shift.result().unwrap();
    assert_eq!(
        (
            result.score.composite_score,
            result.early_finish_bonus,
            result.final_score
        ),
        (100, 0, 100)
    );
}

#[test]
fn an_empty_pallet_can_ship_before_the_clock_starts() {
    let mut shift = shift_with(&["SKU-MQ"]);
    shift.ship(5_000.0);
    assert_eq!(shift.end_reason(), Some(EndReason::Shipped));
    assert_eq!(shift.time_remaining_ms(), SHIFT_MS);
    assert_eq!(shift.result().unwrap().final_score, 0);
}

#[test]
fn only_the_picked_floor_case_can_be_dropped_and_only_once() {
    let mut shift = shift_with(&["SKU-MQ", "SKU-LT", "SKU-MQ"]);
    assert_eq!(
        shift.place(at("SKU-MQ", 0, 0), 0.0),
        Err(ShiftError::NotHeld)
    );
    assert_eq!(shift.phase(), Phase::Staged); // a drop is not a pick
    shift.pick(1, 0.0).unwrap();
    assert_eq!(
        shift.place(at("SKU-MQ", 0, 0), 0.0),
        Err(ShiftError::NotHeld)
    );
    shift.place(at("SKU-LT", 0, 0), 0.0).unwrap();
    assert_eq!(shift.pick(1, 0.0), Err(ShiftError::NotOnFloor));
    assert_eq!(shift.pick(3, 0.0), Err(ShiftError::NotOnFloor));
    assert_eq!(shift.cases_on_floor(), 2);
}
