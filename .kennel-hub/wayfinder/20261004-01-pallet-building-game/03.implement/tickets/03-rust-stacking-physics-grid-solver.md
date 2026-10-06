# 03 — Core Stacking Physics, Grid Snapping & Compression Solver in Rust Wasm

**Type:** implementation  
**Status:** complete  
**Blocked by:** 01 (Project Scaffolding & WebAssembly Integration Pipeline), 02 (8-SKU Procedural Catalog, Materials & 3D Box Rendering)

## Context & Goal
Implement the authoritative stacking physics, 2-inch modular spatial grid (24 × 20 matrix), and recursive compressive top-load solver in Rust WebAssembly. This engine core executes synchronously on the browser's UI thread, evaluating candidate box placements in $< 0.2\text{ms}$ to power real-time snap previews, crush detections, overhang penalties, Center-of-Gravity (COG) drift, and final Load Quality grades.

## Specification References
- [SPEC-01-PALLET-BUILDER: Section 2.1 (Pallet Geometry & Modular Spatial Grid)](../../02.to-spec/specs/01-pallet-building-game-spec.md#21-pallet-geometry--modular-spatial-grid)
- [SPEC-01-PALLET-BUILDER: Section 2.3 (Physical Stacking, Overhang & Crushing Rules)](../../02.to-spec/specs/01-pallet-building-game-spec.md#23-physical-stacking-overhang--crushing-rules)
- [SPEC-01-PALLET-BUILDER: Section 2.4 (Scoring Algorithm & Composite Grade Formulation)](../../02.to-spec/specs/01-pallet-building-game-spec.md#24-scoring-algorithm--composite-grade-formulation)
- [SPEC-01-PALLET-BUILDER: Section 3 (Simulation Engine & Technical Architecture)](../../02.to-spec/specs/01-pallet-building-game-spec.md#3-simulation-engine--technical-architecture)

## Vertical Slice Layers
- **Spatial Grid Model**: 2D/3D voxel occupancy matrix ($24 \times 20$ discrete 2" cells, elevation tracked in continuous inches up to 60" ceiling).
- **Physics Solver**:
  - Contact intersection: Calculates shared horizontal area between placed cases and supporting cases.
  - Recursive top-load solver: Propagates downward weight vectors through supporting stacks.
  - Crush trigger: Evaluates `load > capacity`, tagging cases as `Crushed`.
  - Overhang evaluator: Calculates protrusion beyond $X \in [0, 48"]$ and $Y \in [0, 40"]$, flagging soft overhang ($\le 2"$) or hard invalid drop ($> 2"$ or $> 30\%$ unsupported base).
  - Center of Gravity (COG): Computes cumulative center of mass relative to $(24.0", 20.0")$.
- **Scoring & Grading**: Calculates Quality % and Final Score ($\text{Cases} \times \text{Quality } \%$), outputting letter grade (S, A, B, C, F).
- **Synchronous Wasm API**: Exposes `validate_placement(sku_id, grid_x, grid_y, rot_z, flipped) -> ValidationResult` and `commit_placement(sku_id, grid_x, grid_y, rot_z, flipped) -> EngineSnapshot`.
- **Automated Rust Unit Tests**: Comprehensive test suite covering weight transfers, multi-box splits, crush states, and overhang boundaries.

## Key Deliverables
1. `crates/pallet_sim/src/grid.rs`: 2" grid occupancy representation, collision checks, and elevation lookup.
2. `crates/pallet_sim/src/physics.rs`: Weight transfer recursion, crush capacity comparisons, and COG drift calculations.
3. `crates/pallet_sim/src/scoring.rs`: Mathematical formulation of penalties ($P_{\text{crush}}$, $P_{\text{overhang}}$, $P_{\text{drift}}$, $B_{\text{interlock}}$) and grade tiers.
4. `crates/pallet_sim/src/lib.rs`: WebAssembly bindings exposing `validate_placement`, `commit_placement`, `remove_placement`, and `get_snapshot`.
5. Unit tests in `crates/pallet_sim/tests/physics_tests.rs`.

## Acceptance Criteria
- [x] `validate_placement` executes in $< 0.2\text{ms}$ on a full pallet with 50+ cases.
- [x] A case placed on two lower boxes splits its weight pro-rata based on shared contact area.
- [x] Stacking total weight exceeding a case's rated `top_load_capacity` triggers `Crushed` state and exact $-15\%$ score deduction per crushed carton.
- [x] Overhang $\le 2.0"$ returns a Warning status with $-5\%/\text{inch}$ quality deduction; overhang $> 2.0"$ or $> 30\%$ unsupported base returns an Invalid status.
- [x] Center of Gravity drift is calculated accurately and penalizes quality per §2.4: it ramps linearly from 0 and caps at 20% at $12"$ from center.
- [x] All Rust unit tests pass cleanly via `cargo test`.


## Implementation Verification — 2026-10-05

- `grid.rs`: exact integer-inch rectangles anchored on the 2" grid, used instead of a voxel bitmap so a flipped 15" footprint still works. `Placement` takes SKU, min-corner cell, yaw in degrees, and flip (a roll: footprint L×H, height W). Includes overhang, the deck rectangle, and the 60" ceiling.
- `physics.rs`: `Pallet` validates, commits, and removes cases.
  - A case settles on the highest top beneath it, so collisions are impossible.
  - Rejections, in priority order: above the ceiling, more than 2" overhang, more than 30% unsupported. These are integer comparisons, so exactly 30% is allowed.
  - Validation returns Yellow for a soft overhang or a predicted crush.
  - Loads are solved top-down. Shares are normalized over the contact area, so 100% of a case's weight reaches its supports.
  - Crushing is permanent, with a 1e-6 lb tolerance.
  - A case that is supporting another cannot be removed.
- `scoring.rs` implements the §2.4 formulas: 15% per crushed case, 5% × max overhang, continuous drift capped at 20% at 12", and +2% per interlocking elevation up to +10%. It also computes the composite score (cases × quality%, 0–100 scale), grades S–F, volume utilization, and the COG.
- `lib.rs`: `validate_placement`, `commit_placement`, `remove_placement`, and `get_snapshot`, serialized as plain JS objects. Grade is a letter.
- Defaults chosen when the user left questions unanswered: weight is normalized by contact area rather than by Area(A); crushing is permanent; the §2.4 formulas win over CONTEXT.md, which is now stale on the overhang and COG penalties.
- Not in this ticket: snapshot fields for modes and timers (tickets 05/06), and `stability_index_pct`, which the spec does not define. Pitch-flip (standing a case on its end) is not supported; only roll is. Mode 1 heavy-on-light is ticket 05. The engine keeps crushed cases at nominal height, so the visual sag above a crushed case is a rendering task.
- Tests: `cargo test` passes 23 physics tests (named per §10.1) and 2 catalog tests. Node `tests/engine.test.mjs` passes 5 Wasm API tests. On a 100-case pallet, `validate_placement` averages about 3 µs over 10,000 calls (budget 200 µs) and the snapshot is 14.7 KB (budget 50 KB).
- `npm test` and `npm run typecheck` pass. `cargo fmt --check` and `cargo clippy --all-targets` are clean.
- Code review (Standards and Spec): fixed the float boundary at exactly 30% unsupported, added the crush tolerance, `commit` now returns `Result<_, Rejection>`, rejection names live on the enum, aggregates moved into `Score`, added the `Support` struct and the off-pallet range check, the benchmark uses 100 cases, added snapshot-size and 1"-penalty assertions, and added `volume_utilization_pct`.

