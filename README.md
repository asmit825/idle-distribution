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

The browser fetches the Wasm bytes, calls `initSync` on the main thread, constructs `Engine`, and logs `Engine initialized: v1.0.0` before mounting the viewport. Initialization errors appear on screen. The app opens on a Mode 1 shift (see *Mode 1* below); add `?seed=<u64>` to the URL to replay a specific floor. Drag a floor carton onto the pallet to place it (see *Placing cases* below). Drag empty space to orbit, scroll or pinch to zoom, and right-drag or two-finger drag to pan.

### Verification

```sh
npx playwright install chromium
npm test
```

The suite runs the Rust unit tests (catalog, stacking physics, scoring, and the Mode 1 shift), exercises the actual compiled Wasm API (including a `validate_placement` latency benchmark), runs the Vitest unit tests under `src/` (pallet geometry including raycasts through both fork openings, Rust ↔ TypeScript SKU catalog parity, procedural carton textures, carton meshes, the pointer pipeline, placement against the real Wasm engine with a per-move latency check, Mode 1 floor layouts, and camera framing), and checks browser startup, orbit, desktop/phone resize, mouse drag-and-drop, and a full Mode 1 shift on Playwright's fake clock. Browser tests start their own dev server on port 4173. Individual commands are `npm run test:rust`, `npm run test:wasm`, `npm run test:unit`, and `npm run test:browser`; build Wasm before running `test:wasm` or `test:unit` alone. Texture tests paint on a real Skia canvas via the `@napi-rs/canvas` dev dependency.

### Geometry conventions

One rendering unit is one inch. Three.js uses Y up, with the pallet's geometric center at `(0, 0, 0)` and bounds `X ±24`, `Y ±2.375`, `Z ±20`. Top deck elevation is `Y = 2.375`. The domain model uses corner-based X/Y and vertical Z; future case rendering should map `(x, y, elevation)` to `(x - 24, elevation + 2.375, y - 20)`.

The mesh contains seven top boards, three continuous notched stringers, and five bottom boards. Each runner has two 9 × 1.25 inch openings beginning six inches from its ends. Wood grain and flush nail heads are procedural. The React viewport disposes GPU resources, controls, animation callbacks, and resize listeners on unmount, including hot reload and Strict Mode remounts.

The `uuid` override updates the top-level-await plugin's transitive dependency to its patched compatible API. Keep this override until the plugin updates its dependency.

### Cartons

The 8-SKU catalog (SPEC-01 §2.2) lives in `crates/pallet_sim/src/sku.rs` and is mirrored by `src/types/catalog.ts`; the Wasm export `sku_catalog()` lets the unit tests enforce parity. `src/rendering/materials.ts` paints every face on its own canvas at 32 px per inch, so no face stretches, with kraft, flutes, tape style, weight badge, Code 39 shipping label, and handling marks. Red encodes bump height and green encodes roughness in one surface texture. Materials are cached per SKU and shared by every carton of that SKU.

`createBoxMesh(sku, { crushed })` in `src/rendering/BoxMesh.tsx` returns a carton whose origin is the center of its base. It renders 1/8" inside its grid footprint on each side (`cartonSize` in `materials.ts`), so flush neighbors never share a plane. Setting `crushed` eases over 0.25 s to 0.92 height with the base planted. A morph target sinks the top and bows the sides at the same time. The lateral bulge is 1.03, capped 1/64" inside the grid footprint so crushed neighbors never touch; in practice the cap always applies. The engine keeps crushed cases at full height so the stack never shifts. Lowering whatever sits on a crushed carton is a rendering job. The `<BoxMesh parent={…} sku={…} />` component mounts one into the imperative scene; the viewport stages one carton of each SKU on the floor and disposes the cached materials on unmount.

### Stacking engine

`Engine` (in `crates/pallet_sim/src/lib.rs`) is the authoritative pallet. It runs synchronously on the main thread. A new `Engine` is a free-placement sandbox until `start_mode1` (see *Mode 1*).

- `validate_placement(sku_id, grid_x, grid_y, rot_z, flipped)` → `{ status: 'valid' | 'warning' | 'invalid', rejection, elevation_in, overhang_in, unsupported_fraction, would_crush }`. It does not change the pallet.
- `commit_placement(...)` → snapshot, or throws `placement rejected: <reason>`.
- `remove_placement(case_id)` → snapshot. It throws while another case rests on that one, and during a shift.
- `get_snapshot()` → `{ cases_placed, total_weight_lbs, max_height_inches, volume_utilization_pct, max_overhang_inches, cog_inches, cog_drift_inches, crushed_count, quality_pct, composite_score, grade, placed_cases: [{ id, sku_id, grid_x, grid_y, elevation_z, rotation_yaw, flipped, crushed, weight_lbs, load_lbs }], mode1 }`, where `mode1` is the shift status or `null`.

**Placement**
- `grid_x`/`grid_y` give the case's min-corner cell; −1 allows a 2" overhang.
- `rot_z` is 0, 90, 180, or 270 degrees. Unknown SKUs, other yaws, and anchors far off the deck throw.
- `flipped` rolls the case onto its side, so its width becomes its height.
- Geometry is exact integer inches (`grid.rs`), so non-cell footprints such as a flipped 15" side still work.
- A case settles on the highest top beneath its footprint. Rejections, in priority order: above the 60" ceiling, more than 2" overhang, more than 30% of the base unsupported. Exactly 30% unsupported is allowed.
- Status is `warning` for a soft overhang, or when the case's weight would crush a case below.

**Loads** (`physics.rs`)
- Each case passes its weight plus its own load to its supports, pro-rata by contact area. The shares are normalized over the supported area, so all of the weight reaches the supports.
- A case crushes when its cumulative load exceeds its top-load capacity; a load equal to capacity is safe. Crushing is permanent.

**Scoring** (`scoring.rs`, SPEC-01 §2.4)
- Quality = 100 − 15 × crushed − 5 × max overhang (inches) − drift + interlock, clamped to 0–100.
- Drift = 20% × distance of the center of gravity from (24, 20) ÷ 12", capped at 20%.
- Interlock adds 2% for each elevation where some case bridges two or more supports, up to 10%.
- Composite score = cases × quality. Grades: S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, F below 60.

### Mode 1: 100-case free staging

A 60-second shift (SPEC-01 §5.1). The rules and the clock live in `crates/pallet_sim/src/mode1.rs`; `src/hooks/useMode1GameLoop.ts` keeps React in step with them.

- `start_mode1(seed: bigint)` → snapshot. Clears the pallet and spawns 100 floor cases from the 64-bit seed with ChaCha8: each SKU uniformly at random, lying lengthwise along X or Z. The same seed gives the same floor on every device.
- `floor_cases()` → `[{ id, sku_id, yaw }]`. Where they sit is the UI's layout.
- `pick_case(floor_id, now_ms)` lifts a floor case. The first pick starts the clock; inspecting the floor beforehand is free. `commit_placement` then drops the picked case at the latest time the engine has seen; the UI ticks the clock right before each drop (`canDrop`), so a drop after 0:00 returns the case instead.
- `tick(now_ms)` → `{ seed, phase: 'staged' | 'running' | 'complete', time_remaining_ms, cases_on_floor, end_reason, early_finish_bonus, final_score }`. Times are `performance.now()` milliseconds; earlier timestamps never wind the clock back. The remaining time rounds up, so 0:00 means truly out of time.
- `ship(now_ms)` → snapshot. Ends the shift; an empty pallet can ship before the clock starts.
- **No heavy on light**: a Heavy Cube or Heavy Flat resting directly on a Light Tall, Light Bulky, or Fragile Small is rejected as `heavy_on_light` (red ghost). Physical rejections take priority.
- The shift ends at 0:00 (`time_up`, cancelling any held case), on Ship (`shipped`), or when the floor is empty (`all_placed`). Placing every case earns an early finish bonus of remaining seconds × 100 × quality, quality as a fraction, so a second saved is worth a case placed at that quality. Final score = composite score + bonus. 100 random cases average about 2,400 in³ against a 115,200 in³ build envelope, so a seeded floor can't actually fit on one pallet; the bonus path is tested with a two-case floor.
- **Floor layout** (`src/game/FloorStaging.ts`): on desktop, eight clusters packed in rows; the four sides hug the pallet first, then the corners slide out along their diagonals until clear. On phones, one case per 26" bay slot, with the pallet in the center 2 × 2 block, filling an ellipse stretched up the screen in portrait and across it in landscape (the isometric camera looks along the X = Z diagonal). An orientation change re-stages the floor and reframes the camera.
- The header shows the clock and **Ship pallet**; a result panel (ending, grade, cases, quality, scores, **New shift**) appears when the shift completes. The full result modal is ticket 07.

### Placing cases

In the sandbox, each of the eight floor bays (`src/scene/staging.ts`) holds one carton and refills after a placement. In Mode 1, a bay stays empty once its case is on the pallet, and the floor locks when the shift ends.

- **Pointer pipeline** (`src/controls/PointerManager.ts`): one Pointer Events path for mouse, pen, and touch. A press on a floor carton is claimed from the camera. Moving it 6px starts a drag; a shorter press is a tap that selects or deselects. Presses anywhere else go to the camera, and short ones tap: on a placed case they select it, and on empty space they clear the selection. Touch drags aim 64px above the finger. While dragging, `R`, the mouse wheel (once per scroll burst), a right-click, or a second finger rotates 90° clockwise, and `F` flips. `pointercancel` returns the case.
- **Placement** (`src/controls/PlacementController.ts`): the pointer ray hits the deck plane or a placed case. On a case's top, the held case stacks there; on a side, it goes beside that face. The held case centers on that point and its corner snaps to the 2" grid. The engine's `validate_placement` then colors the ghost green, yellow, or red (`src/rendering/GhostBox.ts`, with a soft contact shadow). The held carton floats 2" above its ghost. Dropping in green or yellow commits; dropping in red returns the carton to its bay. A move averages well under 0.5 ms on a 100-case pallet.
- **Camera** (`src/rendering/CameraController.ts`): OrbitControls with `Iso` (35.264° up, 45° around), `Top`, `Side` (from the +X end, between the staging rows), and `Reset`. Presets keep your zoom and pan; `Reset` discards them. The look-at point eases upward by half the stack height. `frameCompactCamera` uses `setViewOffset` to center the view in the clear band between HUD overlays, then binary-searches the closest distance that keeps the pallet, the stack, and every bay inside that band. Overlays marked `data-chrome` count as HUD on compact layouts (`COMPACT_QUERY`, SPEC-01 §7.3).
- In development, `window.__palletTest` gives browser tests the screen positions of deck points and of visible floor cartons by SKU and yaw.

