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
