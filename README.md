# Idle Distribution

**Idle Distribution** is a Tetris-inspired pallet-building and logistics management game. The core gameplay challenges players to construct optimal pallets under realistic distribution constraints, balancing spatial precision with operational speed.

> **Note**: This README is a living document and will be updated iteratively as the game design, mechanics, and architecture evolve.

---

## 🎯 Core Concept & Objectives

The primary goal is to build the highest-scoring pallet possible by optimizing across two critical dimensions:

1. **Quality & Structural Integrity**
   - **Spatial Packing**: Efficiently fitting varying package sizes, shapes, and weights onto standard warehouse pallets.
   - **Stack Stability**: Adhering to real-world stacking principles (e.g., interlocking layers, weight distribution, avoiding overhang, protecting fragile items).
   - **Volume Utilization**: Maximizing cubic volume while respecting height, weight, and center-of-gravity limits.

2. **Timing & Throughput**
   - **Speed & Cycle Time**: Completing pallets rapidly to meet dock dispatch schedules and prevent fulfillment bottlenecks.
   - **Pacing**: Balancing rushed placements against structural stability risks.

---

## 🔄 Idle & Progression Loop (Planned)

- **Warehouse Upgrades**: Faster conveyor feeds, automated wrapping, weight sensors, and specialized stacking tools.
- **Order Variety**: Managing mixed-SKU shipments, fragile goods, refrigerated items, and hazardous material constraints.
- **Automation & Dispatch**: Unlocking automated palletizers, staging lanes, and outbound fleet dispatching.

---

## 📚 Project Structure & References

- [`reference-docs/`](./reference-docs/) — Industry guidelines, packaging manuals, and research documents.
  - [`supply-chain-packaging-guide.pdf`](./reference-docs/supply-chain-packaging-guide.pdf) — Reference specifications for supply chain packaging and handling standards.


## Run the pallet scaffold

Ticket 01 implements the Rust/Wasm handshake and a procedural pallet inspection viewport. Gameplay, case placement, scoring, and storage are later tickets.

Prerequisites: Node.js 22.12+ and the stable Rust toolchain (`cargo` / `rustup`). The npm lockfile includes a project-local `wasm-pack`.

```sh
npm ci
rustup target add wasm32-unknown-unknown
# Matches the wasm-bindgen version in crates/pallet_sim/Cargo.lock.
# Installing explicitly avoids wasm-pack's prebuilt download fallback on Apple Silicon.
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm run dev
```

`npm run dev` builds Wasm first, then starts Vite with React hot-module replacement. Re-run `npm run build:wasm` after Rust changes; Vite picks up the regenerated bindings. Build output goes to root `pkg/` (generated and ignored).

```sh
npm run build:wasm
npm run typecheck
npm run build
npm run preview
```

The browser fetches the Wasm bytes, calls `initSync` on the main thread, constructs `Engine`, and logs `Engine initialized: v1.0.0` before mounting the app. Initialization errors appear on screen. The app opens on the Formation 3 staging terminal: select the floor sprint, conveyor, or saved pallet gallery, then launch. The terminal includes saved career statistics, the rules dialog, optional sound effects, and a rotating pallet preview. Open `?mode=1` or `?mode=2` to enter a game directly, or `?gallery=true` for the gallery. Add `&seed=<u64>` to a mode URL to replay a specific floor. **Exit to Terminal** returns home; navigation retains the seed and supports browser Back/Forward. Leaving an unfinished shift discards that run. Drag a floor carton onto the pallet to place it (see *Placing cases* below). Drag empty space to orbit, scroll or pinch to zoom, and right-drag or two-finger drag to pan.

### Verification

```sh
npx playwright install chromium
npm test
```

The suite runs the Rust unit tests (catalog, stacking physics, scoring, and the Mode 1 shift), exercises the actual compiled Wasm API (including a `validate_placement` latency benchmark), runs the Vitest unit tests under `src/` (pallet geometry including raycasts through both fork openings, Rust ↔ TypeScript SKU catalog parity, procedural carton textures, carton meshes, the pointer pipeline, placement against the real Wasm engine with a per-move latency check, Mode 1 floor layouts, and camera framing), and checks browser startup, orbit, desktop/phone resize, mouse drag-and-drop, and a full Mode 1 shift on Playwright's fake clock. Browser tests start their own dev server on port 4173. Individual commands are `npm run test:rust`, `npm run test:wasm`, `npm run test:unit`, and `npm run test:browser`; build Wasm before running `test:wasm` or `test:unit` alone. Texture tests paint on a real Skia canvas via the `@napi-rs/canvas` dev dependency.

#### Full verification pipeline (ticket 09)

```sh
npx playwright install chromium firefox webkit
npm run test:all
```

`test:all` runs `npm test`, then:

- `npm run test:bench`: `crates/pallet_sim/benches/validation_bench.rs` times 10,000 native `Pallet::validate` calls on a 100-case pallet and fails above 0.5 ms per call. It averages about 19 µs on an M4 Pro, most of it judging the whole stack with the candidate in it. The Wasm boundary is timed separately in `tests/engine.test.mjs` (budget 0.2 ms, plus a < 50 KB snapshot check). `cargo test` also runs `tests/property_tests.rs`, which replays 64 seeded random placement sequences. Validation must predict every commit, cases stay under the ceiling with at most 2" overhang, every case's weight reaches the deck, no case tips, overloaded cases are crushed and stay crushed, quality stays within 0–100, and replays are identical.
- `npm run test:e2e`: `tests/e2e/touch_test.js` is a standalone Node script that runs its own dev server on port 4175 and drives Chromium with raw CDP `Input.dispatchTouchEvent` multi-touch. It passes 23/23 assertions (D-pad and arrow-key steps are also checked for on-screen direction and reversal):
  - iPhone 13, portrait then rotated to landscape: compact HUD, 48px thumb targets, floor framing and re-staging, tap-to-pick with jitter, D-pad tap and hold-to-repeat, Remove, the 64px drag lift, second-finger rotation, and drops.
  - Camera gestures on a fresh phone floor: swipe orbit, pinch zoom, two-finger pan.
  - iPad Pro 11 landscape: compact from the coarse pointer alone, plus a drag-and-drop.
  - Mode 1 ↔ Mode 2 toggling by touch, with a conveyor pick.
  - Desktop mouse drag-and-drop with `R`/`F`, and arrow/WASD nudges.

  The suite fails if any page logs a console error or warning.
- `npm run test:perf`: `tests/e2e/perf_test.js` profiles frame cadence on desktop at 1440×900 @2x and on iPhone 13. Each runs a Mode 1 shift with its first 25-case wave in the scene, 10 of them stacked two high on the pallet. It samples 240 frames at rest and 240 while a carton is dragged over the stack, and requires ≥ 58 FPS with at most 2% of frames over 25 ms. It refuses to pass on a software renderer. Before each sample it times a blank page, and if the host itself caps frames below 60 Hz, it fails with a message to plug in. On battery or in Low Power Mode, macOS can throttle every page to 30 FPS.
- `npm run test:compat`: `tests/compat/console.spec.ts` boots the app, drags a carton onto the pallet, and switches modes in Chrome, Firefox, and WebKit (Safari's engine) with no console errors or warnings. It adds Edge when Edge is installed.

The e2e and perf scripts launch Playwright's full Chromium build in new headless mode, which renders WebGL on the host GPU. The default headless shell falls back to SwiftShader. In development, `window.__palletTest.floorBounds()` returns the client-space box around every floor carton, which the suite uses to check framing.

### Geometry conventions

One rendering unit is one inch. Three.js uses Y up, with the pallet's geometric center at `(0, 0, 0)` and bounds `X ±24`, `Y ±2.375`, `Z ±20`. Top deck elevation is `Y = 2.375`. The domain model uses corner-based X/Y and vertical Z; future case rendering should map `(x, y, elevation)` to `(x - 24, elevation + 2.375, y - 20)`.

The mesh contains seven top boards, three continuous notched stringers, and five bottom boards. Each runner has two 9 × 1.25 inch openings beginning six inches from its ends. Wood grain and flush nail heads are procedural. The React viewport disposes GPU resources, controls, animation callbacks, and resize listeners on unmount, including hot reload and Strict Mode remounts.

The `uuid` override updates the top-level-await plugin's transitive dependency to its patched compatible API. Keep this override until the plugin updates its dependency.

### Cartons

The 8-SKU catalog (SPEC-01 §2.2) lives in `crates/pallet_sim/src/sku.rs` and is mirrored by `src/types/catalog.ts`; the Wasm export `sku_catalog()` lets the unit tests enforce parity. `src/rendering/materials.ts` paints every face on its own canvas at 32 px per inch, so no face stretches, with kraft, flutes, tape style, weight badge, Code 39 shipping label, and handling marks. Red encodes bump height and green encodes roughness in one surface texture. Materials are cached per SKU and shared by every carton of that SKU.

`createBoxMesh(sku, { crushed })` in `src/rendering/BoxMesh.tsx` returns a carton whose origin is the center of its base. It renders 1/8" inside its grid footprint on each side (`cartonSize` in `materials.ts`), so flush neighbors never share a plane. Setting `crushed` eases over 0.25 s to 0.92 height with the base planted. A morph target sinks the top and bows the sides at the same time. The lateral bulge is 1.03, capped 1/64" inside the grid footprint so crushed neighbors never touch; in practice the cap always applies. The engine keeps crushed cases at full height so the stack never shifts. Lowering whatever sits on a crushed carton is a rendering job. The `<BoxMesh parent={…} sku={…} />` component mounts one into the imperative scene; the viewport stages one carton of each SKU on the floor and disposes the cached materials on unmount.

### Stacking engine

`Engine` (in `crates/pallet_sim/src/lib.rs`) is the authoritative pallet. It runs synchronously on the main thread. A new `Engine` allows free placement until `start_mode1` or `start_mode2`.

- `validate_placement(sku_id, grid_x, grid_y, rot_z, flipped)` → `{ status: 'valid' | 'warning' | 'invalid', rejection, elevation_in, overhang_in, unsupported_fraction, would_crush }`. It does not change the pallet.
- `commit_placement(...)` → snapshot, or throws `placement rejected: <reason>`.
- `validate_move(case_id, grid_x, grid_y, rot_z, flipped)` → the same verdict for an exposed placed case, judged as if it were already lifted off (it never lands on itself). Mode 1 applies its heavy-on-light rule.
- `move_placement(case_id, grid_x, grid_y, rot_z, flipped, now_ms?)` → snapshot, or throws. The case keeps its id, and stays crushed if it was. Only exposed cases move, and not after a round ends; the floor and conveyor are unchanged.
- `remove_placement(case_id, now_ms?)` → snapshot. It rejects supporting cases and completed rounds. Mode 1 restores the original floor case; Mode 2 discards the carton without re-entering its FIFO. Pass the current monotonic time during a round.
- `get_snapshot()` → `{ cases_placed, total_weight_lbs, max_height_inches, volume_utilization_pct, max_overhang_inches, cog_inches, cog_drift_inches, crushed_count, quality_pct, crush_penalty, overhang_penalty, drift_penalty, interlock_bonus, composite_score, grade, placed_cases: [{ id, sku_id, grid_x, grid_y, elevation_z, rotation_yaw, flipped, crushed, weight_lbs, load_lbs }], mode1, mode2 }`, with the active mode status populated and the other `null`.

**Placement**
- `grid_x`/`grid_y` give the case's min-corner cell; −1 allows a 2" overhang.
- `rot_z` is 0, 90, 180, or 270 degrees. Unknown SKUs, other yaws, and anchors far off the deck throw.
- `flipped` rolls the case onto its side, so its width becomes its height.
- Geometry is exact integer inches (`grid.rs`), so non-cell footprints such as a flipped 15" side still work.
- A case settles on the highest top beneath its footprint. Rejections, in priority order: above the 60" ceiling, more than 2" overhang, `unsupported` (it would tip).
- **Tipping**: a case may hang past the cases beneath it, by any amount, while it balances. Each case bears down at the balance point of its own weight plus everything it carries; that point must sit strictly inside the convex hull of its contact patches. On the edge is a knife edge and tips. The check covers the whole stack, so weight piled on an overhanging end can tip the case under it. A case resting on several supports passes each its area share at the point of that patch nearest its balance point.
- Status is `warning` for a soft overhang, or when the case's weight would crush a case below.

**Loads** (`physics.rs`)
- Each case passes its weight plus its own load to its supports, pro-rata by contact area. The shares are normalized over the supported area, so all of the weight reaches the supports.
- A case crushes when its cumulative load exceeds its top-load capacity; a load equal to capacity is safe. Crushing is permanent, and so is the damage: each case keeps the heaviest load it has ever carried (`peak_load_lbs`), even after that load is lifted or the case is moved.

**Scoring** (`scoring.rs`, SPEC-01 §2.4)
- Quality = 100 − crush − 5 × max overhang (inches) − drift + interlock, clamped to 0–100.
- Crush = for each crushed case, 15% × its overload, capped at 15%. Overload is how far its peak load went past its rating, as a fraction of the rating: a 45 lb Heavy Cube on a 30 lb-rated Light Tall is 50% over and docks 7.5%; at double its rating a case docks the full 15%.
- Drift = 20% × distance of the center of gravity from (24, 20) ÷ 12", capped at 20%.
- Interlock adds 2% for each elevation where some case bridges two or more supports, up to 10%.
- Composite score = cases × quality. Grades: S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, F below 60.

### Mode 1: 100-case free staging

A 60-second shift (SPEC-01 §5.1). Its 100 cases reach the floor in four waves of 25: the next wave arrives as soon as every case on the floor is on the pallet, and the status line announces it. The rules and the clock live in `crates/pallet_sim/src/mode1.rs`; `src/hooks/useMode1GameLoop.ts` keeps React in step with them.

- `start_mode1(seed: bigint, sandbox?: boolean)` → snapshot. Clears the pallet and spawns 100 floor cases from the 64-bit seed with ChaCha8: each SKU uniformly at random, lying lengthwise along X or Z. The same seed gives the same floor on every device.
- `floor_cases()` → `[{ id, sku_id, yaw, on_floor }]` for the cases whose wave has arrived, waiting or placed. Where they sit is the UI's layout: each wave is laid out on its own, and an earlier case taken back off the pallet joins the end of the current wave's floor.
- `pick_case(floor_id, now_ms)` lifts a floor case. The first pick starts the clock; inspecting the floor beforehand is free. `commit_placement` then drops the picked case at the latest time the engine has seen; the UI ticks the clock right before each drop (`canDrop`), so a drop after 0:00 returns the case instead.
- `tick(now_ms)` → `{ seed, sandbox, phase: 'staged' | 'running' | 'complete', time_remaining_ms, elapsed_ms, wave, cases_on_floor, end_reason, early_finish_bonus, final_score }`. `cases_on_floor` counts only arrived cases. Times are `performance.now()` milliseconds; earlier timestamps never wind the clock back. The remaining time rounds up, so 0:00 means truly out of time.
- `ship(now_ms)` → snapshot. Ends the shift; an empty pallet can ship before the clock starts.
- **Heavy on light** is allowed. The ghost turns yellow when the drop would crush a case below, and the crush docks Load Quality in proportion to the overload.
- The shift ends at 0:00 (`time_up`, cancelling any held case), on Ship (`shipped`), or when the last wave's floor is empty (`all_placed`). Placing every case earns an early finish bonus of remaining seconds × 100 × quality, quality as a fraction, so a second saved is worth a case placed at that quality. Final score = composite score + bonus. 100 random cases average about 2,400 in³ against a 115,200 in³ build envelope, so a seeded floor can't actually fit on one pallet; the bonus path is tested with a two-case floor.
- **Floor layout** (`src/game/FloorStaging.ts`): on desktop, eight clusters packed in rows; the four sides hug the pallet first, then the corners slide out along their diagonals until clear. On phones, one case per 26" bay slot, with the pallet in the center 2 × 2 block, filling an ellipse stretched up the screen in portrait and across it in landscape (the isometric camera looks along the X = Z diagonal). An orientation change re-stages the floor and reframes the camera.
- The header shows the clock and **Ship pallet**; a result panel (ending, grade, cases, quality, scores, **New shift**) appears when the shift completes. The full result modal is ticket 07.

### Sandbox

Both modes have a **Sandbox** play style for playing without pressure. Pick **Timed** or **Sandbox** on the landing screen, or press **Sandbox** in the in-game mode bar (switching starts a fresh round). The choice is remembered in `localStorage` (`idle-distribution:sandbox`).

- **Mode 1** (`Shift::sandbox` in `mode1.rs`, `start_mode1(seed, true)`): no clock. The header counts time played up from the first pick (`elapsed_ms`), `time_remaining_ms` stays at 60 000, and the shift never ends on time. The first 100 cases match the timed shift for the same seed; after that, every cleared floor deals another 25 from the same seeded supply, so the shift only ends on **Ship pallet**. Heavy-on-light still applies, and there is no early finish bonus.
- **Mode 2** (`ConveyorRound::sandbox` in `mode2.rs`, `start_mode2(seed, now_ms, difficulty, true)`): nothing diverts. When the recirculation lane is full, the next carton waits at the infeed (`arrival_progress` holds at 1) and joins the line once there is room, so there are no diversions and no Estop. The signal shows **Line paused** instead of the overflow countdown. Difficulty, shipping, and the hauler work as in a timed run.
- Shipped sandbox pallets are saved with `sandbox: true`. They appear in the gallery as *Mode N Sandbox*, but they are left out of personal bests and the landing page's career stats.

### Placing cases

In free placement (before any round starts), each of the eight floor bays (`src/scene/staging.ts`) holds one carton and refills after a placement. In Mode 1, a bay stays empty once its case is on the pallet, and the floor locks when the shift ends.

- **Pointer pipeline** (`src/controls/PointerManager.ts`): one Pointer Events path for mouse, pen, and touch. A press on a floor carton or a placed case is claimed from the camera. Moving it 6px starts a drag; a shorter press is a tap that selects (tapping a floor carton again deselects it). Presses anywhere else go to the camera; a short one on empty space clears the selection. Touch drags aim 64px above the finger. While dragging, the mouse wheel (once per scroll burst), a right-click, or a second finger rotates 90° clockwise. The keys act on the held case, or on the selected one: `R` rotates, `F` flips, and the arrow or WASD keys nudge one 2" cell relative to the camera (holding a key repeats; moving the pointer re-aims). `Delete`/`Backspace` removes the selected case and `Escape`/`Enter` accepts it. In the isometric view, which sits exactly on a pallet diagonal, right/left run along the pallet's 48" X axis. `pointercancel` returns the case.
- **Placement** (`src/controls/PlacementController.ts`): the pointer ray hits the deck plane or a placed case. On a case's top, the held case stacks there; on a side, it goes beside that face. The held case centers on that point and its corner snaps to the 2" grid. The engine's `validate_placement` then colors the ghost green, yellow, or red (`src/rendering/GhostBox.ts`, with a soft contact shadow). The held carton floats 2" above its ghost. Dropping in green or yellow commits; dropping in red returns the carton to its bay. A move averages well under 0.5 ms on a 100-case pallet.
- **Adjusting placed cases**: the case just dropped stays selected (cyan outline), so nudges, rotates (about its center), and flips move it through `move_placement` straight away. A move the rules refuse leaves it where it is and says why. Tapping a placed case selects it; pressing one of a stack picks up the case on top of that stack. Dragging a placed case lifts it (`validate_move` aims it) and drops it elsewhere, keeping its id; dropping it in red puts it back, and dropping it clear of the deck takes it off the pallet like **Remove**.
- **Camera** (`src/rendering/CameraController.ts`): OrbitControls with `Iso` (35.264° up, 45° around), `Top`, `Side` (from the +X end, between the staging rows), and `Reset`. Presets keep your zoom and pan; `Reset` discards them. The look-at point eases upward by half the stack height. `frameCompactCamera` uses `setViewOffset` to center the view in the clear band between HUD overlays, then binary-searches the closest distance that keeps the pallet, the stack, and every bay inside that band. Overlays marked `data-chrome` count as HUD on compact layouts (`COMPACT_QUERY`, SPEC-01 §7.3).
- In development, `window.__palletTest` gives browser tests the screen positions of deck points and of visible floor cartons by SKU and yaw.



### Mode 2 — Dock Survival

Select **Mode 2 · Conveyor**, or open `?mode=2&seed=2149` for a reproducible run (this seed begins with four 15-inch Light Tall cartons). Switching modes starts a fresh round and clears the pallet.

The conveyor starts immediately. Queued cartons accumulate nose to tail with no gaps: the oldest presses against the end stop at the pick spur beside the signal tower, and each arrival rides up to the back of the queue (`queueSpots` in `ConveyorBelt.tsx`; a carton that would straddle the transfer corner starts on the next leg). Any carton on the final run (the 116" pick lane from the end stop back to the last turn, `FINAL_RUN_IN` in `mode2.rs`) can be dragged onto the pallet, in any order; the cartons behind close up the gap. The engine reports how many cartons are on it as `final_run` in the Mode 2 status, and refuses picks further back. Ten cartons fit on the recirculation lane, which fills in arrival order. A held carton reserves its slot until successfully placed; invalid or cancelled drops leave it where it was, and a drag carries on while other cartons arrive. Incoming cartons divert when all ten recirculation slots are occupied. Cartons wrap the pick lane first; the recirculation lane is the one running back the other way, and only cartons beyond the pick lane count toward it (`recirculating` in the status). Signals are green at 0–4 on it, yellow at 5–9, and red at 10 (full), when the HUD panel and signal lamp flash and an **Overflow in N s** countdown to the next diversion starts; warning lights blink. Saturation and Estop play distinct short klaxons after a user gesture enables browser audio; the **Sound** button mutes or enables them. The fifth diversion ends the round immediately with **Warehouse Estop**.

Arrival intervals follow `3500 - 1500 × height / 60` milliseconds, scaled by the **Easy / Medium / Hard** setting in the warehouse feed (×1.5, ×1, ÷1.6; `start_mode2(seed, now_ms, difficulty?)`, remembered in `localStorage`; changing it starts a new run), with in-flight progress preserved when a placement changes the height. The engine processes missed arrivals in order and freezes at the exact fifth-diversion deadline, even after a background-tab time jump. Case generation is deterministic for the same u64 seed. The shared support, overhang, crushing, and scoring rules apply; Mode 1's heavy-on-light prohibition does not.

**Ship pallet** is available at any moment once a case is on the pallet. The line continues until clicked, so shipping must beat the fifth diversion. A partial pallet's final score is its composite score × its height as a share of 60 inches (`fill_pct`, `final_score` in the status). Grades reward work done: an empty pallet is an F in both modes, Mode 2 grades load quality × `fill_pct`, and a **Warehouse Estop** is always an F. Shipping freezes elapsed throughput time, the queue, rollers, and final score. **New conveyor run** starts an empty pallet and a fresh seed. Shipping saves the round, then a ride-on pallet hauler (`src/rendering/PalletHauler.ts`) drives under the shipped pallet and hauls it away, and delivers a new empty pallet to a fresh run (picking is blocked until it lands).

`start_mode2(seed, now_ms)` returns a full snapshot; `tick_mode2(now_ms)` returns authoritative `mode2` telemetry. Shared `pick_case`, `commit_placement`, and `ship` dispatch to the active mode; in Mode 2, `pick_case` takes any carton on the final run. `tick` remains Mode 1-only. `src/hooks/useMode2GameLoop.ts` drives Rust every frame and publishes HUD updates at 10 Hz; `src/rendering/ConveyorBelt.tsx` reads the live telemetry for roller, incoming-carton, and diversion animation. Framing includes the complete conveyor footprint on desktop and phone layouts.

Ticket 06 tests cover Rust timing/overflow/FIFO/shipping, compiled Wasm integration, and browser mode switching, saturation/Estop, mid-drag arrivals, and shipping a 60-inch pallet.


### Warehouse dashboard and mobile controls (ticket 07)

The desktop console has a command bar, SKU inventory or conveyor feed, live load-quality/COG pane, and case inspector with dispatch controls. The HUD renders the Rust score and penalties directly. The dashboard labels the engine's S tier **A+**; the final report and exported data retain **S**, matching the detailed scoring contract. Stability displays the existing load-quality percentage rather than introducing a separate scoring formula.

Compact mode activates at width ≤900px, height ≤540px, or a coarse pointer. React feeds both layouts from the same snapshot and placement controller; there is no copied game logic or DOM polling. The actual canvas occupies the space between the controls, and the existing `frameCompactCamera` reframes that clear viewport on resize. Landscape puts the control deck beside the canvas.

On mobile, tap a waiting carton to pick it at the pallet center. Each D-Pad press moves one 2-inch grid cell along the pallet axis closest to the camera's screen direction. Hold for repeated steps; release, cancellation, lost capture, blur, or a completed round stops repetition. Rotate/Flip update the ghost and footprint; Done commits a valid placement. The placed carton stays selected, so the D-Pad, Rotate, and Flip keep adjusting it until a second Done; Remove returns a held carton or removes a selected exposed placed carton. Supporting cartons cannot be removed, and round-end rules remain authoritative in Rust. Drag-and-drop still works.

The menu contains camera presets, Industrial Dock / Modern Studio / CAD Blueprint themes, instructions, telemetry, sound controls in Mode 2, and a confirmed reset of the current run and theme. Saved-session storage and its reset remain ticket 08's responsibility.

Round completion opens a focus-contained glass dialog with the grade, score, volume, weight, height, and exact Rust penalty/bonus breakdown. Export replay downloads versioned JSON containing mode, seed, timed pick/place/remove actions and the final snapshot. Replay playback and historical storage are not part of this ticket.

Browser tests run serially, with an isolated Vite cache and file watching disabled, so external cloud-sync events cannot reload the page mid-gesture. HUD tests cover live inspection and removal metrics, coarse-pointer activation, portrait/landscape thumb controls, repeat cancellation, results and export. Controller tests use the compiled Wasm engine for camera-relative movement, inventory restoration, support protection and Estop lockout.
