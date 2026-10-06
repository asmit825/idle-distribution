use pallet_sim::grid::{Placement, PlacementError, Rejection, Status};
use pallet_sim::physics::{Pallet, RemoveError};
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
fn rejects_a_base_more_than_30_percent_unsupported() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HC", 0, 0)).unwrap();
    // Medium Standard x 0..20 over the 16" cube: 20% unsupported, allowed.
    let check = pallet.validate(&at("SKU-MS", 0, 0));
    assert_eq!(check.status, Status::Valid);
    assert!((check.unsupported_fraction - 0.2).abs() < 1e-9);
    // Medium Square x 10..22: half its base over air.
    let check = pallet.validate(&at("SKU-MQ", 5, 0));
    assert_eq!(
        (check.status, check.rejection),
        (Status::Invalid, Some(Rejection::Unsupported))
    );
    assert!(pallet.commit(at("SKU-MQ", 5, 0)).is_err());
    assert_eq!(pallet.cases().len(), 1);
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
fn each_crushed_case_docks_exactly_15_percent() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-LT", 8, 7)).unwrap(); // centered at (24, 20)
    pallet.commit(at("SKU-HC", 8, 6)).unwrap(); // centered, crushes the Light Tall
    let score = evaluate(&pallet);
    assert_eq!(score.crushed_count, 1);
    assert_eq!(score.quality_pct, 85.0);
    assert_eq!(score.grade, Grade::A);
    assert_eq!(score.composite_score, 170); // 2 cases × 85
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
fn exactly_30_percent_unsupported_is_still_allowed() {
    let mut pallet = Pallet::default();
    pallet.commit(at("SKU-HC", 0, 0)).unwrap(); // x 0..16

    // Medium Standard at x 2..22: 14 of its 20" rest on the cube, exactly 30% over air.
    let check = pallet.validate(&at("SKU-MS", 1, 0));
    assert_eq!(check.status, Status::Valid);
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
