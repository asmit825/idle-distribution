import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { initSync, Engine } from '../pkg/pallet_sim.js';

before(() => initSync({ module: readFileSync(new URL('../pkg/pallet_sim_bg.wasm', import.meta.url)) }));

function withEngine(run) {
  const engine = new Engine();
  try { run(engine); } finally { engine.free(); }
}

test('compiled engine synchronously returns its version handshake', () => {
  withEngine(engine => assert.equal(engine.ping(), 'v1.0.0'));
});

test('validates a candidate placement without changing the pallet', () => {
  withEngine(engine => {
    assert.deepEqual(engine.validate_placement('SKU-HC', -1, 0, 0, false), {
      status: 'warning', rejection: null, elevation_in: 0, overhang_in: 2, unsupported_fraction: 0.125, would_crush: 0,
    });
    assert.equal(engine.get_snapshot().cases_placed, 0);
  });
});

test('commits placements and reports an authoritative snapshot', () => {
  withEngine(engine => {
    engine.commit_placement('SKU-LT', 8, 7, 0, false);
    const snapshot = engine.commit_placement('SKU-HC', 8, 6, 90, false);
    assert.equal(snapshot.cases_placed, 2);
    assert.equal(snapshot.total_weight_lbs, 55);
    assert.equal(snapshot.volume_utilization_pct, (16 * 12 * 15 + 16 * 16 * 12) / (48 * 40 * 60) * 100);
    assert.equal(snapshot.max_height_inches, 27);
    assert.equal(snapshot.crushed_count, 1);
    assert.equal(snapshot.quality_pct, 85);
    assert.equal(snapshot.composite_score, 170);
    assert.equal(snapshot.grade, 'A');
    assert.deepEqual(snapshot.placed_cases[1], {
      id: 1, sku_id: 'SKU-HC', grid_x: 8, grid_y: 6, elevation_z: 15, rotation_yaw: 90,
      flipped: false, crushed: false, weight_lbs: 45, load_lbs: 0,
    });
    assert.equal(snapshot.placed_cases[0].crushed, true);
    assert.equal(snapshot.placed_cases[0].load_lbs, 45);
    assert.deepEqual(engine.get_snapshot(), snapshot);
  });
});

test('rejects invalid commits and removals without changing the pallet', () => {
  withEngine(engine => {
    assert.throws(() => engine.commit_placement('SKU-HC', -2, 0, 0, false), /excess_overhang/);
    assert.throws(() => engine.commit_placement('SKU-XX', 0, 0, 0, false), /unknown SKU/);
    assert.throws(() => engine.validate_placement('SKU-HC', 0, 0, 45, false), /yaw/);
    assert.throws(() => engine.validate_placement('SKU-HC', 2 ** 31 - 1, 0, 0, false), /off the pallet/);
    engine.commit_placement('SKU-HC', 0, 0, 0, false);
    engine.commit_placement('SKU-MQ', 0, 0, 0, false);
    assert.throws(() => engine.remove_placement(0), /supporting/);
    const snapshot = engine.remove_placement(1);
    assert.deepEqual(snapshot.placed_cases.map(c => c.id), [0]);
  });
});

test('validate_placement averages under 0.2 ms on a full 100-case pallet, with a compact snapshot', () => {
  withEngine(engine => {
    // Five layers of twenty Fragile Smalls (10 × 8 × 6): 100 cases, top at 30".
    for (let layer = 0; layer < 5; layer++) {
      for (let x = 0; x < 4; x++) for (let y = 0; y < 5; y++) engine.commit_placement('SKU-FS', x * 5, y * 4, 0, false);
    }
    const snapshot = engine.get_snapshot();
    assert.equal(snapshot.cases_placed, 100);
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    assert.ok(bytes < 50_000, `snapshot is ${bytes} bytes`);

    const calls = 10_000;
    const start = performance.now();
    for (let i = 0; i < calls; i++) engine.validate_placement('SKU-MQ', i % 19, i % 15, (i % 4) * 90, false);
    const average = (performance.now() - start) / calls;
    console.log(`validate_placement: ${(average * 1000).toFixed(1)} µs average; snapshot ${bytes} bytes`);
    assert.ok(average < 0.2, `${average} ms`);
  });
});

test('Mode 1 stages a seeded 100-case floor and holds the shift clock until the first pick', () => {
  withEngine(engine => {
    assert.equal(engine.tick(1_000), null, 'the sandbox has no shift');
    assert.deepEqual(engine.floor_cases(), []);
    const staged = engine.start_mode1(42n);
    assert.equal(staged.cases_placed, 0);
    assert.deepEqual(staged.mode1, {
      seed: '42', phase: 'staged', time_remaining_ms: 60_000, cases_on_floor: 100,
      end_reason: null, early_finish_bonus: null, final_score: null,
    });
    const floor = engine.floor_cases();
    assert.equal(floor.length, 100);
    assert.deepEqual(Object.keys(floor[0]), ['id', 'sku_id', 'yaw']);
    withEngine(other => {
      other.start_mode1(42n);
      assert.deepEqual(other.floor_cases(), floor);
      // Every 64-bit seed is representable; the snapshot carries it as a decimal string.
      assert.equal(other.start_mode1(2n ** 64n - 1n).mode1.seed, '18446744073709551615');
    });
    assert.equal(engine.tick(5_000).phase, 'staged');
    assert.equal(engine.tick(5_000).time_remaining_ms, 60_000);
  });
});

test('Mode 1 picks, places, rejects heavy-on-light, and ships through the engine', () => {
  withEngine(engine => {
    engine.start_mode1(42n);
    const floor = engine.floor_cases();
    const light = floor.find(c => c.sku_id === 'SKU-LT');
    const heavy = floor.find(c => c.sku_id === 'SKU-HC');
    engine.pick_case(light.id, 10_000);
    assert.deepEqual(engine.tick(20_000), {
      seed: '42', phase: 'running', time_remaining_ms: 50_000, cases_on_floor: 100,
      end_reason: null, early_finish_bonus: null, final_score: null,
    });
    assert.equal(engine.commit_placement('SKU-LT', 0, 0, 0, false).mode1.cases_on_floor, 99);
    assert.throws(() => engine.pick_case(light.id, 21_000), /not on the floor/);
    // Ticket 07 allows an exposed carton to return to its original floor slot.
    assert.equal(engine.remove_placement(0, 21_000).mode1.cases_on_floor, 100);
    engine.pick_case(light.id, 21_000);
    engine.commit_placement('SKU-LT', 0, 0, 0, false);

    engine.pick_case(heavy.id, 21_000);
    assert.deepEqual(engine.validate_placement('SKU-HC', 0, 0, 0, false), {
      status: 'invalid', rejection: 'heavy_on_light', elevation_in: 15, overhang_in: 0, unsupported_fraction: 0.25, would_crush: 0,
    });
    assert.throws(() => engine.commit_placement('SKU-HC', 0, 0, 0, false), /placement rejected: heavy_on_light/);

    const shipped = engine.ship(30_000);
    assert.deepEqual(shipped.mode1, {
      seed: '42', phase: 'complete', time_remaining_ms: 40_000, cases_on_floor: 99,
      end_reason: 'shipped', early_finish_bonus: 0, final_score: 80,
    });
    assert.throws(() => engine.remove_placement(1, 31_000), /shift is over/);
    assert.equal(shipped.composite_score, 80); // one case, 20% center-of-gravity drift
    assert.throws(() => engine.pick_case(heavy.id, 31_000), /shift is over/);

    // A new shift clears the pallet.
    assert.equal(engine.start_mode1(7n).cases_placed, 0);
  });
});

test('Mode 2 exposes FIFO arrivals and freezes the engine at the fifth diversion', () => {
  withEngine(engine => {
    const initial = engine.start_mode2(42n, 1000);
    assert.equal(initial.mode1, null);
    assert.equal(initial.mode2.seed, '42');
    assert.equal(initial.mode2.arrival_interval_ms, 3500);
    assert.equal(engine.tick_mode2(4500).queue.length, 1);
    const head = engine.tick_mode2(8000).queue[0];
    assert.throws(() => engine.pick_case(head.id + 1, 8000), /pick spur/);
    engine.pick_case(head.id, 8000);
    const placed = engine.commit_placement(head.sku_id, 0, 0, 0, false);
    assert.equal(placed.cases_placed, 1);
    assert.equal(placed.mode2.queue.length, 1);
    assert.equal(placed.mode2.queue[0].id, 1);
    assert.throws(() => engine.ship(8000), /60/);
    const stopped = engine.tick_mode2(1_000_000);
    assert.equal(stopped.end_reason, 'estop');
    assert.equal(stopped.diversions_count, 5);
    assert.equal(stopped.queue.length, 10);
    assert.throws(() => engine.pick_case(1, 1_000_000), /round is over/);
    assert.equal(engine.tick_mode2(2_000_000).elapsed_ms, stopped.elapsed_ms);
    assert.equal(engine.get_snapshot().cases_placed, 1);
    assert.equal(engine.start_mode1(42n).mode2, null);
    assert.equal(engine.tick_mode2(2_000_000), null);
  });
});
