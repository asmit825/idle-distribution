# 06 — Mode 2: Conveyor Flow & Warehouse Diversion

**Type:** implementation  
**Status:** complete  
**Blocked by:** 03 (Core Stacking Physics, Grid Snapping & Compression Solver in Rust Wasm), 04 (Unified Pointer Pipeline, Drag & Drop, 3-Color Ghost Box & Spatial Camera), 05 (Mode 1: 100-Case Free Staging Shift)

## Context & Goal
Implement the complete operational gameplay loop for **Mode 2: Conveyor Flow & Warehouse Diversion (Dock Survival)**. Cases arrive continuously down an animated warehouse conveyor belt with arrival intervals accelerating from 3.5s down to 2.0s. The player must manage a 10-case pick queue buffer with Green/Yellow/Red visual signal lights. Accumulating 5 diverted cases down the overflow spur triggers an Emergency Facility Estop failure. Reaching the 60.0" build height ceiling triggers the victory condition.

## Specification References
- [SPEC-01-PALLET-BUILDER: Section 5.2 (Mode 2: Conveyor Flow & Warehouse Diversion)](../../02.to-spec/specs/01-pallet-building-game-spec.md#52-mode-2-conveyor-flow--warehouse-diversion-dock-survival)
- [SPEC-01-PALLET-BUILDER: Section 9 (User Stories: Epic 3)](../../02.to-spec/specs/01-pallet-building-game-spec.md#epic-3-mode-2---conveyor-flow--warehouse-diversion)

## Vertical Slice Layers
- **Conveyor Simulation Engine (Rust)**:
  - Spawning loop with acceleration function: $\Delta t = 3.5\text{s} - (1.5\text{s} \times \frac{\text{Height}}{60"})$.
  - FIFO Queue buffer tracking up to 10 waiting cases at the pick spur.
  - Overflow diversion handler: Arriving cases when $\text{queue} \ge 10$ divert to the overflow spur, incrementing `diversions_count`.
  - Estop failure evaluator: `diversions_count == 5` triggers immediate Emergency Estop shutdown.
  - Height target win condition: Reaching 60" allows the player to click "Ship Pallet" to lock in their throughput time and quality score.
- **3D Conveyor Rendering**:
  - 3D conveyor model with rotating roller texture and yellow safety striping.
  - Moving carton meshes gliding along the belt into the 10-case staging buffer.
- **Conveyor Telemetry & Signal Lights**:
  - Green Light (0–5 cases): Normal line operation.
  - Yellow Light (6–8 cases): Bottleneck warning alert.
  - Red Light (9–10 cases): Saturated line alert.
  - Diversion counter ($N / 5$) and line speed readout ($X.X\text{s} / \text{case}$).

## Key Deliverables
1. `crates/pallet_sim/src/mode2.rs`: Conveyor queue state machine, dynamic velocity ramping, diversion tracking, and Estop triggers.
2. `src/rendering/ConveyorBelt.tsx`: 3D animated conveyor mesh with roller animations and moving case instances.
3. `src/hooks/useMode2GameLoop.ts`: React hook managing conveyor tick events and telemetry signals.

## Acceptance Criteria
- [x] Cases arrive continuously down the conveyor belt with spawn intervals smoothly ramping from 3.5s down to 2.0s as pallet height increases.
- [x] The pick spur buffer holds up to 10 cases; signal lights transition correctly between Green (0–5), Yellow (6–8), and Red (9–10).
- [x] If a case arrives while the queue is at 10, it diverts down the overflow spur, incrementing the diversion counter.
- [x] Accumulating 5 diversions triggers an immediate Emergency Estop, stopping the line and failing the round.
- [x] Reaching the 60.0" target height ceiling without causing 5 diversions unlocks the "Ship Pallet" win action.

## Completion — 2026-10-06

Implemented the authoritative Rust conveyor state machine, compiled Wasm API, animated FIFO conveyor and overflow spur, telemetry, warning/Estop audio, mode switching, restart, and manual shipping at 60 inches. Held cases retain their queue slot until placement; arrivals continue until shipping or the fifth diversion. Conveyor motion and the result freeze at round end.

Validation: all 122 tests passed (40 Rust, 8 compiled Wasm, 68 unit, 6 browser), along with TypeScript checking and the production build. Mobile touch placement and landscape layout were checked manually. Browser tests run serially with an isolated Vite cache to avoid software-rendering timing contention and interference with the open preview.

Standards and specification reviews have no remaining findings. Review fixes preserve continuous FIFO carton motion, retain the incoming carton after shipping, and add saturation/Estop audio with mute controls. The production build retains a nonblocking bundle-size advisory.
