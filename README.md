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

The browser fetches the Wasm bytes, calls `initSync` on the main thread, constructs `Engine`, and logs `Engine initialized: v1.0.0` before mounting the viewport. Initialization errors appear on screen. Drag to orbit, scroll/pinch to zoom, and right-drag to pan.

### Verification

```sh
npx playwright install chromium
npm test
```

The suite runs the Rust unit tests (catalog, stacking physics, and scoring), exercises the actual compiled Wasm API (including a `validate_placement` latency benchmark), runs the Vitest unit tests under `src/` (pallet geometry including raycasts through both fork openings, Rust ↔ TypeScript SKU catalog parity, procedural carton textures, and carton meshes), and checks browser startup, orbit, and desktop/phone resize. Browser tests start their own dev server on port 4173. Individual commands are `npm run test:rust`, `npm run test:wasm`, `npm run test:unit`, and `npm run test:browser`; build Wasm before running `test:wasm` or `test:unit` alone. Texture tests paint on a real Skia canvas via the `@napi-rs/canvas` dev dependency.

### Geometry conventions

One rendering unit is one inch. Three.js uses Y up, with the pallet's geometric center at `(0, 0, 0)` and bounds `X ±24`, `Y ±2.375`, `Z ±20`. Top deck elevation is `Y = 2.375`. The domain model uses corner-based X/Y and vertical Z; future case rendering should map `(x, y, elevation)` to `(x - 24, elevation + 2.375, y - 20)`.

The mesh contains seven top boards, three continuous notched stringers, and five bottom boards. Each runner has two 9 × 1.25 inch openings beginning six inches from its ends. Wood grain and flush nail heads are procedural. The React viewport disposes GPU resources, controls, animation callbacks, and resize listeners on unmount, including hot reload and Strict Mode remounts.

The `uuid` override updates the top-level-await plugin's transitive dependency to its patched compatible API. Keep this override until the plugin updates its dependency.

### Cartons

The 8-SKU catalog (SPEC-01 §2.2) lives in `crates/pallet_sim/src/sku.rs` and is mirrored by `src/types/catalog.ts`; the Wasm export `sku_catalog()` lets the unit tests enforce parity. `src/rendering/materials.ts` paints every face on its own canvas at 32 px per inch, so no face stretches, with kraft, flutes, tape style, weight badge, Code 39 shipping label, and handling marks. Red encodes bump height and green encodes roughness in one surface texture. Materials are cached per SKU and shared by every carton of that SKU.

`createBoxMesh(sku, { crushed })` in `src/rendering/BoxMesh.tsx` returns a carton whose origin is the center of its base. It renders 1/8" inside its grid footprint on each side (`cartonSize` in `materials.ts`), so flush neighbors never share a plane. Setting `crushed` eases over 0.25 s to 0.92 height with the base planted. A morph target sinks the top and bows the sides at the same time. The lateral bulge is 1.03, capped 1/64" inside the grid footprint so crushed neighbors never touch; in practice the cap always applies. The engine keeps crushed cases at full height so the stack never shifts. Lowering whatever sits on a crushed carton is a rendering job. The `<BoxMesh parent={…} sku={…} />` component mounts one into the imperative scene; the viewport stages one carton of each SKU on the floor and disposes the cached materials on unmount.

### Stacking engine

`Engine` (in `crates/pallet_sim/src/lib.rs`) is the authoritative pallet. It runs synchronously on the main thread:

- `validate_placement(sku_id, grid_x, grid_y, rot_z, flipped)` → `{ status: 'valid' | 'warning' | 'invalid', rejection, elevation_in, overhang_in, unsupported_fraction, would_crush }`. It does not change the pallet.
- `commit_placement(...)` → snapshot, or throws `placement rejected: <reason>`.
- `remove_placement(case_id)` → snapshot. It throws while another case rests on that one.
- `get_snapshot()` → `{ cases_placed, total_weight_lbs, max_height_inches, volume_utilization_pct, max_overhang_inches, cog_inches, cog_drift_inches, crushed_count, quality_pct, composite_score, grade, placed_cases: [{ id, sku_id, grid_x, grid_y, elevation_z, rotation_yaw, flipped, crushed, weight_lbs, load_lbs }] }`.

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

