use pallet_sim::grid::{Placement, PlacementError, Rejection, Status};
use pallet_sim::physics::{MoveError, Pallet, RemoveError};
use pallet_sim::scoring::{evaluate, Grade};

fn at(sku: &str, grid_x: i32, grid_y: i32) -> Placement {
    Placement::new(sku, grid_x, grid_y, 0, false).unwrap()
}

#[test]
fn first_case_rests_on_the_pallet_deck() {
    let pallet = Pallet::default();
    let check = pallet.validate(&at("SKU-HC", 0, 0));
    assert_eq!(check.status, Status::Valid);
    assert_eq!(check.elevation_in, 0);
}

#[test]
fn elevation_settles_onto_the_highest_supporting_top() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HC", 0, 0)).unwrap(); // 16 × 16 × 12
    pallet.commit(at("SKU-HF", 8, 0)).unwrap(); // 24 × 16 × 8, x 16..40

    // Medium Square 12 × 12 at x 10..22 straddles both tops; settles on the taller (12").
    assert_eq!(pallet.validate(&at("SKU-MQ", 5, 0)).elevation_in, 12);
    assert_eq!(pallet.validate(&at("SKU-MQ", 10, 0)).elevation_in, 8);
}

fn load_on(pallet: &Pallet, id: u32) -> f64 {
    pallet.case(id).unwrap().load_lbs
}

#[test]
fn test_weight_transfer_single_support() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    pallet.commit(at("SKU-MQ", 0, 0)).unwrap(); // 18 lbs, fully on the cube
    assert_eq!(load_on(&pallet, base), 18.0);
}

#[test]
fn test_weight_transfer_split_support() {
    let mut pallet = Pallet::default();
    let left = pallet.commit(at("SKU-HF", 0, 0)).unwrap(); // x 0..24
    let right = pallet.commit(at("SKU-HF", 12, 0)).unwrap(); // x 24..48

    // Medium Standard 20 × 12, 24 lbs, at x 18..38: 6" over the left, 14" over the right.
    pallet.commit(at("SKU-MS", 9, 0)).unwrap();
    assert!((load_on(&pallet, left) - 7.2).abs() < 1e-9);
    assert!((load_on(&pallet, right) - 16.8).abs() < 1e-9);
}

#[test]
fn loads_accumulate_down_the_stack() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    let middle = pallet.commit(at("SKU-MQ", 0, 0)).unwrap();
    pallet.commit(at("SKU-FS", 0, 0)).unwrap(); // 4 lbs
    assert_eq!(load_on(&pallet, middle), 4.0);
    assert_eq!(load_on(&pallet, base), 22.0);
}

#[test]
fn a_partly_overhanging_case_puts_its_whole_weight_on_its_supports() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-HC", 0, 0)).unwrap(); // 16" wide

    // Medium Standard 20 × 12 spans x 0..20: 20% of its base hangs past the cube.
    pallet.commit(at("SKU-MS", 0, 0)).unwrap();
    assert_eq!(load_on(&pallet, base), 24.0);
}

#[test]
fn test_cumulative_crush_trigger() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-LB", 0, 0)).unwrap(); // Light Bulky, rated 25 lbs
    pallet.commit(at("SKU-MS", 0, 0)).unwrap(); // 24 lbs: 24 ≤ 25 holds
    assert!(!pallet.case(base).unwrap().crushed);

    let fragile = at("SKU-FS", 0, 0); // 4 lbs more, carried through the Medium Standard
    let check = pallet.validate(&fragile);
    assert_eq!((check.status, check.would_crush), (Status::Warning, 1));
    pallet.commit(fragile).unwrap();
    assert!(pallet.case(base).unwrap().crushed);
    assert_eq!(load_on(&pallet, base), 28.0);
}

#[test]
fn a_heavy_case_on_a_light_one_crushes_it() {
    let mut pallet = Pallet::default();
    let light = pallet.commit(at("SKU-LT", 0, 0)).unwrap(); // rated 30 lbs, 16 × 12
    pallet.commit(at("SKU-HC", 0, 0)).unwrap(); // 45 lbs, 75% supported
    assert!(pallet.case(light).unwrap().crushed);
}

#[test]
fn test_overhang_boundaries() {
    let pallet = Pallet::default();
    let inside = pallet.validate(&at("SKU-HC", 16, 12));
    assert_eq!((inside.status, inside.overhang_in), (Status::Valid, 0));

    // Light Tall rolled onto its side has a 16 × 15 base; at y 26..41 it overhangs 1".
    let one_inch = pallet.validate(&Placement::new("SKU-LT", 0, 13, 0, true).unwrap());
    assert_eq!(
        (one_inch.status, one_inch.overhang_in),
        (Status::Warning, 1)
    );

    let two_inch = pallet.validate(&at("SKU-HC", -1, 0));
    assert_eq!(
        (two_inch.status, two_inch.overhang_in),
        (Status::Warning, 2)
    );

    let excess = pallet.validate(&Placement::new("SKU-LT", 0, 14, 0, true).unwrap()); // y 28..43
    assert_eq!(
        (excess.status, excess.rejection, excess.overhang_in),
        (Status::Invalid, Some(Rejection::ExcessOverhang), 3)
    );
    let far = pallet.validate(&at("SKU-HC", -2, 0));
    assert_eq!(
        (far.status, far.rejection, far.overhang_in),
        (Status::Invalid, Some(Rejection::ExcessOverhang), 4)
    );
}

#[test]
fn a_longer_case_overhangs_the_one_beneath_while_it_balances() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-MQ", 6, 6)).unwrap(); // 12 × 12, x 12..24, y 12..24

    // Medium Long 24 × 10 centered on it, x 6..30: half its base over air, but it balances.
    let check = pallet.validate(&at("SKU-ML", 3, 6));
    assert_eq!((check.status, check.rejection), (Status::Valid, None));
    assert!((check.unsupported_fraction - 0.5).abs() < 1e-9);

    // Slid along to x 10..34 its center (22) still sits over the base, which ends at 24.
    let check = pallet.validate(&at("SKU-ML", 5, 6));
    assert_eq!((check.status, check.rejection), (Status::Valid, None));
    pallet.commit(at("SKU-ML", 5, 6)).unwrap();
    assert_eq!(load_on(&pallet, base), 20.0);
}

#[test]
fn a_case_whose_center_is_not_over_its_support_tips() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-MQ", 6, 6)).unwrap(); // x 12..24

    // Medium Long at x 12..36: its center is right on the base's edge at 24, a knife edge.
    let check = pallet.validate(&at("SKU-ML", 6, 6));
    assert_eq!(
        (check.status, check.rejection),
        (Status::Invalid, Some(Rejection::Unsupported))
    );
    // Medium Square at x 18..30, only half on the base: its center is on the edge too.
    assert_eq!(
        pallet.validate(&at("SKU-MQ", 9, 6)).rejection,
        Some(Rejection::Unsupported)
    );
    assert_eq!(
        pallet.commit(at("SKU-ML", 6, 6)),
        Err(Rejection::Unsupported)
    );
    assert_eq!(pallet.cases().len(), 1);
}

#[test]
fn weight_on_an_overhanging_end_can_tip_the_case_beneath() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-MQ", 6, 6)).unwrap(); // x 12..24, 10" tall
    pallet.commit(at("SKU-ML", 5, 6)).unwrap(); // 20 lbs, x 10..34, y 12..22, center 22

    // A 4 lb Fragile Small on the far end, x 24..34: the balance shifts to 23.2", still on.
    let check = pallet.validate(&at("SKU-FS", 12, 6));
    assert_eq!((check.status, check.rejection), (Status::Valid, None));

    // A 45 lb Heavy Cube there, x 18..34, balances on the Medium Long by itself, but drags
    // the pair's balance point out to 24.8", past the base's edge: the Medium Long tips.
    let check = pallet.validate(&at("SKU-HC", 9, 6));
    assert_eq!(
        (check.elevation_in, check.status, check.rejection),
        (18, Status::Invalid, Some(Rejection::Unsupported))
    );
}

#[test]
fn a_case_bridging_a_gap_balances_on_both_sides() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-MQ", 0, 0)).unwrap(); // x 0..12
    pallet.commit(at("SKU-MQ", 12, 0)).unwrap(); // x 24..36

    // Heavy Flat 24 × 16 at x 6..30 spans the 12" gap with 6" on each side: 62.5% over air.
    let check = pallet.validate(&at("SKU-HF", 3, 0));
    assert_eq!((check.status, check.rejection), (Status::Valid, None));
    assert!((check.unsupported_fraction - 0.625).abs() < 1e-9);
    pallet.commit(at("SKU-HF", 3, 0)).unwrap();
    assert!(pallet.is_stable());
}

#[test]
fn rejects_placements_above_the_60_inch_ceiling() {
    let mut pallet = Pallet::default();
    for _ in 0..4 {
        pallet.commit(at("SKU-LT", 0, 0)).unwrap(); // 15" each, topping out at exactly 60"
    }
    let check = pallet.validate(&at("SKU-LT", 0, 0));
    assert_eq!(
        (check.status, check.rejection, check.elevation_in),
        (Status::Invalid, Some(Rejection::AboveCeiling), 60)
    );
}

#[test]
fn removing_a_case_lifts_its_load_but_crushing_is_permanent() {
    let mut pallet = Pallet::default();
    let light = pallet.commit(at("SKU-LT", 0, 0)).unwrap();
    let heavy = pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    pallet.remove(heavy).unwrap();
    let light = pallet.case(light).unwrap();
    assert_eq!(light.load_lbs, 0.0);
    assert!(light.crushed);
    assert_eq!(pallet.cases().len(), 1);
}

#[test]
fn only_cases_with_nothing_on_top_can_be_removed() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    pallet.commit(at("SKU-MQ", 0, 0)).unwrap();
    assert_eq!(pallet.remove(base), Err(RemoveError::Supporting));
    assert_eq!(pallet.remove(99), Err(RemoveError::NotFound));
    assert_eq!(pallet.cases().len(), 2);
}

#[test]
fn a_crushed_case_docks_in_proportion_to_its_overload() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-LT", 8, 7)).unwrap(); // centered at (24, 20), rated 30 lbs
    pallet.commit(at("SKU-HC", 8, 6)).unwrap(); // centered, 45 lbs: 50% over the rating
    let score = evaluate(&pallet);
    assert_eq!(score.crushed_count, 1);
    assert_eq!(score.crush_penalty, 7.5); // half of the 15% cap
    assert_eq!(score.quality_pct, 92.5);
    assert_eq!(score.grade, Grade::S);
    assert_eq!(score.composite_score, 185); // 2 cases × 92.5
}

#[test]
fn a_crush_docks_at_most_15_percent_however_far_overloaded() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-FS", 9, 8)).unwrap(); // 10 × 8 centered at (23, 20), rated 15 lbs
    pallet.commit(at("SKU-HC", 8, 6)).unwrap(); // 45 lbs: triple the rating
    let score = evaluate(&pallet);
    assert_eq!((score.crushed_count, score.crush_penalty), (1, 15.0));

    // Overload builds up through the stack: 42 lbs on a 25 lb rating is 68% over.
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-LB", 0, 0)).unwrap(); // rated 25 lbs
    pallet.commit(at("SKU-MS", 0, 0)).unwrap(); // 24 lbs holds
    pallet.commit(at("SKU-MQ", 0, 0)).unwrap(); // 18 lbs more
    let score = evaluate(&pallet);
    assert_eq!(score.crushed_count, 1);
    assert!((score.crush_penalty - 15.0 * 0.68).abs() < 1e-9);
}

#[test]
fn crush_damage_tracks_the_heaviest_load_ever_carried() {
    let mut pallet = Pallet::default();
    let light = pallet.commit(at("SKU-LT", 0, 0)).unwrap(); // rated 30 lbs
    let heavy = pallet.commit(at("SKU-HC", 0, 0)).unwrap(); // 45 lbs
    pallet.remove(heavy).unwrap();
    pallet.commit(at("SKU-FS", 0, 0)).unwrap(); // 4 lbs now, but the 45 lb damage stays
    let light = pallet.case(light).unwrap();
    assert_eq!((light.load_lbs, light.peak_load_lbs), (4.0, 45.0));
    assert!((light.overload() - 0.5).abs() < 1e-9);
    assert_eq!(evaluate(&pallet).crush_penalty, 7.5);
}

#[test]
fn test_overhang_penalties() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HC", -1, 6)).unwrap(); // 2" past the left edge
    pallet.commit(at("SKU-HC", 17, 6)).unwrap(); // 2" past the right edge; COG stays centered
    let score = evaluate(&pallet);
    assert_eq!(score.max_overhang_in, 2);
    assert_eq!(score.quality_pct, 90.0); // −5% × 2" max overhang
    assert_eq!(score.grade, Grade::S);
}

#[test]
fn center_of_gravity_drift_ramps_to_20_percent_at_12_inches() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HC", 5, 6)).unwrap(); // center (18, 20): 6" off
    let score = evaluate(&pallet);
    assert_eq!(score.cog_drift_in, 6.0);
    assert_eq!(score.quality_pct, 90.0);

    let mut corner = Pallet::default();
    corner.commit(at("SKU-HC", 0, 0)).unwrap(); // center (8, 8): 20" off, capped
    let score = evaluate(&corner);
    assert_eq!(score.cog_drift_in, 20.0);
    assert_eq!(score.quality_pct, 80.0);
}

#[test]
fn tiers_that_bridge_a_seam_earn_the_interlock_bonus() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HF", 0, 6)).unwrap(); // x 0..24
    pallet.commit(at("SKU-HF", 12, 6)).unwrap(); // x 24..48
    let mut columnar = Pallet::default();
    columnar.commit(at("SKU-HF", 0, 6)).unwrap();
    columnar.commit(at("SKU-HF", 12, 6)).unwrap();

    pallet.commit(at("SKU-MQ", 9, 7)).unwrap(); // x 18..30 bridges the seam at x 24
    columnar.commit(at("SKU-MQ", 2, 7)).unwrap(); // x 4..16 sits on one case
    assert_eq!(evaluate(&pallet).interlock_bonus, 2.0);
    assert_eq!(evaluate(&columnar).interlock_bonus, 0.0);
    // Quality is clamped to 100%.
    assert_eq!(evaluate(&pallet).quality_pct, 100.0);
}

#[test]
fn grade_tiers() {
    for (quality, grade) in [
        (100.0, Grade::S),
        (90.0, Grade::S),
        (89.9, Grade::A),
        (80.0, Grade::A),
        (79.9, Grade::B),
        (70.0, Grade::B),
        (69.9, Grade::C),
        (60.0, Grade::C),
        (59.9, Grade::F),
        (0.0, Grade::F),
    ] {
        assert_eq!(Grade::from_quality(quality), grade, "{quality}%");
    }
}

#[test]
fn an_empty_pallet_scores_perfect_quality_and_zero_points() {
    let score = evaluate(&Pallet::default());
    assert_eq!(
        (score.quality_pct, score.composite_score, score.cog_drift_in),
        (100.0, 0, 0.0)
    );
}

#[test]
fn a_one_inch_overhang_docks_5_percent() {
    let mut pallet = Pallet::default();
    // Light Tall on its side (16 × 15 base) at y 26..41.
    pallet
        .commit(Placement::new("SKU-LT", 8, 13, 0, true).unwrap())
        .unwrap();
    let score = evaluate(&pallet);
    assert_eq!((score.max_overhang_in, score.overhang_penalty), (1, 5.0));
}

#[test]
fn volume_utilization_is_case_volume_over_the_build_envelope() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    // 16 × 16 × 12 = 3072 in³ of a 48 × 40 × 60 = 115200 in³ envelope.
    let score = evaluate(&pallet);
    assert!((score.volume_utilization_pct - 8.0 / 3.0).abs() < 1e-9);
    assert_eq!((score.total_weight_lbs, score.max_height_in), (45, 12));
}

#[test]
fn rejects_grid_coordinates_far_off_the_pallet() {
    assert_eq!(
        Placement::new("SKU-HC", i32::MAX, 0, 0, false),
        Err(PlacementError::OffPallet)
    );
    assert_eq!(
        Placement::new("SKU-HC", 0, -25, 0, false),
        Err(PlacementError::OffPallet)
    );
}

#[test]
fn an_exposed_case_moves_keeping_its_id_and_its_crushing() {
    let mut pallet = Pallet::default();
    let light = pallet.commit(at("SKU-LT", 0, 0)).unwrap(); // 16 × 12 × 15, x 0..16
    let heavy = pallet.commit(at("SKU-HC", 0, 0)).unwrap(); // crushes the light case
    let mover = pallet.commit(at("SKU-MQ", 16, 0)).unwrap(); // x 32..44

    // Validating a move ignores the case itself: one cell over it still sits on the deck.
    let shifted = at("SKU-MQ", 17, 0);
    assert_eq!(pallet.validate(&shifted).elevation_in, 10);
    let check = pallet.validate_move(mover, &shifted).unwrap();
    assert_eq!((check.status, check.elevation_in), (Status::Valid, 0));
    pallet.relocate(mover, shifted).unwrap();
    let moved = pallet.case(mover).unwrap();
    assert_eq!((moved.placement, moved.elevation_in), (shifted, 0));
    assert_eq!(pallet.cases().len(), 3);

    // Moving the heavy case off lifts the load, but its victim stays crushed.
    pallet.relocate(heavy, at("SKU-HC", 8, 12)).unwrap(); // x 16..32, y 24..40
    assert_eq!(load_on(&pallet, light), 0.0);
    assert!(pallet.case(light).unwrap().crushed);
    assert_eq!(pallet.case(heavy).unwrap().elevation_in, 0);
    assert_eq!(
        pallet
            .cases()
            .iter()
            .map(|case| case.id)
            .collect::<Vec<_>>(),
        vec![light, heavy, mover]
    );
}

#[test]
fn a_move_that_breaks_a_rule_or_lifts_a_support_leaves_the_pallet_unchanged() {
    let mut pallet = Pallet::default();
    let base = pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    let top = pallet.commit(at("SKU-MQ", 0, 0)).unwrap();
    assert_eq!(
        pallet.relocate(base, at("SKU-HC", 10, 0)),
        Err(MoveError::Supporting)
    );
    assert_eq!(
        pallet.validate_move(base, &at("SKU-HC", 10, 0)).err(),
        Some(RemoveError::Supporting)
    );
    assert_eq!(
        pallet.relocate(99, at("SKU-MQ", 10, 0)),
        Err(MoveError::NotFound)
    );
    assert_eq!(
        pallet.relocate(top, at("SKU-MQ", -2, 0)),
        Err(MoveError::Rejected(Rejection::ExcessOverhang))
    );
    let top = pallet.case(top).unwrap();
    assert_eq!((top.placement, top.elevation_in), (at("SKU-MQ", 0, 0), 12));
}
