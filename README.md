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

The suite exercises the actual compiled Wasm API, the public Three.js pallet geometry (including raycasts through both fork openings), and browser startup, orbit, and desktop/phone resize. Browser tests start their own dev server on port 4173. Individual commands are `npm run test:wasm`, `npm run test:geometry`, and `npm run test:browser`; build Wasm before running the handshake test alone.

### Geometry conventions

One rendering unit is one inch. Three.js uses Y up, with the pallet's geometric center at `(0, 0, 0)` and bounds `X ±24`, `Y ±2.375`, `Z ±20`. Top deck elevation is `Y = 2.375`. The domain model uses corner-based X/Y and vertical Z; future case rendering should map `(x, y, elevation)` to `(x - 24, elevation + 2.375, y - 20)`.

The mesh contains seven top boards, three continuous notched stringers, and five bottom boards. Each runner has two 9 × 1.25 inch openings beginning six inches from its ends. Wood grain and flush nail heads are procedural. The React viewport disposes GPU resources, controls, animation callbacks, and resize listeners on unmount, including hot reload and Strict Mode remounts.

The `uuid` override updates the top-level-await plugin's transitive dependency to its patched compatible API. Keep this override until the plugin updates its dependency.
