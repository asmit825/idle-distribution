import {
  Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, MathUtils, Plane, Ray, Raycaster,
  Vector2, Vector3, type Camera, type Object3D,
} from 'three';
import { Carton, createBoxMesh } from '../rendering/BoxMesh';
import { GhostBox } from '../rendering/GhostBox';
import { caseBox, CELL_IN, DECK_Y, orientedSize, placedCaseBox, toDomain, type Orientation, type Yaw } from '../scene/coordinates';
import { STAGING_BAYS, type StagingBay } from '../scene/staging';
import type { SkuDef } from '../types/catalog';
import type { EngineSnapshot, PalletEngine, PlacedCase, Rejection, Validation } from '../types/engine';
import type { Hit, PointerHandlers, ScreenPoint } from './PointerManager';

export type PlacementTarget = { kind: 'bay'; bay: StagingBay } | { kind: 'case'; id: number };

export type PlacementEvent =
  | { type: 'pick'; sku: SkuDef; bay: StagingBay }
  | { type: 'placed'; sku: SkuDef; placed: PlacedCase; snapshot: EngineSnapshot }
  | { type: 'returned'; sku: SkuDef; rejection: Rejection | null }
  | { type: 'select'; target?: PlacementTarget };

export interface Aim {
  gridX: number;
  gridY: number;
  validation: Validation;
}

export interface HeldCase {
  bay: StagingBay;
  orientation: Orientation;
  /** Where it would land; unset until the pointer first moves over a surface. */
  aim?: Aim;
  /** The latest pointer position, for re-aiming after a rotate or flip. */
  point?: ScreenPoint;
}

export interface PlacementControllerOptions {
  engine: PalletEngine;
  camera: Camera;
  /** Scene node for the floor cartons, the held carton, the ghost, and the selection outline. */
  parent: Object3D;
  /** The canvas size in CSS pixels. */
  viewport: () => { width: number; height: number };
  /** The floor; the sandbox's eight bays by default. */
  bays?: readonly StagingBay[];
  /** Whether a bay refills after its case is placed (the sandbox), or stays empty (Mode 1). */
  refill?: boolean;
  /** Asked as a case leaves the floor; false refuses the pick. */
  pick?: (bay: StagingBay) => boolean;
  /** Asked before a held case lands in a valid spot; false returns it to the floor. */
  canDrop?: () => boolean;
  onEvent?: (event: PlacementEvent) => void;
}

const DECK_PLANE = new Plane(new Vector3(0, 1, 0), -DECK_Y);
/** Tolerance for deciding which face of a box a ray hit. */
const EPSILON = 1e-6;
/** The held carton floats this far above its ghost, so the landing volume stays visible. */
const HOVER_IN = 2;
/** SPEC-01 §7.1 "Selected / Active" accent. */
const SELECTED_COLOR = 'hsl(190, 95%, 50%)';
/** The selection outline stands this far off each face. */
const OUTLINE_GAP_IN = 0.25;
/** The verdict for an anchor too far off the pallet for the engine to consider. */
const OFF_PALLET: Validation = {
  status: 'invalid', rejection: 'excess_overhang', elevation_in: 0, overhang_in: Infinity, unsupported_fraction: 1, would_crush: 0,
};

/**
 * Picks cases from the staging bays, aims them at the 2" grid under the pointer, previews the
 * engine's verdict with the ghost box, and commits valid drops. Implements the pointer
 * pipeline's handlers, so a `PointerManager` can drive it directly.
 */
export class PlacementController implements PointerHandlers<PlacementTarget> {
  readonly ghost = new GhostBox();
  private readonly outline = new LineSegments(
    new EdgesGeometry(new BoxGeometry(1, 1, 1)),
    new LineBasicMaterial({ color: SELECTED_COLOR }),
  );
  private readonly options: PlacementControllerOptions;
  private readonly raycaster = new Raycaster();
  private heldCase?: HeldCase;
  private heldCarton?: Carton;
  private readonly bayCartons = new Map<StagingBay, Carton>();
  /** Ids of bays whose case is on the pallet and that do not refill. */
  private readonly emptied = new Set<number>();
  private locked = false;
  private selection?: PlacementTarget;
  /** Scene volumes of the placed cases, rebuilt with each snapshot. */
  private placedBoxes: { id: number; box: Box3 }[] = [];

  constructor(options: PlacementControllerOptions) {
    this.options = options;
    this.setSnapshot(options.engine.get_snapshot());
    options.parent.add(this.ghost);
    this.outline.name = 'selection';
    this.outline.visible = false;
    options.parent.add(this.outline);
    this.setBays(options.bays ?? STAGING_BAYS);
  }

  /** Bays with a case waiting in them, in layout order. */
  get bays(): StagingBay[] {
    return [...this.bayCartons.keys()];
  }

  /** Re-stages the floor, for example after an orientation change. Cancels any drag. */
  setBays(bays: readonly StagingBay[]) {
    this.cancel();
    if (this.selection?.kind === 'bay') this.tap(undefined);
    this.removeBayCartons();
    for (const bay of bays) {
      if (this.emptied.has(bay.id)) continue;
      const carton = orient(createBoxMesh(bay.sku), bay.yaw);
      carton.position.copy(bay.position);
      this.bayCartons.set(bay, carton);
      this.options.parent.add(carton);
    }
  }

  /** Ends interaction with the floor: cancels any drag; cases can be selected but not picked. */
  lock() {
    this.locked = true;
    this.cancel();
  }

  get held(): Readonly<HeldCase> | undefined {
    return this.heldCase;
  }

  get selected(): PlacementTarget | undefined {
    return this.selection;
  }

  /** The nearest floor carton (draggable) or placed case (selectable) under the pointer. */
  hitTest(point: ScreenPoint): Hit<PlacementTarget> | undefined {
    const ray = this.ray(point);
    let nearest: { target: PlacementTarget; distance: number } | undefined;
    const consider = (box: Box3, target: PlacementTarget) => {
      const hit = ray.intersectBox(box, new Vector3());
      const distance = hit?.distanceTo(ray.origin);
      if (distance !== undefined && (!nearest || distance < nearest.distance)) nearest = { target, distance };
    };
    for (const bay of this.bayCartons.keys()) consider(bay.bounds, { kind: 'bay', bay });
    for (const { id, box } of this.placedBoxes) consider(box, { kind: 'case', id });
    return nearest && { target: nearest.target, draggable: nearest.target.kind === 'bay' && !this.locked };
  }

  /** Selects the tapped case; tapping it again, or tapping nothing, deselects. */
  tap(target: PlacementTarget | undefined) {
    this.selection = target && !sameTarget(target, this.selection) ? target : undefined;
    this.updateOutline();
    this.emit({ type: 'select', target: this.selection });
  }

  dragStart(target: PlacementTarget) {
    if (target.kind !== 'bay' || this.locked || this.heldCase) return;
    const { bay } = target;
    const carton = this.bayCartons.get(bay);
    if (!carton || this.options.pick?.(bay) === false) return;
    this.heldCase = { bay, orientation: { yaw: bay.yaw, flipped: false } };
    carton.visible = false;
    this.rebuildHeldCarton();
    this.emit({ type: 'pick', sku: bay.sku, bay });
  }

  dragMove(point: ScreenPoint) {
    const held = this.heldCase;
    if (!held) return;
    held.point = point;
    const size = orientedSize(held.bay.sku, held.orientation);
    const center = this.aimCenter(this.ray(point), size);
    if (!center) return;
    const gridX = Math.round((center.x - size.x / 2) / CELL_IN);
    const gridY = Math.round((center.y - size.y / 2) / CELL_IN);
    const { sku } = held.bay;
    const { yaw, flipped } = held.orientation;
    let validation: Validation;
    try {
      validation = this.options.engine.validate_placement(sku.id, gridX, gridY, yaw, flipped);
    } catch (error) {
      if (!String(error).includes('off the pallet')) throw error;
      validation = OFF_PALLET;
    }
    held.aim = { gridX, gridY, validation };
    const landing = caseBox(sku, held.orientation, gridX, gridY, validation.elevation_in);
    this.ghost.show(landing, validation.status);
    const carton = this.heldCarton!;
    landing.getCenter(carton.position).setY(landing.max.y + HOVER_IN);
    carton.visible = true;
  }

  /** Commits the held case if its aim is valid or a warning; otherwise it returns to its bay. */
  drop(): 'placed' | 'returned' | undefined {
    const held = this.heldCase;
    if (!held) return undefined;
    this.release();
    const { sku } = held.bay;
    if (!held.aim || held.aim.validation.status === 'invalid' || this.options.canDrop?.() === false) {
      this.emit({ type: 'returned', sku, rejection: held.aim?.validation.rejection ?? null });
      return 'returned';
    }
    const { gridX, gridY } = held.aim;
    const snapshot = this.options.engine.commit_placement(sku.id, gridX, gridY, held.orientation.yaw, held.orientation.flipped);
    if (this.options.refill === false) this.emptyBay(held.bay);
    this.setSnapshot(snapshot);
    this.updateOutline();
    // Ids only grow, so the new case is last.
    this.emit({ type: 'placed', sku, placed: snapshot.placed_cases.at(-1)!, snapshot });
    return 'placed';
  }

  /** Abandons the drag; the case returns to its bay. */
  cancel() {
    const held = this.heldCase;
    if (!held) return;
    this.release();
    this.emit({ type: 'returned', sku: held.bay.sku, rejection: null });
  }

  /** Turns the held case 90° clockwise, seen from above. */
  rotate() {
    this.reorient(({ yaw, flipped }) => ({ yaw: ((yaw + 270) % 360) as Yaw, flipped }));
  }

  /** Rolls the held case onto its side, or back upright. */
  flip() {
    this.reorient(({ yaw, flipped }) => ({ yaw, flipped: !flipped }));
  }

  dispose() {
    this.release();
    this.options.parent.remove(this.ghost, this.outline);
    this.ghost.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
    this.removeBayCartons();
  }

  private removeBayCartons() {
    for (const carton of this.bayCartons.values()) {
      this.options.parent.remove(carton);
      carton.dispose();
    }
    this.bayCartons.clear();
  }

  /** Its case is on the pallet for good; the bay's carton leaves the floor. */
  private emptyBay(bay: StagingBay) {
    this.emptied.add(bay.id);
    const carton = this.bayCartons.get(bay)!;
    this.bayCartons.delete(bay);
    this.options.parent.remove(carton);
    carton.dispose();
  }

  /**
   * Domain X/Y where the held case should center: the point under the pointer on a placed
   * case's top or on the deck plane. Pointing at a case's side aims beside that face.
   */
  private aimCenter(ray: Ray, size: { x: number; y: number }) {
    let nearest: { point: Vector3; box?: Box3 } | undefined;
    const deck = ray.intersectPlane(DECK_PLANE, new Vector3());
    if (deck) nearest = { point: deck };
    for (const { box } of this.placedBoxes) {
      const point = ray.intersectBox(box, new Vector3());
      if (point && (!nearest || point.distanceToSquared(ray.origin) < nearest.point.distanceToSquared(ray.origin))) {
        nearest = { point, box };
      }
    }
    if (!nearest) return undefined;
    const { point, box } = nearest;
    const center = toDomain(point);
    if (box && point.y < box.max.y - EPSILON) {
      // A side face. Scene X is domain X; scene Z is domain Y.
      if (point.x <= box.min.x + EPSILON) center.x -= size.x / 2;
      else if (point.x >= box.max.x - EPSILON) center.x += size.x / 2;
      else if (point.z <= box.min.z + EPSILON) center.y -= size.y / 2;
      else if (point.z >= box.max.z - EPSILON) center.y += size.y / 2;
    }
    return center;
  }

  private reorient(change: (orientation: Orientation) => Orientation) {
    const held = this.heldCase;
    if (!held) return;
    held.orientation = change(held.orientation);
    this.rebuildHeldCarton();
    if (held.point) this.dragMove(held.point);
  }

  private updateOutline() {
    const target = this.selection;
    const box = target?.kind === 'bay' ? target.bay.bounds : this.placedBoxes.find(({ id }) => target?.kind === 'case' && id === target.id)?.box;
    this.outline.visible = !!box;
    if (!box) return;
    box.getSize(this.outline.scale).addScalar(2 * OUTLINE_GAP_IN);
    box.getCenter(this.outline.position);
  }

  private setSnapshot(snapshot: EngineSnapshot) {
    this.placedBoxes = snapshot.placed_cases.map(placed => ({ id: placed.id, box: placedCaseBox(placed) }));
  }

  /** A fresh held carton for the current orientation; hidden until it has somewhere to hover. */
  private rebuildHeldCarton() {
    const held = this.heldCase!;
    const previous = this.heldCarton;
    const carton = orient(createBoxMesh(held.bay.sku, { flipped: held.orientation.flipped }), held.orientation.yaw);
    carton.visible = false;
    if (previous) {
      carton.position.copy(previous.position);
      carton.visible = previous.visible;
      this.removeHeldCarton();
    }
    this.heldCarton = carton;
    this.options.parent.add(carton);
  }

  private removeHeldCarton() {
    if (!this.heldCarton) return;
    this.options.parent.remove(this.heldCarton);
    this.heldCarton.dispose();
    this.heldCarton = undefined;
  }

  /** Ends the drag: the held carton goes away and its bay is full again. */
  private release() {
    if (this.heldCase) this.bayCartons.get(this.heldCase.bay)!.visible = true;
    this.heldCase = undefined;
    this.removeHeldCarton();
    this.ghost.hide();
  }

  private emit(event: PlacementEvent) {
    this.options.onEvent?.(event);
  }

  private ray({ x, y }: ScreenPoint): Ray {
    const { width, height } = this.options.viewport();
    this.raycaster.setFromCamera(new Vector2(x / width * 2 - 1, 1 - y / height * 2), this.options.camera);
    return this.raycaster.ray;
  }
}

function orient(carton: Carton, yaw: Yaw) {
  carton.rotation.y = MathUtils.degToRad(yaw);
  return carton;
}

function sameTarget(a: PlacementTarget, b: PlacementTarget | undefined) {
  return a.kind === 'bay' ? b?.kind === 'bay' && b.bay === a.bay : b?.kind === 'case' && b.id === a.id;
}
