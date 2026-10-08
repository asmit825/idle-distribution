import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Box3, Color, Group, PerspectiveCamera, Vector3 } from 'three';
import { Engine, initSync } from '../../pkg/pallet_sim';
import { conveyorPickBays } from '../rendering/ConveyorBelt';
import { Carton } from '../rendering/BoxMesh';
import { disposeBoxMaterials } from '../rendering/materials';
import { placedCaseBox, toScene } from '../scene/coordinates';
import { stageFloor } from '../game/FloorStaging';
import { STAGING_BAYS, stagingBay, type StagingBay } from '../scene/staging';
import type { EngineSnapshot, PalletEngine } from '../types/engine';
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
  expect(controller.selected).toEqual({ kind: 'case', id: engine.get_snapshot().placed_cases[0].id });
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

it('hit-tests floor cartons and exposed placed cases as draggable', () => {
  expect(controller.hitTest(screenOfBay('SKU-LT'))).toEqual({ target: { kind: 'bay', bay: bay('SKU-LT') }, draggable: true });
  expect(controller.hitTest(screenOfBay('SKU-HC'))).toEqual({ target: { kind: 'bay', bay: bay('SKU-HC') }, draggable: true });
  expect(controller.hitTest(screenOf(24, 20))).toBeUndefined();
  place('SKU-HF', 24, 20);
  const { id } = engine.get_snapshot().placed_cases[0];
  expect(controller.hitTest(screenOf(24, 20, 8))).toEqual({ target: { kind: 'case', id }, draggable: true });
  controller.lock();
  expect(controller.hitTest(screenOf(24, 20, 8))).toEqual({ target: { kind: 'case', id }, draggable: false });
});

it('hit-tests a case under others as the top case of its stack', () => {
  place('SKU-HF', 24, 20); // 16" × 24" × 8", pressed below on its +X face
  place('SKU-MQ', 24, 20, 8); // 12" × 12" on its top
  const [base, top] = engine.get_snapshot().placed_cases;
  expect(controller.hitTest(screenOf(32, 20, 4))).toEqual({ target: { kind: 'case', id: top.id }, draggable: true });
  expect(base.id).not.toBe(top.id);
});

it('keeps the case it just placed selected, so nudges fine-tune it through the engine', () => {
  camera.position.set(0, 80, 80);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  place('SKU-HF', 24, 20);
  const { id } = engine.get_snapshot().placed_cases[0];
  expect(controller.selected).toEqual({ kind: 'case', id });
  controller.nudge('right');
  controller.nudge('up');
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ id, grid_x: 9, grid_y: 3, elevation_z: 0 }]);
  expect(events.slice(-2).map(event => event.type)).toEqual(['moved', 'moved']);
  expect(controller.selected).toEqual({ kind: 'case', id });
  const outline = new Box3().setFromObject(scene.getObjectByName('selection')!);
  expect(outline.containsBox(placedBox(id))).toBe(true);
});

it('refuses a nudge that would break a rule, leaving the case where it was', () => {
  camera.position.set(0, 80, 80);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  place('SKU-HF', 8, 20); // x 0–16
  controller.nudge('left'); // a 2″ overhang is allowed
  controller.nudge('left'); // 4″ is not
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ grid_x: -1 }]);
  expect(events.at(-1)).toEqual({ type: 'blocked', sku: bay('SKU-HF').sku, rejection: 'excess_overhang' });
});

it('rotates and flips the selected placed case about its center', () => {
  place('SKU-HF', 24, 20); // 16" × 24" at grid 8, 4
  controller.rotate();
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ rotation_yaw: 0, flipped: false, grid_x: 6, grid_y: 6 }]);
  controller.flip(); // 24" × 8", 16" tall
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ rotation_yaw: 0, flipped: true, grid_x: 6, grid_y: 8 }]);
  controller.confirm();
  expect(controller.selected).toBeUndefined();
  controller.rotate(); // nothing selected or held
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ rotation_yaw: 0 }]);
});

it('lifts an exposed placed case and drops it somewhere else, keeping its id', () => {
  place('SKU-HF', 24, 20); // x 16–32, y 8–32
  const { id } = engine.get_snapshot().placed_cases[0];
  controller.dragStart({ kind: 'case', id });
  expect(events.at(-1)).toEqual({ type: 'lift', sku: bay('SKU-HF').sku, id });
  expect(controller.held).toMatchObject({ source: { kind: 'case', id }, orientation: { yaw: 90, flipped: false } });
  // The case no longer counts while lifted: aiming at its own spot lands on the deck.
  controller.dragMove(screenOf(26, 20));
  expect(controller.held!.aim).toMatchObject({ gridX: 9, gridY: 4, validation: { status: 'valid', elevation_in: 0 } });
  controller.dragMove(screenOf(12, 20));
  expect(controller.drop()).toBe('moved');
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ id, grid_x: 2, grid_y: 4 }]);
  expect(events.at(-1)).toMatchObject({ type: 'moved', placed: { id, grid_x: 2 } });
  expect(controller.selected).toEqual({ kind: 'case', id });
});

it('puts a lifted case back where it was if dropped in the red, and takes it off the pallet if dropped off the deck', () => {
  place('SKU-HF', 24, 20);
  const { id } = engine.get_snapshot().placed_cases[0];
  controller.dragStart({ kind: 'case', id });
  controller.dragMove(screenOf(4, 20)); // 4″ over the edge
  expect(controller.drop()).toBe('returned');
  expect(events.at(-1)).toEqual({ type: 'returned', sku: bay('SKU-HF').sku, rejection: 'excess_overhang', id });
  expect(engine.get_snapshot().placed_cases).toMatchObject([{ id, grid_x: 8, grid_y: 4 }]);

  controller.dragStart({ kind: 'case', id });
  controller.dragMove(screenOf(-40, 20));
  expect(controller.drop()).toBe('removed');
  expect(engine.get_snapshot().cases_placed).toBe(0);
  expect(events.at(-1)).toMatchObject({ type: 'removed', id });
});

/** The scene volume of placed case `id`. */
function placedBox(id: number) {
  return placedCaseBox((engine as PalletEngine).get_snapshot().placed_cases.find(placed => placed.id === id)!);
}

it('selects a tapped case, deselects on a tap on nothing or a second tap on a floor carton', () => {
  const hc = { kind: 'bay', bay: bay('SKU-HC') } as const;
  controller.tap(hc);
  expect(controller.selected).toEqual(hc);
  controller.tap(hc);
  expect(controller.selected).toBeUndefined();
  controller.tap(hc);
  controller.tap(undefined);
  expect(controller.selected).toBeUndefined();
  place('SKU-HF', 24, 20); // selected as it lands
  const placed = { kind: 'case', id: engine.get_snapshot().placed_cases[0].id } as const;
  expect(controller.selected).toEqual(placed);
  controller.tap(placed); // a placed case stays selected
  expect(controller.selected).toEqual(placed);
  controller.tap(undefined);
  expect(controller.selected).toBeUndefined();
  expect(events.filter(event => event.type === 'select').map(event => event.target)).toEqual([hc, undefined, hc, undefined, placed, undefined]);
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
    remove_placement: (id, now) => engine.remove_placement(id, now),
    get_snapshot: () => engine.get_snapshot(),
    commit_placement: () => { throw new Error('unused'); },
    validate_placement: () => { throw new Error('unknown SKU SKU-XX'); },
    validate_move: () => { throw new Error('unused'); },
    move_placement: () => { throw new Error('unused'); },
  };
  controller = new PlacementController({ engine: failing, camera, parent: scene, viewport: () => VIEWPORT });
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  expect(() => controller.dragMove(screenOf(24, 20))).toThrow('unknown SKU');
});

describe('on a Mode 1 floor', () => {
  let floor: StagingBay[];
  /** The shift clock's `performance.now()`. */
  let now: number;
  const first = (skuId: string) => floor.find(bay => bay.sku.id === skuId)!;
  const phase = () => engine.get_snapshot().mode1!.phase;
  /** Where the top-center of a floor carton appears on screen. */
  const screenOfCarton = ({ bounds }: StagingBay) => {
    const top = bounds.getCenter(new Vector3()).setY(bounds.max.y).project(camera);
    return { x: (top.x + 1) / 2 * VIEWPORT.width, y: (1 - top.y) / 2 * VIEWPORT.height };
  };

  beforeEach(() => {
    controller.dispose();
    now = 1_000;
    engine.start_mode1(42n);
    floor = stageFloor(engine.floor_cases(), 'radial');
    controller = new PlacementController({
      engine: engine as PalletEngine,
      camera,
      parent: scene,
      viewport: () => VIEWPORT,
      bays: floor,
      refill: false,
      pick: bay => {
        try { engine.pick_case(bay.id, now); return true; } catch { return false; }
      },
      canDrop: () => engine.tick(now)!.phase !== 'complete',
      onEvent: event => events.push(event),
    });
  });

  it('starts the clock on the first pick and empties each bay once its case is placed', () => {
    expect(visibleCartons()).toHaveLength(25);
    const light = first('SKU-LT');
    expect(phase()).toBe('staged');
    controller.dragStart({ kind: 'bay', bay: light });
    expect(phase()).toBe('running');
    expect(events[0]).toEqual({ type: 'pick', sku: light.sku, bay: light });
    controller.dragMove(screenOf(24, 20));
    expect(controller.drop()).toBe('placed');
    expect(engine.get_snapshot().mode1!.cases_on_floor).toBe(24);
    expect(visibleCartons()).toHaveLength(24); // placed cases render from the snapshot
    expect(controller.hitTest(screenOfCarton(light))?.target).not.toEqual({ kind: 'bay', bay: light });

    // Its bay stays empty: there is nothing left to pick there.
    controller.dragStart({ kind: 'bay', bay: light });
    expect(controller.held).toBeUndefined();
  });

  it('shows a heavy case over a light one in yellow and lets it land, crushing the light one', () => {
    controller.dragStart({ kind: 'bay', bay: first('SKU-LT') });
    controller.dragMove(screenOf(24, 20));
    controller.drop();
    const heavy = first('SKU-HC');
    controller.dragStart({ kind: 'bay', bay: heavy });
    controller.dragMove(screenOf(24, 20, 15)); // the Light Tall's top
    expect(controller.held!.aim!.validation).toMatchObject({ status: 'warning', rejection: null, elevation_in: 15, would_crush: 1 });
    expect(controller.ghost.status).toBe('warning');
    expect(controller.drop()).toBe('placed');
    const snapshot: EngineSnapshot = engine.get_snapshot();
    expect(snapshot.placed_cases.map(placed => [placed.sku_id, placed.crushed])).toEqual([['SKU-LT', true], ['SKU-HC', false]]);
    expect(snapshot.crush_penalty).toBeGreaterThan(0);
    expect(visibleCartons()).toHaveLength(23);
  });

  it('returns the held case if the shift ran out before the drop', () => {
    const medium = first('SKU-MQ');
    controller.dragStart({ kind: 'bay', bay: medium });
    controller.dragMove(screenOf(24, 20));
    expect(controller.ghost.status).toBe('valid');
    now += 60_000; // no frame has ticked the clock since
    expect(controller.drop()).toBe('returned');
    expect(events.at(-1)).toEqual({ type: 'returned', sku: medium.sku, rejection: null });
    expect(engine.get_snapshot()).toMatchObject({ cases_placed: 0, mode1: { phase: 'complete', end_reason: 'time_up' } });
  });

  it('refuses a pick the shift turns down', () => {
    engine.ship(now);
    controller.dragStart({ kind: 'bay', bay: first('SKU-MQ') });
    expect(controller.held).toBeUndefined();
    expect(events).toEqual([]);
    expect(visibleCartons()).toHaveLength(25);
  });

  it('locking cancels the held case and leaves the floor to look at, not pick', () => {
    const heavy = first('SKU-HC');
    controller.dragStart({ kind: 'bay', bay: heavy });
    controller.dragMove(screenOf(24, 20));
    controller.lock();
    expect(controller.held).toBeUndefined();
    expect(controller.ghost.visible).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'returned', sku: heavy.sku, rejection: null });
    expect(visibleCartons()).toHaveLength(25);
    expect(controller.hitTest(screenOfCarton(heavy))).toEqual({ target: { kind: 'bay', bay: heavy }, draggable: false });
    controller.dragStart({ kind: 'bay', bay: heavy });
    expect(controller.held).toBeUndefined();
  });

  it('re-stages the floor in a new layout, keeping placed cases off it', () => {
    const light = first('SKU-LT');
    controller.dragStart({ kind: 'bay', bay: light });
    controller.dragMove(screenOf(24, 20));
    controller.drop();
    const portrait = stageFloor(engine.floor_cases(), 'portrait');
    controller.setBays(portrait);
    expect(controller.bays).toEqual(portrait.filter(bay => bay.id !== light.id));
    // Each carton renders 1/8" inside its footprint.
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const xs = (values: number[]) => values.map(round).sort((a, b) => a - b);
    const onFloor = visibleCartons().filter(carton => carton.min[1] < 0);
    expect(xs(onFloor.map(carton => carton.min[0]))).toEqual(
      xs(portrait.filter(bay => bay.id !== light.id).map(bay => bay.bounds.min.x + 0.125)),
    );
    const emptied = portrait.find(bay => bay.id === light.id)!;
    expect(controller.hitTest(screenOfCarton(emptied))?.target).not.toEqual({ kind: 'bay', bay: emptied });
  });
});

it('picks a selected carton for thumb controls and nudges one grid cell relative to the camera', () => {
  camera.position.set(0, 80, 80);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  controller.tap({ kind: 'bay', bay: bay('SKU-HF') });
  controller.pickSelected();
  expect(controller.held?.aim).toMatchObject({ gridX: 8, gridY: 4 });
  controller.nudge('right');
  expect(controller.held?.aim).toMatchObject({ gridX: 9, gridY: 4 });
  controller.nudge('up');
  expect(controller.held?.aim).toMatchObject({ gridX: 9, gridY: 3 });
  camera.position.set(80, 80, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  controller.nudge('right');
  expect(controller.held?.aim).toMatchObject({ gridX: 9, gridY: 2 });
  controller.rotate();
  expect(controller.held?.aim).toMatchObject({ gridX: 9, gridY: 2 });
  expect(controller.drop()).toBe('placed');
  expect(engine.get_snapshot().placed_cases[0]).toMatchObject({ grid_x: 9, grid_y: 2 });
});

it('keeps nudges on one axis in the isometric view, however the camera drifts around 45°', () => {
  controller.tap({ kind: 'bay', bay: bay('SKU-HF') });
  controller.pickSelected();
  const start = controller.held!.aim!;
  // Damping and height tracking leave the iso camera a hair to either side of the X = Z diagonal.
  for (const drift of [1e-9, -1e-9, 1e-9]) {
    camera.position.set(80, 80, 80 + drift);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    controller.nudge('right');
  }
  // The tie goes to the pallet's long (48″) axis.
  expect(controller.held?.aim).toMatchObject({ gridX: start.gridX + 3, gridY: start.gridY });
  controller.nudge('left');
  controller.nudge('left');
  controller.nudge('left');
  expect(controller.held?.aim).toMatchObject({ gridX: start.gridX, gridY: start.gridY });
});

it('returns a removed exposed case to the Mode 1 floor and updates the authoritative load metrics', () => {
  controller.dispose();
  engine.start_mode1(42n);
  const floor = stageFloor(engine.floor_cases(), 'radial');
  controller = new PlacementController({ engine, camera, parent: scene, viewport: () => VIEWPORT, bays: floor, refill: false,
    pick: bay => { engine.pick_case(bay.id, 100); return true; } });
  const target = floor.find(bay => bay.sku.id === 'SKU-MQ')!;
  controller.dragStart({ kind: 'bay', bay: target });
  controller.dragMove(screenOf(24, 20));
  controller.drop();
  // The dropped case stays selected.
  controller.remove();
  expect(engine.get_snapshot()).toMatchObject({ cases_placed: 0, total_weight_lbs: 0, max_height_inches: 0,
    cog_inches: [24, 20], mode1: { cases_on_floor: 25 } });
  expect(controller.bays.some(bay => bay.id === target.id)).toBe(true);
  controller.dragStart({ kind: 'bay', bay: target });
  controller.dragMove(screenOf(24, 20));
  expect(controller.drop()).toBe('placed');
  engine.ship(200);
  expect(() => controller.remove()).toThrow(/over/);
  expect(engine.get_snapshot().cases_placed).toBe(1);
});


it('keeps a drag going when the floor changes around the held carton, and drops it as usual', () => {
  controller.dragStart({ kind: 'bay', bay: bay('SKU-HF') });
  controller.dragMove(screenOf(24, 20));
  // A new list with the held carton still in it, as when another carton reaches the pick run.
  const restaged = STAGING_BAYS.map(({ id, sku, yaw, position }) => stagingBay(id, sku, yaw, position.x + 1, position.z));
  controller.setBays(restaged);
  expect(controller.held).toMatchObject({ source: { kind: 'bay', bay: restaged.find(({ sku }) => sku.id === 'SKU-HF') } });
  expect(events.map(event => event.type)).toEqual(['pick']);
  expect(controller.drop()).toBe('placed');
  // Without it, the drag is cancelled.
  controller.dragStart({ kind: 'bay', bay: restaged[0] });
  controller.setBays(restaged.slice(1));
  expect(controller.held).toBeUndefined();
  expect(events.at(-1)).toMatchObject({ type: 'returned' });
});

it('removes only exposed Mode 2 cases without reordering the FIFO and refuses removal after Estop', () => {
  controller.dispose();
  engine.start_mode2(2149n, 0);
  engine.tick_mode2(7000);
  const [first] = conveyorPickBays(engine.get_snapshot().mode2);
  controller = new PlacementController({ engine, camera, parent: scene, viewport: () => VIEWPORT, bays: [first], refill: false,
    pick: bay => { engine.pick_case(bay.id, 7000); return true; } });
  controller.dragStart({ kind: 'bay', bay: first });
  controller.dragMove(screenOf(24, 20)); controller.drop();
  const [second] = conveyorPickBays(engine.get_snapshot().mode2);
  controller.setBays([second]);
  controller.dragStart({ kind: 'bay', bay: second });
  controller.dragMove(screenOf(24, 20, 15)); controller.drop();
  const [base, top] = engine.get_snapshot().placed_cases;
  controller.tap({ kind: 'case', id: base.id });
  expect(() => controller.remove()).toThrow(/supporting/);
  controller.tap({ kind: 'case', id: top.id });
  controller.remove();
  expect(engine.get_snapshot()).toMatchObject({ cases_placed: 1, max_height_inches: 15, mode2: { queue: [], arrival_interval_ms: 3125 } });
  engine.tick_mode2(100000);
  controller.tap({ kind: 'case', id: base.id });
  expect(() => controller.remove()).toThrow(/over/);
});
