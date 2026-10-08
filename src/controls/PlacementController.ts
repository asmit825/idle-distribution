import {
  Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, MathUtils, Plane, Ray, Raycaster,
  Vector2, Vector3, type Camera, type Object3D,
} from 'three';
import { Carton, createBoxMesh } from '../rendering/BoxMesh';
import { GhostBox } from '../rendering/GhostBox';
import {
  caseBox, CELL_IN, DECK_Y, orientedSize, PALLET_LENGTH_IN, PALLET_WIDTH_IN, placedCaseBox, toDomain, type Orientation, type Yaw,
} from '../scene/coordinates';
import { STAGING_BAYS, type StagingBay } from '../scene/staging';
import { skuById, type SkuDef } from '../types/catalog';
import type { EngineSnapshot, PalletEngine, PlacedCase, Rejection, Validation } from '../types/engine';
import type { Hit, NudgeDirection, PointerHandlers, ScreenPoint } from './PointerManager';

export type PlacementTarget = { kind: 'bay'; bay: StagingBay } | { kind: 'case'; id: number };

export type PlacementEvent =
  | { type: 'pick'; sku: SkuDef; bay: StagingBay }
  | { type: 'lift'; sku: SkuDef; id: number }
  | { type: 'placed'; sku: SkuDef; placed: PlacedCase; snapshot: EngineSnapshot }
  | { type: 'moved'; sku: SkuDef; placed: PlacedCase; snapshot: EngineSnapshot }
  /** A held case went back where it came from: its bay, or, for case `id`, its spot on the pallet. */
  | { type: 'returned'; sku: SkuDef; rejection: Rejection | null; id?: number }
  /** The selected case cannot be nudged or turned that way. */
  | { type: 'blocked'; sku: SkuDef; rejection: Rejection }
  | { type: 'select'; target?: PlacementTarget }
  | { type: 'removed'; id: number; snapshot: EngineSnapshot };

export interface Aim {
  gridX: number;
  gridY: number;
  validation: Validation;
}

export interface HeldCase {
  sku: SkuDef;
  /** Where it came from: a floor bay, or its spot on the pallet. */
  source: PlacementTarget;
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
  /** The floor; free placement's eight bays by default. */
  bays?: readonly StagingBay[];
  /** Whether a bay refills after its case is placed (free placement), or stays empty (Mode 1). */
  refill?: boolean;
  /** False when equipment renders the waiting cartons and supplies their live positions. */
  renderBays?: boolean;
  /** Asked as a case leaves the floor; false refuses the pick. */
  pick?: (bay: StagingBay) => boolean;
  /** Asked before a held case lands in a valid spot; false returns it to the floor. */
  canDrop?: () => boolean;
  onEvent?: (event: PlacementEvent) => void;
  onPreview?: () => void;
}

const DECK_PLANE = new Plane(new Vector3(0, 1, 0), -DECK_Y);
/** Tolerance for deciding which face of a box a ray hit. */
const EPSILON = 1e-6;
/**
 * How close the camera's right vector may come to a pallet diagonal and still count as lying on
 * it. The isometric view sits exactly on one, and damping drifts it by far less than this.
 */
const NUDGE_TIE = 1e-3;
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
 * Picks cases from the staging bays or lifts exposed ones off the pallet, aims them at the 2"
 * grid under the pointer, previews the engine's verdict with the ghost box, and commits valid
 * drops. The case just dropped stays selected, so nudges, rotates, and flips fine-tune it in
 * place. Implements the pointer pipeline's handlers, so a `PointerManager` can drive it directly.
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
  private allBays: readonly StagingBay[] = [];
  private readonly placedSources = new Map<number, number>();
  private selection?: PlacementTarget;
  /** The placed cases and their scene volumes, rebuilt with each snapshot. */
  private placed: { placed: PlacedCase; box: Box3 }[] = [];

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

  /**
   * Re-stages the floor, for example after an orientation change or a conveyor arrival. A drag
   * carries on if the new floor still has the held carton's bay; otherwise it is cancelled.
   */
  setBays(bays: readonly StagingBay[]) {
    this.allBays = bays;
    const held = this.heldCase;
    const heldBay = held?.source.kind === 'bay' ? held.source.bay.id : undefined;
    const kept = bays.find(bay => bay.id === heldBay);
    if (!kept) this.cancel();
    if (this.selection?.kind === 'bay') this.tap(undefined);
    this.removeBayCartons();
    for (const bay of bays) {
      if (this.emptied.has(bay.id)) continue;
      const carton = orient(createBoxMesh(bay.sku), bay.yaw);
      carton.position.copy(bay.position);
      carton.visible = this.options.renderBays !== false && bay !== kept;
      this.bayCartons.set(bay, carton);
      this.options.parent.add(carton);
    }
    if (held && kept) held.source = { kind: 'bay', bay: kept };
  }

  /** Moves a live equipment bay without cancelling its drag or replacing its identity. */
  moveBay(id: number, position: Vector3) {
    for (const [bay, carton] of this.bayCartons) {
      if (bay.id !== id) continue;
      bay.bounds.translate(position.clone().sub(bay.position));
      bay.position.copy(position);
      carton.position.copy(position);
      this.updateOutline();
      break;
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
    for (const { placed, box } of this.placed) consider(box, { kind: 'case', id: placed.id });
    if (nearest?.target.kind === 'case') nearest.target = { kind: 'case', id: this.topOfStack(nearest.target.id) };
    return nearest && { target: nearest.target, draggable: !this.locked };
  }

  /**
   * Selects the tapped case. Tapping nothing deselects, and so does tapping a floor carton again;
   * a placed case stays selected, ready to fine-tune.
   */
  tap(target: PlacementTarget | undefined) {
    this.selection = target && (target.kind === 'case' || !sameTarget(target, this.selection)) ? target : undefined;
    this.updateOutline();
    this.emit({ type: 'select', target: this.selection });
  }

  dragStart(target: PlacementTarget) {
    if (this.locked || this.heldCase) return;
    if (target.kind === 'case') {
      const placed = this.placedCase(target.id);
      if (!placed) return;
      const sku = skuById(placed.sku_id);
      this.heldCase = { sku, source: target, orientation: { yaw: placed.rotation_yaw, flipped: placed.flipped } };
      this.selection = target;
      this.updateOutline();
      this.rebuildHeldCarton();
      this.emit({ type: 'lift', sku, id: target.id });
      return;
    }
    const { bay } = target;
    const carton = this.bayCartons.get(bay);
    if (!carton || this.options.pick?.(bay) === false) return;
    this.heldCase = { sku: bay.sku, source: target, orientation: { yaw: bay.yaw, flipped: false } };
    carton.visible = false;
    this.rebuildHeldCarton();
    this.emit({ type: 'pick', sku: bay.sku, bay });
  }

  dragMove(point: ScreenPoint) {
    const held = this.heldCase;
    if (!held) return;
    held.point = point;
    const size = orientedSize(held.sku, held.orientation);
    const center = this.aimCenter(this.ray(point), size);
    if (!center) return;
    const gridX = Math.round((center.x - size.x / 2) / CELL_IN);
    const gridY = Math.round((center.y - size.y / 2) / CELL_IN);
    this.aimAt(gridX, gridY);
  }

  /** Starts a tap-selected case at the deck center, leaving the finger free for the HUD. */
  pickSelected() {
    if (this.heldCase || this.selection?.kind !== 'bay') return;
    this.dragStart(this.selection);
    const held = this.heldCase as HeldCase | undefined;
    if (!held) return;
    const size = orientedSize(held.sku, held.orientation);
    this.aimAt(Math.round((48 - size.x) / 4), Math.round((40 - size.y) / 4));
  }

  /**
   * One 2-inch grid step along the closest screen-relative pallet axis: of the held case's aim,
   * or of the selected placed case, which moves at once if the engine allows it.
   */
  nudge(direction: NudgeDirection) {
    if (this.locked) return;
    const right = new Vector3().setFromMatrixColumn(this.options.camera.matrixWorld, 0);
    // On a diagonal view, right goes along the pallet's long (48″) X axis.
    const x = Math.abs(right.x) + NUDGE_TIE >= Math.abs(right.z) ? Math.sign(right.x) : 0;
    const y = x ? 0 : Math.sign(right.z);
    const [dx, dy] = direction === 'right' ? [x, y] : direction === 'left' ? [-x, -y]
      : direction === 'up' ? [y, -x] : [-y, x];
    const held = this.heldCase;
    if (held?.aim) {
      held.point = undefined;
      this.aimAt(held.aim.gridX + dx, held.aim.gridY + dy);
    } else if (!held) {
      this.moveSelected(placed => ({ gridX: placed.grid_x + dx, gridY: placed.grid_y + dy }));
    }
  }

  private aimAt(gridX: number, gridY: number) {
    const held = this.heldCase!;
    const { sku } = held;
    const validation = this.validate(held.source, sku, gridX, gridY, held.orientation);
    held.aim = { gridX, gridY, validation };
    const landing = caseBox(sku, held.orientation, gridX, gridY, validation.elevation_in);
    this.ghost.show(landing, validation.status);
    const carton = this.heldCarton!;
    landing.getCenter(carton.position).setY(landing.max.y + HOVER_IN);
    carton.visible = true;
    this.options.onPreview?.();
  }

  /**
   * Commits the held case if its aim is valid or a warning, and selects it; otherwise it goes
   * back where it came from. A case lifted off the pallet and dropped clear of the deck is removed.
   */
  drop(): 'placed' | 'moved' | 'removed' | 'returned' | undefined {
    const held = this.heldCase;
    if (!held) return undefined;
    this.release();
    const { sku, source, aim } = held;
    if (source.kind === 'case' && aim && !onDeck(sku, held.orientation, aim) && this.options.canDrop?.() !== false) {
      this.removeCase(source.id);
      return 'removed';
    }
    if (!aim || aim.validation.status === 'invalid' || this.options.canDrop?.() === false) {
      this.updateOutline();
      this.emit({ type: 'returned', sku, rejection: aim?.validation.rejection ?? null, id: this.liftedId(source) });
      return 'returned';
    }
    const { yaw, flipped } = held.orientation;
    if (source.kind === 'case') {
      this.commitMove(source.id, sku, aim.gridX, aim.gridY, held.orientation);
      return 'moved';
    }
    const snapshot = this.options.engine.commit_placement(sku.id, aim.gridX, aim.gridY, yaw, flipped);
    // Ids only grow, so the new case is last.
    const placed = snapshot.placed_cases.at(-1)!;
    this.placedSources.set(placed.id, source.bay.id);
    if (this.options.refill === false) this.emptyBay(source.bay);
    this.selection = { kind: 'case', id: placed.id };
    this.setSnapshot(snapshot);
    this.updateOutline();
    this.emit({ type: 'placed', sku, placed, snapshot });
    return 'placed';
  }

  /** Abandons the drag; the case goes back where it came from. */
  cancel() {
    const held = this.heldCase;
    if (!held) return;
    this.release();
    if (held.source.kind === 'bay') this.selection = undefined;
    this.updateOutline();
    this.emit({ type: 'returned', sku: held.sku, rejection: null, id: this.liftedId(held.source) });
  }

  /** Accepts the selected case where it is, clearing the selection. */
  confirm() {
    if (this.selection && !this.heldCase) this.tap(undefined);
  }

  /** Returns a held carton, or removes the selected exposed carton through the engine. */
  remove() {
    if (this.locked) return;
    if (this.heldCase) { this.cancel(); return; }
    if (this.selection?.kind !== 'case' || this.options.canDrop?.() === false) return;
    this.removeCase(this.selection.id);
  }

  private removeCase(id: number) {
    const snapshot = this.options.engine.remove_placement(id, performance.now());
    // Mode 1 returns inventory to the floor; Mode 2 discards without altering FIFO order.
    const source = this.placedSources.get(id);
    if (snapshot.mode1 && source !== undefined) {
      this.emptied.delete(source);
      this.setBays(this.allBays);
    }
    this.placedSources.delete(id);
    this.selection = undefined;
    this.setSnapshot(snapshot);
    this.updateOutline();
    this.emit({ type: 'removed', id, snapshot });
  }

  /** Turns the held or selected case 90° clockwise, seen from above. */
  rotate() {
    this.reorient(({ yaw, flipped }) => ({ yaw: ((yaw + 270) % 360) as Yaw, flipped }));
  }

  /** Rolls the held or selected case onto its side, or back upright. */
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
    const lifted = this.lifted;
    for (const { placed, box } of this.placed) {
      if (placed.id === lifted) continue;
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
    if (!held) {
      // Turn the selected case about its center.
      this.moveSelected((placed, sku) => {
        const before = { yaw: placed.rotation_yaw, flipped: placed.flipped };
        const orientation = change(before);
        const [from, to] = [orientedSize(sku, before), orientedSize(sku, orientation)];
        return {
          gridX: placed.grid_x + Math.round((from.x - to.x) / 2 / CELL_IN),
          gridY: placed.grid_y + Math.round((from.y - to.y) / 2 / CELL_IN),
          orientation,
        };
      });
      return;
    }
    held.orientation = change(held.orientation);
    this.rebuildHeldCarton();
    if (held.point) this.dragMove(held.point);
    else if (held.aim) this.aimAt(held.aim.gridX, held.aim.gridY);
  }

  /**
   * Moves the selected placed case where `change` says, if the engine allows it; otherwise
   * reports why not and leaves it be.
   */
  private moveSelected(change: (placed: PlacedCase, sku: SkuDef) => { gridX: number; gridY: number; orientation?: Orientation }) {
    if (this.locked || this.heldCase || this.selection?.kind !== 'case') return;
    const placed = this.placedCase(this.selection.id);
    if (!placed || this.options.canDrop?.() === false) return;
    const sku = skuById(placed.sku_id);
    const { gridX, gridY, orientation = { yaw: placed.rotation_yaw, flipped: placed.flipped } } = change(placed, sku);
    const { rejection } = this.validate(this.selection, sku, gridX, gridY, orientation);
    if (rejection) {
      this.emit({ type: 'blocked', sku, rejection });
      return;
    }
    this.commitMove(placed.id, sku, gridX, gridY, orientation);
  }

  private commitMove(id: number, sku: SkuDef, gridX: number, gridY: number, { yaw, flipped }: Orientation) {
    const snapshot = this.options.engine.move_placement(id, gridX, gridY, yaw, flipped, performance.now());
    this.selection = { kind: 'case', id };
    this.setSnapshot(snapshot);
    this.updateOutline();
    this.emit({ type: 'moved', sku, placed: snapshot.placed_cases.find(placed => placed.id === id)!, snapshot });
  }

  /** The engine's verdict on `source`'s case landing at a grid anchor. */
  private validate(source: PlacementTarget, sku: SkuDef, gridX: number, gridY: number, { yaw, flipped }: Orientation): Validation {
    try {
      return source.kind === 'case'
        ? this.options.engine.validate_move(source.id, gridX, gridY, yaw, flipped)
        : this.options.engine.validate_placement(sku.id, gridX, gridY, yaw, flipped);
    } catch (error) {
      if (!String(error).includes('off the pallet')) throw error;
      return OFF_PALLET;
    }
  }

  private placedCase(id: number) {
    return this.placed.find(({ placed }) => placed.id === id)?.placed;
  }

  /** The id of the case lifted off the pallet, if one is held. */
  private get lifted() {
    return this.liftedId(this.heldCase?.source);
  }

  private liftedId(source: PlacementTarget | undefined) {
    return source?.kind === 'case' ? source.id : undefined;
  }

  /** The case at the top of the pile resting on case `id`, following the first case on each top. */
  private topOfStack(id: number) {
    for (let top = this.placed.find(({ placed }) => placed.id === id)!; ;) {
      const above = this.placed.find(({ box }) => Math.abs(box.min.y - top.box.max.y) < EPSILON
        && box.min.x < top.box.max.x && top.box.min.x < box.max.x && box.min.z < top.box.max.z && top.box.min.z < box.max.z);
      if (!above) return top.placed.id;
      top = above;
    }
  }

  private updateOutline() {
    const target = this.selection;
    const lifted = target?.kind === 'case' && target.id === this.lifted;
    const box = target?.kind === 'bay' ? target.bay.bounds : lifted ? undefined
      : this.placed.find(({ placed }) => target?.kind === 'case' && placed.id === target.id)?.box;
    this.outline.visible = !!box;
    if (!box) return;
    box.getSize(this.outline.scale).addScalar(2 * OUTLINE_GAP_IN);
    box.getCenter(this.outline.position);
  }

  private setSnapshot(snapshot: EngineSnapshot) {
    this.placed = snapshot.placed_cases.map(placed => ({ placed, box: placedCaseBox(placed) }));
  }

  /** A fresh held carton for the current orientation; hidden until it has somewhere to hover. */
  private rebuildHeldCarton() {
    const held = this.heldCase!;
    const previous = this.heldCarton;
    const carton = orient(createBoxMesh(held.sku, { flipped: held.orientation.flipped }), held.orientation.yaw);
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
    const source = this.heldCase?.source;
    if (source?.kind === 'bay') this.bayCartons.get(source.bay)!.visible = this.options.renderBays !== false;
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

/** Whether a case aimed at `aim` would cover any of the deck. */
function onDeck(sku: SkuDef, orientation: Orientation, { gridX, gridY }: Aim) {
  const size = orientedSize(sku, orientation);
  const [x, y] = [gridX * CELL_IN, gridY * CELL_IN];
  return x < PALLET_LENGTH_IN && x + size.x > 0 && y < PALLET_WIDTH_IN && y + size.y > 0;
}

function sameTarget(a: PlacementTarget, b: PlacementTarget | undefined) {
  return a.kind === 'bay' ? b?.kind === 'bay' && b.bay === a.bay : b?.kind === 'case' && b.id === a.id;
}
