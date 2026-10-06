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
fn buffer_signals_overflow_and_the_fifth_diversion_stop_at_the_exact_deadline() {
    use pallet_sim::mode2::{EndReason, Signal};
    let mut round = ConveyorRound::new(42, 0.0);
    assert_eq!(round.status().signal, Signal::Green);
    for (count, signal) in [
        (5, Signal::Green),
        (6, Signal::Yellow),
        (8, Signal::Yellow),
        (9, Signal::Red),
        (10, Signal::Red),
    ] {
        round.tick(count as f64 * 3_500.0);
        assert_eq!(round.status().queue.len(), count);
        assert_eq!(round.status().signal, signal);
    }
    round.tick(49_000.0);
    assert_eq!(round.status().queue.len(), 10);
    assert_eq!(round.status().diversions_count, 4);
    assert_eq!(round.status().end_reason, None);
    round.tick(1_000_000.0); // A suspended tab catches up, without running past the Estop.
    let status = round.status();
    assert_eq!(status.diversions_count, 5);
    assert_eq!(status.end_reason, Some(EndReason::Estop));
    assert_eq!(status.elapsed_ms, 52_500.0);
    assert_eq!(
        status.queue.iter().map(|case| case.id).collect::<Vec<_>>(),
        (0..10).collect::<Vec<_>>()
    );
    round.tick(2_000_000.0);
    assert_eq!(round.status().elapsed_ms, 52_500.0);
}

#[test]
fn fifo_placement_accelerates_arrivals_and_unlocks_shipping_at_sixty_inches() {
    use pallet_sim::{
        grid::Placement,
        mode2::{ConveyorError, EndReason},
    };
    // This seed's first four arrivals are Light Tall (15 inches high, 10 lb each).
    let mut round = ConveyorRound::new(2149, 0.0);
    assert_eq!(round.ship(0.0), Err(ConveyorError::HeightNotReached));
    assert_eq!(round.pick(0, 0.0), Err(ConveyorError::NotAtPickSpur));
    let mut now = 0.0;
    for (index, expected_interval) in [3_125.0, 2_750.0, 2_375.0, 2_000.0].iter().enumerate() {
        now += round.status().arrival_interval_ms;
        round.tick(now);
        let head = round.status().queue[0];
        assert_eq!(head.sku_id, "SKU-LT");
        assert_eq!(
            round.pick(head.id + 1, now),
            Err(ConveyorError::NotAtPickSpur)
        );
        round.pick(head.id, now).unwrap();
        // Picking reserves its queue slot; a cancelled or invalid drag cannot shed inventory.
        assert_eq!(round.status().queue.len(), 1);
        let placement = Placement::new("SKU-LT", 8, 7, 0, false).unwrap();
        round.place(placement, now).unwrap();
        assert!(round.status().queue.is_empty());
        assert_eq!(round.status().arrival_interval_ms, *expected_interval);
        assert_eq!(round.status().can_ship, index == 3);
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
        round.place(Placement::new("SKU-LT", 0, 0, 0, false).unwrap(), 52_500.0),
        Err(ConveyorError::RoundOver)
    );
    assert!(round.pallet().cases().is_empty());
    assert_eq!(round.status().queue.len(), 10);
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
