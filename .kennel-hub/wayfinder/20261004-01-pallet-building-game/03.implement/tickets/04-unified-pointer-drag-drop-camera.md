# 04 — Unified Pointer Pipeline, Drag & Drop, 3-Color Ghost Box & Spatial Camera

**Type:** implementation  
**Status:** complete  
**Blocked by:** 02 (8-SKU Procedural Catalog, Materials & 3D Box Rendering), 03 (Core Stacking Physics, Grid Snapping & Compression Solver in Rust Wasm)

## Context & Goal
Implement the interactive 3D controls and spatial navigation systems. This includes a unified pointer event pipeline handling desktop mouse, pen, and capacitive multi-touch with tap-to-select vs drag disambiguation, an ergonomic ~64px touch offset, real-time 3-color dynamic ghost box previews, 90° yaw rotation (`R`), pitch/roll flipping (`F`), and an isometric camera featuring layer height auto-tracking, 360° orbit inspection, and phone-aware dynamic framing (`frameCompactCamera`).

## Specification References
- [SPEC-01-PALLET-BUILDER: Section 6 (Controls, Placement Scheme & Spatial Camera)](../../02.to-spec/specs/01-pallet-building-game-spec.md#6-controls-placement-scheme--spatial-camera)
- [SPEC-01-PALLET-BUILDER: Section 6.1 (Unified Pointer Pipeline)](../../02.to-spec/specs/01-pallet-building-game-spec.md#61-unified-pointer-pipeline-desktop--mobile)
- [SPEC-01-PALLET-BUILDER: Section 6.3 (3-Color Dynamic Ghost Box & Feedback)](../../02.to-spec/specs/01-pallet-building-game-spec.md#63-3-color-dynamic-ghost-box--feedback)
- [SPEC-01-PALLET-BUILDER: Section 6.4 (Spatial Camera & Phone-Aware Dynamic Framing)](../../02.to-spec/specs/01-pallet-building-game-spec.md#64-spatial-camera--phone-aware-dynamic-framing)

## Vertical Slice Layers
- **Pointer Event Pipeline**: `src/controls/PointerManager.ts` managing `pointerdown`, `pointermove`, `pointerup`, `pointercancel` with 6px drag threshold.
- **3D Raycaster & Grid Snapper**: Projects pointer onto horizontal 2" grid planes, aligning candidate coordinates with Rust engine validation.
- **Dynamic Ghost Box**: Semi-transparent 3D volume colored dynamically:
  - Green: Valid placement.
  - Yellow: Warning / soft overhang ($\le 2"$).
  - Red: Stack collision, heavy-on-light violation, or $> 2"$ overhang.
- **Ergonomic Touch Offset**: In touch mode, shifts the ghost box ~64px vertically above finger contact point to prevent obstruction.
- **Rotation & Multi-Touch Gestures**:
  - Hotkey `R`, mouse wheel, or touch UI button rotates 90° clockwise.
  - Hotkey `F` or touch UI button flips pitch/roll orientation.
  - Tapping a secondary finger on the screen during an active touch drag triggers immediate 90° rotation.
- **Camera Controller**:
  - Smooth height auto-tracking elevating the look-at point as pallet height builds toward 60".
  - OrbitControls for 360° inspection and quick presets (`Iso`, `Top`, `Side`, `Reset`).
  - Binary-search projection framing (`frameCompactCamera`) centering the pallet within unobstructed screen space between top and bottom HUD chrome.

## Key Deliverables
1. `src/controls/PointerManager.ts`: Unified mouse and touch event handling.
2. `src/rendering/GhostBox.tsx`: 3-color dynamic preview with contact drop shadow.
3. `src/rendering/CameraController.tsx`: Height auto-tracking, presets, and `frameCompactCamera`.
4. Interactive canvas integration enabling picking cases, dragging with ghost preview, rotating, and dropping onto the pallet deck.

## Acceptance Criteria
- [x] Dragging begins only after moving 6+ pixels; taps under 6px select or deselect without moving the case.
- [x] On touch devices, the ghost box is elevated ~64px above the contact finger, keeping grid alignment fully visible.
- [x] Ghost box colors update synchronously in $< 0.5\text{ms}$ based on Rust Wasm validation (Green, Yellow, Red).
- [x] Releasing a box while in the Red state cancels the drop and returns the case to its origin.
- [x] Pressing `R`, wheel scrolling, or tapping a second finger rotates the held case 90°.
- [x] Camera smoothly raises its look-at elevation as cases stack up toward 60".
- [x] `frameCompactCamera` fits the entire pallet and staging bays inside the screen without clipping under HUD bars.


## Implementation Verification — 2026-10-05

- `src/controls/PointerManager.ts`: one Pointer Events pipeline for mouse, pen, and touch.
  - A primary press on a draggable floor carton is claimed from OrbitControls, which listens in the capture phase. Every other press passes through to the camera, so one finger orbits, two fingers pinch and pan, and right or middle buttons pan.
  - Movement under 6px is a tap (select or deselect); 6px or more starts a drag. Touch drags aim 64px above the finger.
  - While dragging, `R`, the wheel (once per scroll burst), a right-click, or a second finger rotate 90° clockwise, and `F` flips. `pointercancel` cancels the drag.
- `src/controls/PlacementController.ts` implements the pointer handlers.
  - The ray hits the deck plane or a placed case's top (or its side, which aims beside that face). The case centers there, snapped to the 2" grid.
  - `validate_placement` colors the ghost. Green and yellow drops commit; red drops return to the bay.
  - The held carton floats 2" above the ghost. A tapped case gets a cyan outline.
- `src/rendering/GhostBox.ts` (green, yellow, or red volume, edges, contact shadow) and `src/rendering/CameraController.ts` are `.ts` because they are imperative classes with no JSX.
- `CameraController`:
  - Presets: Iso (35.264°/45°), Top, Side (from +X, between the staging rows), and Reset. Zoom and pan carry over between presets.
  - Height tracking eases the look-at point up by half the stack height.
  - `frameCompactCamera` uses `setViewOffset` to center the view in the band between HUD overlays (`data-chrome`, on compact layouts), then binary-searches the closest distance that fits.
- Cartons support `flipped` (rolled about their length). The floor bays (`src/scene/staging.ts`) refill after each placement until Mode 1 staging arrives in ticket 05.
- Defaults chosen when the user left questions unanswered: floor bays refill; placed cases are tap-select only (no re-pick or move).
- Tests:
  - Vitest: PointerManager 14, PlacementController 13 (against the real Wasm engine, including 2,000 moves on a 100-case pallet averaging under 0.5 ms), camera 6, plus a flipped-carton BoxMesh test.
  - Playwright: mouse drag with R rotation, stacking onto a placed case, a red drop returning, and a tap selecting.
  - `npm test` passes.
- Code review fixes:
  - Non-primary buttons now go to the camera.
  - Only the engine's off-pallet error reads as red.
  - The snapshot refreshes on remount.
  - `Hit<T>` type added; names clarified.
  - Earlier self-review fixes: the side preset no longer looks through the front bays; a HUD overlay counts toward the edge it actually sits nearer; `R` and `F` are called as methods; the camera settles before the browser test reads positions.
- Open:
  - The look-at point centers the stack rather than the top working layer, so the floor bays stay framed.
  - HUD insets apply only on compact layouts.
  - Top-down uses a perspective camera looking straight down.
  - There is no separate intent timer; tap vs drag is decided by distance.
  - R/F and the ghost apply only during a drag. Selection-driven placement (D-pad, Done) is ticket 07.
  - Re-staging needs `CameraController` to take a dynamic bay list (ticket 05).

