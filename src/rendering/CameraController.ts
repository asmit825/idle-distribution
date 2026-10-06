import { Box3, MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DECK_Y, FLOOR_Y, PALLET_LENGTH_IN, PALLET_WIDTH_IN } from '../scene/coordinates';
import { STAGING_BAYS, type StagingBay } from '../scene/staging';

/** HUD chrome covering the canvas, in CSS pixels. */
export interface Insets {
  top: number;
  bottom: number;
}

export interface FramingOptions {
  /** World points that must stay on screen. */
  points: readonly Vector3[];
  target: Vector3;
  /** Unit vector from the target toward the camera. */
  direction: Vector3;
  /** Canvas size in CSS pixels. */
  viewport: { width: number; height: number };
  insets?: Insets;
  /** Clearance from every edge of the clear band, in CSS pixels. */
  margin?: number;
}

const SEARCH_STEPS = 40;
const MAX_DISTANCE = 1e5;

/**
 * Phone-aware framing (SPEC-01 §6.4): shifts the projection with `setViewOffset` so `target`
 * sits in the middle of the band between the top and bottom HUD bars, then binary-searches the
 * closest distance along `direction` at which every point projects inside that band.
 * Leaves the camera there, looking at `target`, and returns the distance.
 */
export function frameCompactCamera(camera: PerspectiveCamera, options: FramingOptions) {
  const { points, target, direction, viewport: { width, height }, insets = { top: 0, bottom: 0 }, margin = 0 } = options;
  camera.aspect = width / height;
  const shift = (insets.bottom - insets.top) / 2;
  if (shift) camera.setViewOffset(width, height, 0, shift, width, height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();

  const limits = { left: margin, right: width - margin, top: insets.top + margin, bottom: height - insets.bottom - margin };
  const scratch = new Vector3();
  const place = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  const fits = (distance: number) => {
    place(distance);
    return points.every(point => {
      scratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
      if (-scratch.z <= camera.near) return false;
      scratch.applyMatrix4(camera.projectionMatrix);
      const x = (scratch.x + 1) / 2 * width;
      const y = (1 - scratch.y) / 2 * height;
      return x >= limits.left && x <= limits.right && y >= limits.top && y <= limits.bottom;
    });
  };

  let near = 0;
  let far = 1;
  while (!fits(far) && far < MAX_DISTANCE) [near, far] = [far, far * 2];
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const middle = (near + far) / 2;
    if (fits(middle)) far = middle;
    else near = middle;
  }
  place(far);
  return far;
}

export type CameraPreset = 'iso' | 'top' | 'side' | 'reset';

/** The orbit stays just above the floor. */
const MAX_POLAR_DEG = 88;
/** Polar angles from straight up, in degrees. The isometric view sits 35.264° above the horizon. */
const PRESETS = {
  iso: { polar: 90 - 35.264, azimuth: 45 },
  // Just off vertical, so the view keeps a defined "up": the pallet's far side.
  top: { polar: 0.01, azimuth: 0 },
  // From the +X end, between the staging rows, so no floor carton blocks the stack.
  side: { polar: MAX_POLAR_DEG, azimuth: 90 },
} as const;
const MARGIN_PX = 12;
/** Height tracking eases with this time constant, in seconds. */
const TRACKING_SECONDS = 0.3;

/**
 * Orbit inspection, quick presets, and height auto-tracking: the framed volume grows with the
 * stack, so the look-at point rises as cases build toward 60". Orbit, zoom, and pan are kept
 * across reframes; only `reset` discards them.
 */
export class CameraController {
  readonly controls: OrbitControls;
  private readonly camera: PerspectiveCamera;
  private viewport = { width: 1, height: 1 };
  private insets: Insets = { top: 0, bottom: 0 };
  private stackHeight = 0;
  private trackedHeight = 0;
  /** The last framing: where the camera looks and how far back it sits before the user zooms or pans. */
  private readonly fitTarget = new Vector3();
  private fitDistance = 0;
  /** Corners of the empty pallet and the floor cartons. */
  private stagedPoints = stagedPoints(STAGING_BAYS);

  constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = MathUtils.degToRad(MAX_POLAR_DEG);
  }

  setViewport(width: number, height: number, insets: Insets = { top: 0, bottom: 0 }) {
    this.viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    this.insets = insets;
    this.reframe(this.fitDistance ? undefined : direction(PRESETS.iso));
  }

  /** Frames a new floor layout, keeping the view angle, zoom, and pan. */
  setFloor(bays: readonly StagingBay[], equipment: readonly Box3[] = []) {
    this.stagedPoints = [...stagedPoints(bays), ...equipment.flatMap(corners)];
    if (this.fitDistance) this.reframe();
  }

  /** The current stack height above the deck, in inches. The camera eases toward it. */
  setStackHeight(inches: number) {
    this.stackHeight = inches;
  }

  /** Iso, top, and side change the view angle and keep zoom and pan; reset restores the initial framing. */
  preset(name: CameraPreset) {
    if (name === 'reset') this.reframe(direction(PRESETS.iso), true);
    else this.reframe(direction(PRESETS[name]));
  }

  /** Advances height tracking and orbit damping; call once per frame. */
  update(seconds: number) {
    const gap = this.stackHeight - this.trackedHeight;
    if (gap !== 0) {
      this.trackedHeight = Math.abs(gap) < 0.01
        ? this.stackHeight
        : this.trackedHeight + gap * (1 - Math.exp(-seconds / TRACKING_SECONDS));
      this.reframe();
    }
    this.controls.update();
  }

  dispose() {
    this.controls.dispose();
  }

  /**
   * Refits the pallet, staging bays, and current stack along `newDirection` (default: the
   * current view angle). Unless `reset`, the user's zoom ratio and pan offset carry over.
   */
  private reframe(newDirection?: Vector3, reset = false) {
    const { camera, controls } = this;
    const offset = camera.position.clone().sub(controls.target);
    const fresh = reset || this.fitDistance === 0;
    const zoom = fresh ? 1 : offset.length() / this.fitDistance;
    const pan = fresh ? new Vector3() : controls.target.clone().sub(this.fitTarget);
    const view = newDirection ?? offset.normalize();

    const points = this.framedPoints();
    // The look-at point starts at the center of the floor scene and climbs half as fast as the stack.
    const target = new Box3().setFromPoints(this.stagedPoints).getCenter(new Vector3());
    target.y += this.trackedHeight / 2;
    this.fitDistance = frameCompactCamera(camera, {
      points, target, direction: view, viewport: this.viewport, insets: this.insets, margin: MARGIN_PX,
    });
    this.fitTarget.copy(target);
    controls.target.copy(target).add(pan);
    camera.position.copy(controls.target).addScaledVector(view, this.fitDistance * zoom);
    controls.minDistance = this.fitDistance * 0.45;
    controls.maxDistance = this.fitDistance * 3;
    controls.update();
  }

  /** Corners of the pallet with the stack on it, and of every staging bay. */
  private framedPoints() {
    return [...this.stagedPoints, ...corners(palletVolume(this.trackedHeight))];
  }
}

function stagedPoints(bays: readonly StagingBay[]) {
  return [palletVolume(0), ...bays.map(bay => bay.bounds)].flatMap(corners);
}

/** The pallet and a stack of `stackHeight` inches on it. */
function palletVolume(stackHeight: number) {
  return new Box3(
    new Vector3(-PALLET_LENGTH_IN / 2, FLOOR_Y, -PALLET_WIDTH_IN / 2),
    new Vector3(PALLET_LENGTH_IN / 2, DECK_Y + stackHeight, PALLET_WIDTH_IN / 2),
  );
}

function direction({ polar, azimuth }: { polar: number; azimuth: number }) {
  return new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(polar), MathUtils.degToRad(azimuth));
}

function corners(box: Box3) {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(i => new Vector3(
    i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z,
  ));
}
