import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Box3, Color, Group, PerspectiveCamera, Vector3 } from 'three';
import { Engine, initSync } from '../../pkg/pallet_sim';
import { Carton } from '../rendering/BoxMesh';
import { disposeBoxMaterials } from '../rendering/materials';
import { toScene } from '../scene/coordinates';
import { STAGING_BAYS } from '../scene/staging';
import type { PalletEngine } from '../types/engine';
import { PlacementController, type PlacementEvent } from './PlacementController';

const VIEWPORT = { width: 1280, height: 800 };
const bay = (skuId: string) => STAGING_BAYS.find(bay => bay.sku.id === skuId)!;

let engine: Engine;
let camera: PerspectiveCamera;
let scene: Group;
let events: PlacementEvent[];
let controller: PlacementController;

beforeAll(() => {
  initSync({ module: readFileSync(new URL('../../pkg/pallet_sim_bg.wasm', import.meta.url)) });
});

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
  engine = new Engine();
  camera = new PerspectiveCamera(40, VIEWPORT.width / VIEWPORT.height, 0.1, 2000);
  camera.position.set(70, 80, 70);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  scene = new Group();
  events = [];
  controller = new PlacementController({
    engine: engine as PalletEngine,
    camera,
    parent: scene,
    viewport: () => VIEWPORT,
    onEvent: event => events.push(event),
  });
});
afterEach(() => {
  controller.dispose();
  engine.free();
  disposeBoxMaterials();
  vi.unstubAllGlobals();
});

/** Where a domain point (inches on the deck, Z up) appears on screen. */
function screenOf(x: number, y: number, elevation = 0) {
  const ndc = toScene(x, y, elevation).project(camera);
  return { x: (ndc.x + 1) / 2 * VIEWPORT.width, y: (1 - ndc.y) / 2 * VIEWPORT.height };
}

const GREEN = new Color('hsl(145, 75%, 45%)').getHex();

it('aims the held case at the grid cell under the pointer and previews it in green', () => {
  // Heavy Flat sits in its bay turned 90°: 16" along X, 24" along Y. Centered on (24, 20) its corner is (16, 8).
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(24, 20));
  expect(controller.held).toMatchObject({ orientation: { yaw: 90, flipped: false }, aim: { gridX: 8, gridY: 4 } });
  expect(controller.ghost.status).toBe('valid');
  expect(controller.ghost.color.getHex()).toBe(GREEN);
  const { min, max } = controller.ghost.bounds;
  expect([min.toArray(), max.toArray()]).toEqual([toScene(16, 8, 0).toArray(), toScene(32, 32, 8).toArray()]);
});

it('turns the ghost yellow for a soft overhang and red past 2" or far off the pallet', () => {
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(6, 20)); // corner at x = −2
  expect(controller.held!.aim).toMatchObject({ gridX: -1, validation: { status: 'warning', overhang_in: 2 } });
  expect(controller.ghost.color.getHex()).toBe(new Color('hsl(45, 95%, 50%)').getHex());
  controller.dragMove(screenOf(4, 20)); // corner at x = −4
  expect(controller.held!.aim!.validation).toMatchObject({ status: 'invalid', rejection: 'excess_overhang' });
  expect(controller.ghost.color.getHex()).toBe(new Color('hsl(0, 85%, 55%)').getHex());
  controller.dragMove(screenOf(-200, 20)); // beyond the engine's grid range
  expect(controller.held!.aim!.validation.status).toBe('invalid');
  expect(controller.ghost.status).toBe('invalid');
});

it('commits a drop in the green and refills the bay', () => {
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(24, 20));
  expect(controller.drop()).toBe('placed');
  expect(engine.get_snapshot().placed_cases).toMatchObject([
    { sku_id: 'SKU-HF', grid_x: 8, grid_y: 4, rotation_yaw: 90, flipped: false, elevation_z: 0 },
  ]);
  expect(controller.held).toBeUndefined();
  expect(controller.ghost.visible).toBe(false);
  expect(events.map(event => event.type)).toEqual(['pick', 'placed']);
  expect(events[1]).toMatchObject({ type: 'placed', snapshot: { cases_placed: 1 } });
});

it('cancels a drop in the red, returning the case to its bay', () => {
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(4, 20));
  expect(controller.drop()).toBe('returned');
  expect(engine.get_snapshot().cases_placed).toBe(0);
  expect(controller.held).toBeUndefined();
  expect(controller.ghost.visible).toBe(false);
  expect(events[1]).toEqual({ type: 'returned', sku: bay('SKU-HF').sku, rejection: 'excess_overhang' });
});

/** Drags a case from its bay to the domain point under the pointer and drops it. */
function place(skuId: string, x: number, y: number, elevation = 0) {
  controller.dragStart({ kind: 'bay', bay: bay(skuId) });
  controller.dragMove(screenOf(x, y, elevation));
  return controller.drop();
}

it('aims at the top of a placed case to stack onto it', () => {
  expect(place('SKU-HF', 24, 20)).toBe('placed');
  // Medium Standard turned 90°: 12" × 20". Centered on the Heavy Flat's top, 8" up.
  controller.dragStart({ kind: 'bay', bay: bay('SKU-MS') });
  controller.dragMove(screenOf(24, 20, 8));
  expect(controller.held!.aim).toMatchObject({ gridX: 9, gridY: 5, validation: { status: 'valid', elevation_in: 8 } });
  expect(controller.ghost.bounds.min.y).toBe(8 + 2.375);
});

it('aims beside a placed case when pointing at its side', () => {
  place('SKU-HF', 24, 20); // spans x 16–32
  controller.dragStart({ kind: 'bay', bay: bay('SKU-MS') });
  controller.dragMove(screenOf(32, 20, 4)); // the +X face, halfway up
  expect(controller.held!.aim).toMatchObject({ gridX: 16, gridY: 5, validation: { status: 'valid', elevation_in: 0 } });
});

it('rotates the held case 90° clockwise and flips it onto its side, re-aiming at the same spot', () => {
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(24, 20));
  controller.rotate(); // 24" × 16" footprint centered on (24, 20)
  expect(controller.held).toMatchObject({ orientation: { yaw: 0, flipped: false }, aim: { gridX: 6, gridY: 6 } });
  controller.flip(); // rolled: 24" × 8" footprint, 16" tall
  expect(controller.held).toMatchObject({ orientation: { yaw: 0, flipped: true }, aim: { gridX: 6, gridY: 8 } });
  expect(controller.ghost.bounds.getSize(new Vector3()).toArray()).toEqual([24, 16, 8]);
  for (let turn = 0; turn < 3; turn++) controller.rotate();
  expect(controller.held!.orientation.yaw).toBe(90);
  expect(controller.drop()).toBe('placed');
  expect(engine.get_snapshot().placed_cases[0]).toMatchObject({ rotation_yaw: 90, flipped: true });
});

/** Where the top-center of a floor bay's carton appears on screen. */
function screenOfBay(skuId: string) {
  const { bounds } = bay(skuId);
  const top = bounds.getCenter(new Vector3()).setY(bounds.max.y).project(camera);
  return { x: (top.x + 1) / 2 * VIEWPORT.width, y: (1 - top.y) / 2 * VIEWPORT.height };
}

it('hit-tests floor cartons as draggable and placed cases as selectable only', () => {
  expect(controller.hitTest(screenOfBay('SKU-LT'))).toEqual({ target: { kind: 'bay', bay: bay('SKU-LT') }, draggable: true });
  expect(controller.hitTest(screenOfBay('SKU-HC'))).toEqual({ target: { kind: 'bay', bay: bay('SKU-HC') }, draggable: true });
  expect(controller.hitTest(screenOf(24, 20))).toBeUndefined();
  place('SKU-HF', 24, 20);
  const { id } = engine.get_snapshot().placed_cases[0];
  expect(controller.hitTest(screenOf(24, 20, 8))).toEqual({ target: { kind: 'case', id }, draggable: false });
});

it('selects a tapped case, deselects on a second tap or a tap on nothing', () => {
  const hc = { kind: 'bay', bay: bay('SKU-HC') } as const;
  controller.tap(hc);
  expect(controller.selected).toEqual(hc);
  controller.tap(hc);
  expect(controller.selected).toBeUndefined();
  controller.tap(hc);
  controller.tap(undefined);
  expect(controller.selected).toBeUndefined();
  place('SKU-HF', 24, 20);
  const placed = { kind: 'case', id: engine.get_snapshot().placed_cases[0].id } as const;
  controller.tap(placed);
  expect(controller.selected).toEqual(placed);
  expect(events.filter(event => event.type === 'select').map(event => event.target)).toEqual([hc, undefined, hc, undefined, placed]);
});

/** Visible cartons in the scene: SKU and footprint bounds, rounded to 1/1000". */
function visibleCartons() {
  const cartons: { sku: string; min: number[]; max: number[] }[] = [];
  scene.updateMatrixWorld(true);
  scene.traverseVisible(object => {
    if (!(object instanceof Carton)) return;
    const box = new Box3().setFromObject(object);
    const round = (v: Vector3) => v.toArray().map(n => Math.round(n * 1000) / 1000);
    cartons.push({ sku: object.sku.id, min: round(box.min), max: round(box.max) });
  });
  return cartons;
}

it('lifts the carton out of its bay while held, hovering it over the ghost, and puts it back after', () => {
  const atRest = visibleCartons();
  expect(atRest.map(carton => carton.sku)).toEqual(STAGING_BAYS.map(bay => bay.sku.id));
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(24, 20));
  const held = visibleCartons().filter(carton => carton.sku === 'SKU-HF');
  expect(held).toHaveLength(1);
  expect(held[0].min[1]).toBeGreaterThan(controller.ghost.bounds.max.y + 1); // clear of the ghost
  expect(held[0].max[0] - held[0].min[0]).toBeCloseTo(15.75); // turned 90°, like the ghost
  controller.flip();
  const flipped = visibleCartons().find(carton => carton.sku === 'SKU-HF')!;
  expect(flipped.max[1] - flipped.min[1]).toBeCloseTo(16);
  controller.drop();
  expect(visibleCartons()).toEqual(atRest);
});

it('outlines the selected case in cyan', () => {
  const marker = () => scene.getObjectByName('selection')!;
  expect(marker().visible).toBe(false);
  controller.tap({ kind: 'bay', bay: bay('SKU-LT') });
  expect(marker().visible).toBe(true);
  const outline = new Box3().setFromObject(marker());
  expect(outline.containsBox(bay('SKU-LT').bounds)).toBe(true);
  expect(outline.getSize(new Vector3()).x - bay('SKU-LT').bounds.getSize(new Vector3()).x).toBeLessThan(1);
  controller.tap(undefined);
  expect(marker().visible).toBe(false);
});

it('previews each pointer move on a full 100-case pallet in under 0.5 ms', () => {
  // Five layers of 20 Fragile Small (10" × 8" × 6") cover 40" × 40" of the deck, 30" high.
  for (let layer = 0; layer < 5; layer++) {
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 5; row++) engine.commit_placement('SKU-FS', column * 5, row * 4, 0, false);
    }
  }
  controller.dispose();
  controller = new PlacementController({ engine: engine as PalletEngine, camera, parent: scene, viewport: () => VIEWPORT });
  controller.dragStart({ kind: 'bay', bay: bay('SKU-MQ') });
  const moves = 2000;
  const start = performance.now();
  for (let i = 0; i < moves; i++) controller.dragMove(screenOf(6 + (i % 28), 6 + (i % 28), 30));
  const average = (performance.now() - start) / moves;
  // The 18 lb cube lands on the stack's top and would crush the Fragile Smalls below: yellow.
  expect(controller.held!.aim!.validation).toMatchObject({ status: 'warning', elevation_in: 30 });
  expect(average).toBeLessThan(0.5);
});

it('treats only an off-pallet anchor as red; other engine failures surface', () => {
  controller.dispose();
  const failing: PalletEngine = {
    get_snapshot: () => engine.get_snapshot(),
    commit_placement: () => { throw new Error('unused'); },
    validate_placement: () => { throw new Error('unknown SKU SKU-XX'); },
  };
  controller = new PlacementController({ engine: failing, camera, parent: scene, viewport: () => VIEWPORT });
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  expect(() => controller.dragMove(screenOf(24, 20))).toThrow('unknown SKU');
});
