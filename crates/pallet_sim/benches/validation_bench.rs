//! Placement validation latency on a full 100-case pallet (SPEC-01 §10.1).
//!
//! Run with `cargo bench`. A plain `harness = false` timing loop: no benchmark framework, and it
//! fails the run when the average call exceeds the budget. The Wasm boundary itself is timed in
//! `tests/engine.test.mjs`.

use std::hint::black_box;
use std::time::Instant;

use pallet_sim::grid::Placement;
use pallet_sim::physics::Pallet;

const CALLS: u32 = 10_000;
const BUDGET_MS: f64 = 0.5;

fn main() {
    // Five layers of twenty Fragile Smalls (10 × 8 × 6): 100 cases, top at 30".
    let mut pallet = Pallet::default();
    for _layer in 0..5 {
        for x in 0..4 {
            for y in 0..5 {
                pallet
                    .commit(Placement::new("SKU-FS", x * 5, y * 4, 0, false).unwrap())
                    .unwrap();
            }
        }
    }
    assert_eq!(pallet.cases().len(), 100);

    // Synthetic aims sweeping the deck and all four yaws, built before timing starts.
    let aims: Vec<Placement> = (0..CALLS as i32)
        .map(|i| Placement::new("SKU-MQ", i % 19, i % 15, (i % 4) as u16 * 90, i % 7 == 0).unwrap())
        .collect();
    let start = Instant::now();
    for aim in &aims {
        black_box(pallet.validate(black_box(aim)));
    }
    let average_ms = start.elapsed().as_secs_f64() * 1000.0 / CALLS as f64;
    println!(
        "validate_placement: {:.2} µs average over {CALLS} calls on a 100-case pallet",
        average_ms * 1000.0
    );
    assert!(
        average_ms < BUDGET_MS,
        "{average_ms} ms average exceeds the {BUDGET_MS} ms budget"
    );
}
