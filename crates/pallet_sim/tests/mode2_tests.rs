use pallet_sim::mode2::ConveyorRound;

#[test]
fn arrivals_start_at_three_and_a_half_seconds_and_ignore_stale_ticks() {
    let mut round = ConveyorRound::new(42, 1_000.0);
    assert_eq!(round.status().arrival_interval_ms, 3_500.0);
    round.tick(4_499.0);
    assert!(round.status().queue.is_empty());
    round.tick(4_500.0);
    assert_eq!(round.status().queue.len(), 1);
    assert_eq!(round.status().queue[0].id, 0);
    round.tick(8_000.0);
    assert_eq!(round.status().queue.len(), 2);
    let elapsed = round.status().elapsed_ms;
    round.tick(3_000.0);
    round.tick(f64::NAN);
    assert_eq!(round.status().elapsed_ms, elapsed);
}

#[test]
fn difficulty_scales_the_arrival_interval() {
    use pallet_sim::mode2::Difficulty;
    let interval = |difficulty| ConveyorRound::with_difficulty(42, 0.0, difficulty).status().arrival_interval_ms;
    assert_eq!(interval(Difficulty::Medium), 3_500.0);
    assert_eq!(interval(Difficulty::Easy), 5_250.0);
    assert_eq!(interval(Difficulty::Hard), 2_187.5);
    assert_eq!(Difficulty::parse("hard"), Some(Difficulty::Hard));
    assert_eq!(Difficulty::parse("nope"), None);
}

#[test]
fn recirculation_signals_overflow_and_the_fifth_diversion_stop_at_the_exact_deadline() {
    use pallet_sim::mode2::{EndReason, Signal};
    let mut round = ConveyorRound::new(42, 0.0);
    assert_eq!(round.status().signal, Signal::Green);
    // Cartons wrap the pick lane first; only those beyond it are on the recirculation lane.
    let mut seen = Vec::new();
    let mut count = 0;
    while round.status().recirculating < 10 {
        count += 1;
        round.tick(count as f64 * 3_500.0);
        let status = round.status();
        assert_eq!(status.recirculating, status.queue.len() - status.final_run);
        let expected = match status.recirculating {
            0..=4 => Signal::Green,
            5..=9 => Signal::Yellow,
            _ => Signal::Red,
        };
        assert_eq!(status.signal, expected);
        seen.push(status.signal);
        assert!(count < 40);
    }
    assert!(seen.contains(&Signal::Green) && seen.contains(&Signal::Yellow));
    assert_eq!(round.status().signal, Signal::Red);
    assert!(round.status().queue.len() > 10, "the pick lane holds cartons too");
    assert_eq!(round.status().diversions_count, 0);
    let full_at = count as f64 * 3_500.0;
    round.tick(full_at + 4.0 * 3_500.0);
    assert_eq!(round.status().diversions_count, 4);
    assert_eq!(round.status().end_reason, None);
    round.tick(1_000_000.0); // A suspended tab catches up, without running past the Estop.
    let status = round.status();
    assert_eq!(status.diversions_count, 5);
    assert_eq!(status.end_reason, Some(EndReason::Estop));
    assert_eq!(status.elapsed_ms, full_at + 5.0 * 3_500.0);
    round.tick(2_000_000.0);
    assert_eq!(round.status().elapsed_ms, full_at + 5.0 * 3_500.0);
}

#[test]
fn fifo_placement_accelerates_arrivals_and_a_partial_pallet_ships_for_less() {
    use pallet_sim::{
        grid::Placement,
        mode2::{ConveyorError, EndReason},
    };
    // This seed's first four arrivals are Light Tall (15 inches high, 10 lb each).
    let mut round = ConveyorRound::new(2149, 0.0);
    assert_eq!(round.ship(0.0), Err(ConveyorError::EmptyPallet));
    assert!(!round.status().can_ship);
    assert_eq!(round.pick(0, 0.0), Err(ConveyorError::NotOnFinalRun));
    let mut now = 0.0;
    for (index, expected_interval) in [3_125.0, 2_750.0, 2_375.0, 2_000.0].iter().enumerate() {
        now += round.status().arrival_interval_ms;
        round.tick(now);
        let head = round.status().queue[0];
        assert_eq!(head.sku_id, "SKU-LT");
        assert_eq!(
            round.pick(head.id + 1, now), // not here yet
            Err(ConveyorError::NotOnFinalRun)
        );
        round.pick(head.id, now).unwrap();
        // Picking reserves its queue slot; a cancelled or invalid drag cannot shed inventory.
        assert_eq!(round.status().queue.len(), 1);
        let placement = Placement::new("SKU-LT", 8, 7, 0, false).unwrap();
        round.place(placement, now).unwrap();
        assert!(round.status().queue.is_empty());
        assert_eq!(round.status().arrival_interval_ms, *expected_interval);
        assert!(round.status().can_ship);
        assert_eq!(round.status().fill_pct, 25.0 * (index + 1) as f64);
    }
    assert_eq!(round.pallet().cases().len(), 4);
    assert_eq!(round.status().end_reason, None); // The line keeps running until Ship.
    round.ship(now + 500.0).unwrap();
    assert_eq!(round.status().end_reason, Some(EndReason::Shipped));
    assert_eq!(round.status().elapsed_ms, 12_250.0);
    round.tick(100_000.0);
    assert_eq!(round.status().elapsed_ms, 12_250.0);
    assert_eq!(round.pick(4, 100_000.0), Err(ConveyorError::RoundOver));
}

#[test]
fn acceleration_preserves_the_incoming_cartons_fractional_travel() {
    use pallet_sim::grid::Placement;
    let mut round = ConveyorRound::new(2149, 0.0);
    round.pick(0, 3_500.0).unwrap();
    round.tick(5_250.0); // The next arrival is halfway down the belt.
    round
        .place(Placement::new("SKU-LT", 8, 7, 0, false).unwrap(), 5_250.0)
        .unwrap();
    assert_eq!(round.status().arrival_progress, 0.5);
    round.tick(6_812.49);
    assert!(round.status().queue.is_empty());
    round.tick(6_812.5); // Half of the new 3.125-second interval after the drop.
    assert_eq!(round.status().queue[0].id, 1);
}

#[test]
fn invalid_or_spoofed_drops_preserve_the_queue_and_estop_cancels_a_held_case() {
    use pallet_sim::{
        grid::{Placement, Rejection},
        mode2::ConveyorError,
    };
    let mut round = ConveyorRound::new(2149, 0.0);
    round.pick(0, 3_500.0).unwrap();
    assert_eq!(
        round.place(Placement::new("SKU-HC", 0, 0, 0, false).unwrap(), 3_500.0),
        Err(ConveyorError::NotHeld)
    );
    assert_eq!(
        round.place(Placement::new("SKU-LT", -2, 0, 0, false).unwrap(), 3_500.0),
        Err(ConveyorError::Rejected(Rejection::ExcessOverhang))
    );
    assert_eq!(round.status().queue.len(), 1);
    assert!(round.pallet().cases().is_empty());
    assert_eq!(
        round.place(Placement::new("SKU-LT", 0, 0, 0, false).unwrap(), 1_000_000.0),
        Err(ConveyorError::RoundOver)
    );
    assert!(round.pallet().cases().is_empty());
    assert_eq!(round.status().recirculating, 10);
}

#[test]
fn seed_and_event_deadlines_are_independent_of_frame_frequency() {
    let mut coarse = ConveyorRound::new(u64::MAX, 900.0);
    let mut fine = ConveyorRound::new(u64::MAX, 900.0);
    coarse.tick(35_900.0);
    for tick in 1..=3_500 {
        fine.tick(900.0 + tick as f64 * 10.0);
    }
    assert_eq!(coarse.status().queue, fine.status().queue);
    assert_eq!(coarse.status().incoming, fine.status().incoming);
    assert_eq!(coarse.status().diversions_count, 0);
    let mut other = ConveyorRound::new(2149, 900.0);
    other.tick(35_900.0);
    assert_ne!(coarse.status().queue, other.status().queue);
}

#[test]
fn placed_cartons_move_until_the_round_ends() {
    use pallet_sim::{grid::Placement, mode2::ConveyorError};
    let mut round = ConveyorRound::new(2149, 0.0);
    round.pick(0, 3_500.0).unwrap();
    let id = round
        .place(Placement::new("SKU-LT", 0, 0, 0, false).unwrap(), 3_500.0)
        .unwrap();
    let moved = Placement::new("SKU-LT", 4, 2, 90, false).unwrap();
    round.relocate(id, moved, 4_000.0).unwrap();
    assert_eq!(round.pallet().case(id).unwrap().placement, moved);
    assert_eq!(
        round.relocate(id, moved, 120_000.0),
        Err(ConveyorError::RoundOver)
    );
}

#[test]
fn any_carton_on_the_final_run_can_be_picked_in_any_order() {
    use pallet_sim::{grid::Placement, mode2::ConveyorError};
    // Seed 2149 queues LT LT LT LT MS HC HF LB HC HC. Riding lengthwise, they take 12, 12, 12,
    // 12, 12, 16, 16, 16, 16, 16 inches of belt: the 116" final run holds the first eight (108").
    let mut round = ConveyorRound::new(2149, 0.0);
    round.tick(35_000.0);
    let status = round.status();
    assert_eq!((status.queue.len(), status.final_run), (10, 8));
    assert_eq!(round.pick(8, 35_000.0), Err(ConveyorError::NotOnFinalRun));

    // The Light Bulky, eighth in line, jumps the queue.
    round.pick(7, 35_000.0).unwrap();
    assert_eq!(round.status().queue.len(), 10); // still reserving its slot while held
    round
        .place(Placement::new("SKU-LB", 4, 4, 0, false).unwrap(), 35_000.0)
        .unwrap();
    let status = round.status();
    let ids: Vec<u32> = status.queue.iter().map(|case| case.id).collect();
    assert_eq!(ids, vec![0, 1, 2, 3, 4, 5, 6, 8, 9]);
    // The line closes up, bringing the next Heavy Cube onto the final run.
    assert_eq!(status.final_run, 8);
    round.pick(8, 35_000.0).unwrap();
    assert_eq!(
        round.place(Placement::new("SKU-LB", 4, 4, 0, false).unwrap(), 35_000.0),
        Err(ConveyorError::NotHeld)
    );
}

#[test]
fn a_partial_pallet_can_ship_at_any_moment_and_scores_less() {
    use pallet_sim::{grid::Placement, mode2::EndReason};
    let ship = |layers: i32| {
        let mut round = ConveyorRound::new(2149, 0.0);
        let mut now = 0.0;
        for _ in 0..layers {
            now += round.status().arrival_interval_ms;
            round.tick(now);
            let head = round.status().queue[0];
            round.pick(head.id, now).unwrap();
            round.place(Placement::new("SKU-LT", 8, 7, 0, false).unwrap(), now).unwrap();
        }
        assert_eq!(round.status().final_score, None);
        round.ship(now).unwrap();
        let status = round.status();
        assert_eq!(status.end_reason, Some(EndReason::Shipped));
        status.final_score.unwrap()
    };
    let (partial, full) = (ship(2), ship(4));
    assert!(partial > 0 && partial < full, "{partial} < {full}");
}

#[test]
fn doing_no_work_earns_an_f_and_an_estop_always_fails() {
    use pallet_sim::{grid::Placement, scoring::Grade};
    let mut idle = ConveyorRound::new(2149, 0.0);
    assert_eq!(idle.grade(), Grade::F);
    idle.tick(1_000_000.0); // Recirculates until the Estop without stacking anything.
    assert_eq!(idle.grade(), Grade::F);
    // A little work is graded on how full the pallet is, not on its flawless single case.
    let mut round = ConveyorRound::new(2149, 0.0);
    round.pick(0, 3_500.0).unwrap();
    round.place(Placement::new("SKU-LT", 8, 7, 0, false).unwrap(), 3_500.0).unwrap();
    assert_eq!(round.grade(), Grade::F); // 25% full
    round.tick(1_000_000.0);
    assert_eq!(round.grade(), Grade::F); // Estop
}

#[test]
fn a_sandbox_line_pauses_arrivals_while_recirculation_is_full_and_never_stops() {
    use pallet_sim::{grid::Placement, mode2::Signal};
    let mut round = ConveyorRound::new(42, 0.0).sandbox();
    round.tick(1_000_000.0);
    let status = round.status();
    assert!(status.sandbox);
    assert_eq!((status.signal, status.recirculating), (Signal::Red, 10));
    assert_eq!((status.diversions_count, status.end_reason), (0, None));
    assert_eq!(status.arrival_progress, 1.0, "the next carton waits at the infeed");
    assert_eq!(status.elapsed_ms, 1_000_000.0);
    let waiting = status.incoming;
    let queued = status.queue.len();

    // Clearing a carton makes room: the waiting one joins the line on the next tick.
    let head = status.queue[0];
    round.pick(head.id, 1_000_000.0).unwrap();
    let placement = Placement::new(head.sku_id, 0, 0, 0, false).unwrap();
    round.place(placement, 1_000_000.0).unwrap();
    round.tick(1_000_001.0);
    let status = round.status();
    assert_eq!(status.queue.len(), queued);
    assert_eq!(status.queue.last(), Some(&waiting));
    assert!(status.arrival_progress < 0.01);
}

#[test]
fn a_timed_line_is_not_a_sandbox() {
    assert!(!ConveyorRound::new(42, 0.0).status().sandbox);
}
