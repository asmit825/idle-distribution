import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Box3, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { STAGING_BAYS } from '../scene/staging';
import { CameraController, frameCompactCamera } from './CameraController';

const corners = (box: Box3) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => new Vector3(
  i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z,
));
const PALLET = new Box3(new Vector3(-24, -2.375, -20), new Vector3(24, 2.375, 20));
const SCENE_POINTS = [PALLET, ...STAGING_BAYS.map(bay => bay.bounds)].flatMap(corners);

/** CSS pixel position of a world point. */
function pixel(camera: PerspectiveCamera, point: Vector3, { width, height }: { width: number; height: number }) {
  const ndc = point.clone().project(camera);
  return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height };
}

describe('frameCompactCamera', () => {
  const iso = new Vector3(1, 1, 1).normalize();

  for (const [orientation, viewport, insets] of [
    ['portrait phone', { width: 390, height: 844 }, { top: 120, bottom: 220 }],
    ['landscape phone', { width: 844, height: 390 }, { top: 56, bottom: 96 }],
    ['desktop', { width: 1280, height: 800 }, { top: 0, bottom: 0 }],
  ] as const) {
    it(`fits the pallet and staging bays snugly between the HUD bars (${orientation})`, () => {
      const camera = new PerspectiveCamera(40, viewport.width / viewport.height, 0.1, 2000);
      const target = new Vector3(0, 2, 0);
      frameCompactCamera(camera, { points: SCENE_POINTS, target, direction: iso, viewport, insets, margin: 12 });
      const pixels = SCENE_POINTS.map(point => pixel(camera, point, viewport));
      const left = Math.min(...pixels.map(p => p.x));
      const right = Math.max(...pixels.map(p => p.x));
      const top = Math.min(...pixels.map(p => p.y));
      const bottom = Math.max(...pixels.map(p => p.y));
      expect(left).toBeGreaterThanOrEqual(12 - 0.01);
      expect(right).toBeLessThanOrEqual(viewport.width - 12 + 0.01);
      expect(top).toBeGreaterThanOrEqual(insets.top + 12 - 0.01);
      expect(bottom).toBeLessThanOrEqual(viewport.height - insets.bottom - 12 + 0.01);
      // Snug: the tightest edge touches its limit.
      const slack = Math.min(left - 12, viewport.width - 12 - right, top - insets.top - 12, viewport.height - insets.bottom - 12 - bottom);
      expect(slack).toBeLessThan(1);
      // The look-at point sits in the middle of the clear band.
      expect(pixel(camera, target, viewport).y).toBeCloseTo(insets.top + (viewport.height - insets.top - insets.bottom) / 2, 3);
      expect(camera.position.clone().sub(target).normalize().toArray()).toEqual(iso.toArray().map(n => expect.closeTo(n, 9)));
    });
  }
});

describe('CameraController', () => {
  const viewport = { width: 1280, height: 800 };
  let camera: PerspectiveCamera;
  let controller: CameraController;

  beforeEach(() => {
    camera = new PerspectiveCamera(40, viewport.width / viewport.height, 0.1, 2000);
    // OrbitControls listens on its element and the element's root node.
    const element = Object.assign(new EventTarget(), { style: {}, getRootNode: () => new EventTarget() });
    controller = new CameraController(camera, element as unknown as HTMLElement);
    controller.setViewport(viewport.width, viewport.height);
  });
  afterEach(() => controller.dispose());

  const offset = () => camera.position.clone().sub(controller.controls.target);
  const elevation = () => MathUtils.radToDeg(Math.asin(offset().normalize().y));
  const azimuth = () => MathUtils.radToDeg(Math.atan2(offset().x, offset().z));

  it('starts isometric: 35.264° up, 45° around, with everything in frame', () => {
    expect(elevation()).toBeCloseTo(35.264, 2);
    expect(azimuth()).toBeCloseTo(45, 6);
    for (const point of SCENE_POINTS) {
      const { x, y } = pixel(camera, point, viewport);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(viewport.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(viewport.height);
    }
  });

  it('snaps to top-down and side presets, keeping zoom; reset restores the initial framing', () => {
    const initial = { position: camera.position.clone(), target: controller.controls.target.clone() };
    camera.position.sub(controller.controls.target).multiplyScalar(1.5).add(controller.controls.target); // zoom out
    controller.preset('top');
    expect(elevation()).toBeGreaterThan(89.9);
    controller.preset('side');
    expect(elevation()).toBeCloseTo(2, 6); // a profile view, at the orbit's floor limit
    expect(azimuth()).toBeCloseTo(90, 6); // from +X, between the staging rows, so nothing blocks the stack
    controller.preset('iso');
    expect(elevation()).toBeCloseTo(35.264, 2);
    const zoomedOut = offset().length();
    controller.preset('reset');
    expect(offset().length()).toBeLessThan(zoomedOut / 1.4);
    expect(camera.position.distanceTo(initial.position)).toBeLessThan(1e-6);
    expect(controller.controls.target.distanceTo(initial.target)).toBeLessThan(1e-6);
  });

  it('raises the look-at point smoothly as the stack builds toward 60"', () => {
    const start = controller.controls.target.y;
    controller.setStackHeight(60);
    controller.update(1 / 60);
    const firstFrame = controller.controls.target.y;
    expect(firstFrame).toBeGreaterThan(start);
    expect(firstFrame).toBeLessThan(start + 5);
    for (let frame = 0; frame < 300; frame++) controller.update(1 / 60);
    // The framed volume now runs from the floor to 60" above the deck: its center rose by about 25".
    expect(controller.controls.target.y - start).toBeGreaterThan(20);
    const top = pixel(camera, new Vector3(-24, 62.375, -20), viewport);
    expect(top.y).toBeGreaterThan(0);
  });
});
