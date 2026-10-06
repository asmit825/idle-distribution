# 02 — 8-SKU Procedural Catalog, Materials & 3D Box Rendering

**Type:** implementation  
**Status:** complete  
**Blocked by:** 01 (Project Scaffolding & WebAssembly Integration Pipeline)

## Context & Goal
Implement the standardized 8-SKU corrugate carton catalog in both Rust domain models and Three.js rendering pipelines. Generate procedural HTML5 canvas textures for all six faces of each box, featuring realistic kraft paper background, corrugation fluting lines, authentic sealing tape styles (reinforced cross-weave, water-activated paper, clear/tan poly), gross weight badges, barcode shipping labels, and handling marks. Provide squash deformation logic for compressive structural failures.

## Specification References
- [SPEC-01-PALLET-BUILDER: Section 2.2 (8-SKU Modular Catalog)](../../02.to-spec/specs/01-pallet-building-game-spec.md#22-8-sku-modular-corrugated-carton-catalog)
- [SPEC-01-PALLET-BUILDER: Section 8.2 (Procedural Corrugated Box Textures)](../../02.to-spec/specs/01-pallet-building-game-spec.md#82-procedural-corrugated-box-textures)
- [SPEC-01-PALLET-BUILDER: Section 8.3 (Crush Deformation Shader / Geometry Squash)](../../02.to-spec/specs/01-pallet-building-game-spec.md#83-crush-deformation-shader--geometry-squash)

## Vertical Slice Layers
- **Rust Domain Models**: `SkuDef` struct defining dimensions ($L \times W \times H$ in inches), grid cells ($X \times Y$), gross weight (lbs), top-load capacity (lbs), and tape category enum (`Reinforced`, `Paper`, `PressureSensitiveClear`, `PressureSensitiveTan`).
- **TypeScript Data Definitions**: Shared mirrored types `SKU_CATALOG` in `src/types/catalog.ts`.
- **Canvas Texture Engine**: `src/rendering/materials.ts` generating dynamic 2D canvas textures with corrugation fluting, tape lines, shipping labels, and handling icons.
- **Three.js Mesh Builder**: Geometry and material factory generating `MeshStandardMaterial` sets with roughness and bump mapping for all 8 SKUs.
- **Deformation Handler**: Geometry deformation helper applying `scale.set(1.03, 0.92, 1.03)` when a box transitions to `Crushed`.

## Key Deliverables
1. `crates/pallet_sim/src/sku.rs` defining the 8 SKUs and their physical constants.
2. `src/types/catalog.ts` containing TypeScript definitions matching the Rust catalog.
3. `src/rendering/materials.ts` procedural texture generator supporting:
   - Reinforced cross-weave fiberglass tape (Heavy Cube, Heavy Flat).
   - Water-activated paper tape with crease lines (Medium Long, Light Tall, Fragile Small).
   - Pressure-sensitive poly tape with specular highlights (Medium Standard, Medium Square, Light Bulky).
   - Dynamic gross weight badges and barcode shipping labels.
4. `src/rendering/BoxMesh.tsx` Three.js component rendering any SKU with optional crush deformation state.

## Acceptance Criteria
- [x] All 8 SKUs match the exact dimensions, weights, and top-load capacities defined in Section 2.2 of the specification.
- [x] Procedural textures render crisply on all 6 cube faces without stretching or UV distortion.
- [x] Sealing tape textures accurately reflect their specified styles (cross-weave filaments, kraft paper creases, clear/tan poly gloss).
- [x] Each box face clearly shows its gross weight badge (e.g. `[ 45 LBS ]`) and barcode shipping label.
- [x] Activating `crushed = true` applies the squash scale (`1.03, 0.92, 1.03`) smoothly without penetrating adjacent grid bounds or causing z-fighting.
- [x] A material cache prevents regenerating identical canvas textures, sustaining 60 FPS performance.


## Implementation Verification — 2026-10-05

- `crates/pallet_sim/src/sku.rs`: `SkuDef`, `TapeType`, `HandlingClass` (heavy/medium/light/fragile; named to avoid the glossary's pallet "tier"), exported to JS via `sku_catalog()`. `cargo test` asserts every value against literal §2.2 rows.
- `src/types/catalog.ts`: mirrored `SKU_CATALOG`; a Vitest parity test deep-equals it with the compiled Wasm catalog.
- `src/rendering/materials.ts`: per-face canvases at a uniform 32 px/inch of the rendered face. Each face has kraft with micro-noise, 5/16" flute striations, three tape styles (fiberglass cross-weave, creased gummed paper with FRAGILE print on fragile cartons, glossy clear/tan poly with low roughness), a `[ N LBS ]` badge, a Code 39 label of the SKU id, and handling marks. One surface texture serves as both the bump map (R) and the roughness map (G). Materials are cached per SKU and painted deterministically.
- `src/rendering/BoxMesh.tsx`: `createBoxMesh` / `Carton` plus a `<BoxMesh parent>` component for the imperative scene. Crushing eases to Y 0.92 with the base planted, and a morph target sinks the top and bows the sides (§8.3).
- **Deviation, awaiting a product decision:** cartons render 1/8" inside their grid footprint per side, and the lateral 1.03 bulge is capped 1/64" inside the footprint. This satisfies "no penetration / no z-fighting", but the cap always applies, so the effective X/Z bulge is about 1.004–1.016 rather than 1.03.
- Not covered here: cartons stacked on a crushed carton keep their elevation (about 8% of height). Ticket 03's solver must lower them.
- `npm test`: Rust 2/2, Wasm handshake 1/1, Vitest 16/16, Playwright startup 1/1. `npm run typecheck`, `cargo fmt --check`, and `cargo clippy` are clean. `npm run build` passes, with the existing chunk-size advisory only.
- Visual check (desktop and 390×844 phone) of all 8 SKUs staged on the floor and of crushed cartons up close. No browser errors.
- Code review (Standards and Spec): fixed the texture squeeze from the inset, coplanar crushed neighbors, the missing bow/sunken top, Light Bulky's fragile marking, tall arrows on tall cartons only, glossary naming, disposal of cached materials on unmount, and the per-mesh material array.

