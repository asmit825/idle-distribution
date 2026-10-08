use std::collections::BTreeSet;

use pallet_sim::grid::{Placement, Rejection, Status};
use pallet_sim::mode1::{
    spawn, EndReason, FloorCase, Phase, Shift, ShiftError, SHIFT_CASES, SHIFT_MS, WAVE_CASES,
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
fn heavy_cases_may_go_on_light_ones_at_the_cost_of_crushing_them() {
    let mut shift = shift_with(&[
        "SKU-LT", "SKU-LB", "SKU-FS", "SKU-FS", "SKU-MS", "SKU-HC", "SKU-HF",
    ]);
    pick_and_place(&mut shift, 0, at("SKU-LT", 0, 0), 0.0).unwrap(); // x 0..16, y 0..12
    pick_and_place(&mut shift, 1, at("SKU-LB", 0, 10), 0.0).unwrap(); // x 0..20, y 20..36
    pick_and_place(&mut shift, 2, at("SKU-FS", 12, 0), 0.0).unwrap(); // x 24..34, y 0..8
    pick_and_place(&mut shift, 3, at("SKU-FS", 17, 0), 0.0).unwrap(); // x 34..44, y 0..8
    pick_and_place(&mut shift, 4, at("SKU-MS", 14, 12), 0.0).unwrap(); // x 28..48, y 24..36

    // A heavy case over light or fragile ones is a warning: it lands, crushing them.
    let heavy_flat_on_its_side = Placement::new("SKU-HF", 12, 0, 0, true).unwrap(); // x 24..48, y 0..8
    for (heavy, crushes) in [
        (at("SKU-HC", 0, 0), 1),
        (at("SKU-HF", 0, 10), 1),
        (heavy_flat_on_its_side, 2),
    ] {
        let check = shift.validate(&heavy);
        assert_eq!(
            (check.status, check.rejection, check.would_crush),
            (Status::Warning, None, crushes),
            "{heavy:?}"
        );
    }
    // Heavy on medium, or on the deck beside light cases, is fine; so is light on light.
    assert_eq!(shift.validate(&at("SKU-HC", 16, 12)).status, Status::Valid);
    assert_eq!(shift.validate(&at("SKU-HC", 10, 4)).status, Status::Valid);
    assert_eq!(shift.validate(&at("SKU-FS", 0, 0)).status, Status::Valid);

    // The 45 lb cube puts the 30 lb-rated Light Tall 50% over, docking half the crush penalty.
    let light = shift.pallet().cases()[0].id;
    pick_and_place(&mut shift, 5, at("SKU-HC", 0, 0), 0.0).unwrap();
    assert!(shift.pallet().case(light).unwrap().crushed);
    shift.ship(1_000.0);
    assert_eq!(shift.result().unwrap().score.crush_penalty, 7.5);
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

/// Medium Squares tile the deck 4 × 3, so this stacks them layer on layer.
fn square(slot: usize) -> Placement {
    at("SKU-MQ", 6 * (slot % 4) as i32, 6 * (slot / 4 % 3) as i32)
}

#[test]
fn the_floor_arrives_in_waves_of_25_as_each_wave_is_cleared() {
    let mut shift = shift_with(&["SKU-MQ"; 30]);
    assert_eq!(WAVE_CASES, 25);
    assert_eq!((shift.wave(), shift.released().len()), (1, 25));
    assert_eq!(shift.cases_on_floor(), 25);
    assert_eq!(shift.pick(25, 0.0), Err(ShiftError::NotOnFloor)); // not here yet

    let mut placed = Vec::new();
    for id in 0..24 {
        placed.push(pick_and_place(&mut shift, id, square(id as usize), 0.0).unwrap());
    }
    assert_eq!((shift.wave(), shift.cases_on_floor()), (1, 1));
    // A case taken back off the pallet has to be placed again before the wave clears.
    shift.remove(placed.pop().unwrap()).unwrap();
    pick_and_place(&mut shift, 24, square(23), 0.0).unwrap();
    assert_eq!((shift.wave(), shift.cases_on_floor()), (1, 1));
    pick_and_place(&mut shift, 23, square(24), 0.0).unwrap();

    // The floor is clear: the last five arrive.
    assert_eq!((shift.wave(), shift.released().len()), (2, 30));
    assert_eq!((shift.phase(), shift.cases_on_floor()), (Phase::Running, 5));
    for id in 25..30 {
        pick_and_place(&mut shift, id, square(id as usize), 0.0).unwrap();
    }
    assert_eq!(shift.end_reason(), Some(EndReason::AllPlaced));
}

#[test]
fn a_seeded_shift_brings_its_100_cases_in_four_waves() {
    let shift = Shift::new(0x5EED);
    assert_eq!(shift.floor().len(), SHIFT_CASES);
    assert_eq!(shift.released(), &shift.floor()[..WAVE_CASES]);
}

#[test]
fn placed_cases_move_under_the_shift_rules_without_returning_to_the_floor() {
    // The fourth case stays on the floor, keeping the shift open.
    let mut shift = shift_with(&["SKU-LT", "SKU-MQ", "SKU-HC", "SKU-FS"]);
    pick_and_place(&mut shift, 0, at("SKU-LT", 0, 0), 0.0).unwrap();
    let medium = pick_and_place(&mut shift, 1, at("SKU-MQ", 12, 0), 0.0).unwrap();
    let heavy = pick_and_place(&mut shift, 2, at("SKU-HC", 12, 10), 0.0).unwrap();

    // Moving the heavy case onto the Light Tall is judged as if it were lifted: it would crush.
    let check = shift.validate_move(heavy, &at("SKU-HC", 0, 0)).unwrap();
    assert_eq!((check.status, check.would_crush), (Status::Warning, 1));
    assert_eq!(
        shift.relocate(heavy, at("SKU-HC", -2, 0), 1_000.0),
        Err(ShiftError::Rejected(Rejection::ExcessOverhang))
    );
    shift.relocate(medium, at("SKU-MQ", 0, 0), 1_000.0).unwrap();
    assert_eq!(shift.pallet().case(medium).unwrap().elevation_in, 15);
    assert_eq!(shift.cases_on_floor(), 1);

    shift.tick(61_000.0);
    assert_eq!(
        shift.relocate(medium, at("SKU-MQ", 12, 0), 61_000.0),
        Err(ShiftError::ShiftOver)
    );
}

#[test]
fn a_sandbox_shift_has_no_clock_and_deals_the_timed_shifts_cases_first() {
    let mut shift = Shift::new(0x5EED).sandbox();
    assert!(shift.is_sandbox());
    assert_eq!(shift.floor(), spawn(0x5EED).as_slice());
    shift.pick(0, 1_000.0).unwrap();
    shift.tick(1_000.0 + 10.0 * f64::from(SHIFT_MS));
    assert_eq!(shift.phase(), Phase::Running);
    assert_eq!(shift.time_remaining_ms(), SHIFT_MS);
    assert_eq!(shift.elapsed_ms(), 10 * SHIFT_MS);
    shift.ship(1_000.0 + 11.0 * f64::from(SHIFT_MS));
    assert_eq!(shift.end_reason(), Some(EndReason::Shipped));
    assert_eq!(shift.elapsed_ms(), 11 * SHIFT_MS);
    assert_eq!(shift.result().unwrap().early_finish_bonus, 0);
}

#[test]
fn a_sandbox_shift_keeps_dealing_waves_once_the_floor_runs_out() {
    let mut shift = shift_with(&["SKU-MQ"; 2]).sandbox();
    pick_and_place(&mut shift, 0, square(0), 0.0).unwrap();
    pick_and_place(&mut shift, 1, square(1), 0.0).unwrap();
    assert_eq!(shift.end_reason(), None);
    assert_eq!((shift.wave(), shift.cases_on_floor()), (2, WAVE_CASES as u32));
    assert_eq!(
        shift.released()[2..].iter().map(|case| case.id).collect::<Vec<_>>(),
        (2..2 + WAVE_CASES as u32).collect::<Vec<_>>()
    );
    // The supply is the seed's, so the endless waves replay too.
    let mut replay = shift_with(&["SKU-MQ"; 2]).sandbox();
    pick_and_place(&mut replay, 0, square(0), 0.0).unwrap();
    pick_and_place(&mut replay, 1, square(1), 0.0).unwrap();
    assert_eq!(replay.released(), shift.released());
}

#[test]
fn a_timed_shift_reports_elapsed_time_up_to_the_full_shift() {
    let mut shift = Shift::new(1);
    assert_eq!(shift.elapsed_ms(), 0);
    shift.pick(0, 500.0).unwrap();
    shift.tick(20_500.0);
    assert_eq!(shift.elapsed_ms(), 20_000);
    shift.tick(1_000_000.0);
    assert_eq!(shift.elapsed_ms(), SHIFT_MS);
}
