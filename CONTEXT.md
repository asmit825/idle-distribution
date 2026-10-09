# Domain Model: idleDistribution

## Glossary

### Pallet
A standard Grade A wood stringer pallet with a nominal top deck footprint of 48" length × 40" width (+/- 0.25") and a target build height ceiling of 60" (~4–5 tiers).

### Modular Grid
A discrete 2-inch cell coordinate system mapping the 48" × 40" pallet top into a 24 × 20 horizontal cell matrix. Cases snap to grid lines with 90° yaw rotations (0°, 90°, 180°, 270°).

### Case (SKU)
A single corrugated carton package characterized by:
- **Dimensions**: Length × Width × Height (in inches, strictly divisible by 2").
- **Gross Weight**: Total weight in lbs.
- **Top-Load Capacity**: Maximum cumulative overhead weight (lbs) the case can support before crushing.
- **Tape Sealing Type**: Visual aesthetic variation (water-activated paper tape, cross-weave reinforced tape, pressure-sensitive clear/tan tape).

### Crushing
A mechanical deformation event occurring when the cumulative vertical load resting directly or partially on a case exceeds its rated top-load capacity. A crushed case remains structurally present in the stack but deforms visually (creases, wrinkles) and incurs a Load Quality penalty that grows with how far past its rating it was loaded. Stacking a heavy case on a light one is allowed; the crush is the cost.

### Overhang
The distance a case extends outward past the 48" × 40" perimeter of the pallet deck. Up to 2" of overhang is tolerated with a Load Quality deduction; overhang beyond 2" is rejected.

### Tipping
A case may hang past the case beneath it as long as it balances: the balance point of its own weight plus everything stacked on it must sit inside the outline of what holds it up. A placement that would put that point on or past the edge, for the case itself or for any case beneath it, is rejected.

### Load Quality
A percentage metric (0–100%) evaluating the overall structural soundness of the assembled pallet:
- **Base Score**: 100%
- **Crush Penalty**: per crushed case, 15% × its overload (peak load past its rating, as a fraction of the rating), capped at 15% once loaded to double its rating.
- **Overhang Penalty**: -5% per inch of cumulative overhang across all tiers.
- **Center of Gravity Penalty**: -10% if the combined center of mass drifts outside the central 50% core of the pallet.
- **Interlocking Bonus**: Up to +10% bonus for cross-layer tier bonding (avoiding continuous vertical seams).

### Composite Score & Grade
The overall performance rating calculated at round conclusion:
- `Final Score = Cases Placed × Quality Percentage`
- **Grade Tiers**:
  - **S Tier**: Final Quality ≥ 90%
  - **A Tier**: Final Quality 80% – 89%
  - **B Tier**: Final Quality 70% – 79%
  - **C Tier**: Final Quality 60% – 69%
  - **F Tier**: Final Quality < 60%

### Simulation Engine (Rust Wasm)
The single source of truth for the game rules, grid occupancy, crushing evaluations, timer, and conveyor queue, compiled from Rust to WebAssembly via `wasm-bindgen` and executed directly in the browser's main thread.

### Authoritative Snapshot
A structured, lightweight state representation queried from the Rust engine by React to drive Three.js 3D rendering and HUD telemetry without desync.

### Seed & Action Log
- **Seed**: A 64-bit integer initializing the deterministic pseudorandom number generator (PRNG) for case generation.
- **Action Log**: An ordered sequence of user inputs `[timestamp_ms, case_id, grid_x, grid_y, rotation]` that, paired with the seed, guarantees byte-for-byte replayability of any session.

### Session Store (IndexedDB)
Client-side structured database storing historical session logs, performance stats, and 3D pallet snapshots. Cleared when browser site data/cookies are cleared or via in-app reset.

### Pallet Snapshot
An array of placed case coordinates and attributes `[{ id, sku_id, grid_x, grid_y, elevation_z, rotation, crushed }]` stored in IndexedDB to allow full 3D inspection of completed pallets in a post-round gallery.

### Backup Export (.json)
A portable JSON file export/import containing all historical sessions and personal bests, allowing data portability without requiring a remote server.

### Mode 1: 100-Case Free Staging
A 60-second speed-stacking mode. The pallet is positioned in the center, surrounded by 100 cases scattered in mixed clusters on the warehouse floor. Timer starts on first pick. Heavy cases may be stacked onto lighter ones, at the cost of crushing them. If a player places all 100 cases before 60 seconds, an early finish bonus is awarded.

### Mode 2: Conveyor Flow & Warehouse Diversion
A pacing and line-management mode. Cases arrive on a warehouse conveyor belt with arrivals ramping from 3.5s down to 2.0s. The conveyor buffer holds up to 10 cases with visual status indicators:
- **Green (0–5 cases)**: Normal operating flow.
- **Yellow (6–8 cases)**: Line bottleneck warning.
- **Red (9–10 cases)**: Line saturated. Incoming cases divert off-line down an overflow spur.

### Sandbox
A play style for either mode with nothing to lose. In Mode 1 there is no shift clock (time played counts up instead) and the floor keeps dealing waves of 25 until the pallet ships. In Mode 2 nothing diverts: while the recirculation lane is full, arrivals pause at the infeed, so there is no Estop. Sandbox pallets are kept in the gallery but never count toward personal bests or career stats. The opposite play style is **Timed**.
_Avoid_: using "sandbox" for the engine's free placement before a round starts.

### Diversion & Warehouse Estop
If 5 cases divert off the conveyor spur in Mode 2, the warehouse triggers an emergency stop (estop), ending the round with facility shutdown.

### Pallet Complete
Triggered when a pallet reaches the 60-inch height ceiling (or all cases placed), freezing the timer to evaluate throughput speed and load quality.

### Ghost Box Preview
A semi-transparent 3D bounding box indicating candidate placement over the 24 × 20 grid with dynamic color states:
- **Green**: Valid, supported, structurally sound.
- **Yellow**: Valid placement with soft overhang (≤2") or a load that would crush a case below.
- **Red**: Invalid placement (above the ceiling, excess overhang, or tipping); dropping returns the case to its staging location.

### Snap-to-Grid Raycast
Sub-millisecond projection of the mouse cursor onto the active pallet tier, calculating nearest 2-inch cell anchor coordinates and contact shadows.

### Height Auto-Tracking
Camera viewport elevation behavior that smoothly shifts camera focus upwards as cases accumulate toward the 60" target build ceiling.

### Orbit Inspection
Optional 360° rotational camera control (via right-click or middle-click drag, plus quick-snap buttons: Iso, Top, Front) allowing inspection of hidden pallet corners.

### Stringer Pallet Model
3D procedural mesh of a 48" × 40" Grade A stringer pallet consisting of 7 top deck boards (including 5.5" lead boards), 3 longitudinal stringers (1.25" × 3.5"), and 5 bottom boards with wood grain textures and nail accents.

### Procedural Corrugate Material
Canvas-generated texture applied to 3D carton boxes combining kraft cardboard tones, corrugation flutes, handling marks (Up Arrows / Heavy badges / Fragile tags), shipping barcodes, and authentic tape styles (reinforced cross-weave, paper, pressure-sensitive).

### Squash Deformation
Visual deformation (`scale.set(1.03, 0.92, 1.03)`) applied to a case when its rated compressive load capacity is exceeded, indicating structural failure without causing physics glitching.
