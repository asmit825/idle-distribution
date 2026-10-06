import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initSync, Engine } from '../pkg/pallet_sim.js';

test('compiled engine synchronously returns its version handshake', () => {
  initSync({ module: readFileSync(new URL('../pkg/pallet_sim_bg.wasm', import.meta.url)) });
  const engine = new Engine();
  try { assert.equal(engine.ping(), 'v1.0.0'); }
  finally { engine.free(); }
});
