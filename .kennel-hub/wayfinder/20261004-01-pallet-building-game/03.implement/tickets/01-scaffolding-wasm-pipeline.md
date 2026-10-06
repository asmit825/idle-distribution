# 01 — Project Scaffolding & WebAssembly Integration Pipeline

**Type:** implementation  
**Status:** complete  
**Blocked by:** None (Frontier)

## Context & Goal
Establish the foundational project architecture for **Idle Distribution: 1-Minute Pallet Builder**, setting up the React 18 / TypeScript frontend, Three.js 3D rendering canvas, and the Rust WebAssembly (`crates/pallet_sim`) build pipeline. This tracer bullet delivers a minimal working end-to-end slice: the Rust Wasm engine compiles and initializes directly on the browser's main thread, returning an engine handshake that mounts a Three.js canvas displaying a procedural 48" × 40" stringer pallet.

## Specification References
- [SPEC-01-PALLET-BUILDER: Section 1 (Executive Summary)](../../02.to-spec/specs/01-pallet-building-game-spec.md#1-executive-summary--problem-statement)
- [SPEC-01-PALLET-BUILDER: Section 3 (Simulation Engine & Technical Architecture)](../../02.to-spec/specs/01-pallet-building-game-spec.md#3-simulation-engine--technical-architecture)
- [SPEC-01-PALLET-BUILDER: Section 8.1 (Procedural Grade A Stringer Pallet Mesh)](../../02.to-spec/specs/01-pallet-building-game-spec.md#81-procedural-grade-a-stringer-pallet-mesh)

## Vertical Slice Layers
- **Build & Scaffolding**: Vite + React 18 + TypeScript build configuration with `vite-plugin-wasm` and `vite-plugin-top-level-await`.
- **Rust Engine Core**: Rust crate (`crates/pallet_sim`) with `wasm-bindgen`, `serde`, and `serde-wasm-bindgen`.
- **3D Scene Graph**: Three.js WebGL renderer mounting an interactive viewport with basic orbit controls and lighting (directional sun + warehouse ambient).
- **Procedural Mesh**: Initial procedural Grade A stringer pallet geometry (48" × 40" × 4.75") with 7 top deckboards, 3 notched stringers, and 5 bottom deckboards.
- **Verification**: Local dev server starts with zero errors; Wasm ping test passes; 3D pallet renders cleanly.

## Key Deliverables
1. `package.json` with dependencies: `react`, `react-dom`, `three`, `@types/three`, `lucide-react`, `idb`.
2. `crates/pallet_sim/Cargo.toml` with `wasm-bindgen`, `rand_chacha`, `serde`.
3. `crates/pallet_sim/src/lib.rs` implementing `Engine::new()` and `Engine::ping() -> String`.
4. Build scripts: `npm run build:wasm` (invoking `wasm-pack build --target web`) and `npm run dev`.
5. `src/components/PalletCanvas.tsx` hosting the Three.js viewport and rendering the 48" × 40" stringer pallet base.

## Acceptance Criteria
- [x] `npm run build:wasm` compiles the Rust simulation crate into `pkg/` without errors or warnings.
- [x] `npm run dev` boots the Vite development server with hot-module replacement.
- [x] Browser console confirms successful synchronous Wasm initialization on main thread (`Engine initialized: v1.0.0`).
- [x] Three.js canvas displays the 48" × 40" stringer pallet centered at $(0, 0, 0)$ with realistic dimensions and standard forklift notches.
- [x] Window resize events properly update the Three.js camera aspect ratio and renderer viewport.


## Implementation Verification — 2026-10-05

- React 18 / TypeScript / Vite scaffold, project-local wasm-pack, and root `pkg/` output implemented.
- `npm ci`: passed, dependency audit reports zero vulnerabilities.
- `npm run build:wasm`: passed without compiler or wasm-pack warnings with the matching wasm-bindgen CLI installed (see README prerequisites).
- `npm run typecheck`: passed.
- `npm test`: all five tests passed: compiled Wasm handshake, three geometry checks, and browser startup/orbit/resize.
- `npm run build`: passed. Vite reports a non-blocking large JavaScript chunk advisory (862 KB minified, approximately 201 KB gzip).
- Production preview: engine handshake and canvas verified with zero browser errors.
- React hot reload: temporary UI text edit appeared without a page reload; original source restored.
- Desktop and phone views visually inspected; pallet dimensions, boards, notches, procedural grain, and nail heads implemented.
- Code review against the initial repository commit: Standards — zero actionable findings; Spec — zero actionable findings.

Rendering uses Y-up inches and a geometric center at the origin; README documents conversion from the domain coordinate system. Later gameplay and simulation rules remain outside this ticket.
