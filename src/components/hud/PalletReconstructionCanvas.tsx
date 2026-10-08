import { useEffect, useRef, useState } from 'react';
import {
  BoxGeometry, BufferGeometry, DirectionalLight, EdgesGeometry, Group, HemisphereLight, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Material,
} from 'three';
import { createPallet } from '../../scene/pallet';
import { DECK_Y, placedCaseBox, toScene } from '../../scene/coordinates';
import { createBoxMesh } from '../../rendering/BoxMesh';
import { skuById } from '../../types/catalog';
import type { EngineSnapshot } from '../../types/engine';

const HAZARD = '#ef4444', PASS = '#22c55e';
/** Camera pitch above the deck, radians; close to the mockup's isometric angle. */
const PITCH = 0.5;
const FOV = 32;
/** Drag radians per pixel, and the per-frame easing toward the dragged angle. */
const DRAG = 0.01, DAMPING = 0.08;
const KEY_STEP = Math.PI / 12;
/** The COG reticle floats this far above the top of the stack, in inches. */
const RETICLE_LIFT = 6;

/**
 * The shipped pallet, rebuilt from the engine's placed cases. Drag sideways (or use the arrow keys)
 * to turn it; crushed cartons wear a red hazard shell and the COG plumb line shows where the load sits.
 */
export function PalletReconstructionCanvas({ snapshot: s }: { snapshot: EngineSnapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const reticle = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const drift = s.drift_penalty > 0;
  const crushed = s.placed_cases.filter(placed => placed.crushed).length;

  useEffect(() => {
    const container = host.current!;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setError(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `3D reconstruction of the shipped pallet: ${s.cases_placed} cartons, ${crushed} crushed. Drag or use the arrow keys to rotate.`);
    // Sideways drags turn the pallet; vertical swipes still scroll the dialog on touch screens.
    canvas.style.touchAction = 'pan-y';
    container.prepend(canvas);

    const scene = new Scene();
    const pallet = createPallet();
    const light = new DirectionalLight(0xffe5bc, 3);
    light.position.set(40, 80, 30);
    scene.add(pallet, new HemisphereLight(0xcce4ff, 0x6b5037, 3), light);

    const hazardFill = new MeshBasicMaterial({ color: HAZARD, transparent: true, opacity: 0.38, depthWrite: false });
    const hazardLine = new LineBasicMaterial({ color: HAZARD });
    const overlays = new Group();
    let top = DECK_Y;
    const cartons = s.placed_cases.map(placed => {
      const box = placedCaseBox(placed);
      const carton = createBoxMesh(skuById(placed.sku_id), { crushed: placed.crushed, flipped: placed.flipped });
      carton.position.copy(box.getCenter(new Vector3()).setY(box.min.y));
      carton.rotation.y = placed.rotation_yaw * Math.PI / 180;
      top = Math.max(top, box.max.y);
      scene.add(carton);
      if (placed.crushed) overlays.add(...hazardShell(box.getSize(new Vector3()).addScalar(0.4), box.getCenter(new Vector3()), hazardFill, hazardLine));
      return carton;
    });
    scene.add(overlays);

    // A plumb line from the deck up through the center of gravity to the reticle.
    const [cogX, cogY] = s.cog_inches;
    const cogTop = toScene(cogX, cogY, top - DECK_Y + RETICLE_LIFT);
    const plumb = new LineSegments(
      new BufferGeometry().setFromPoints([toScene(cogX, cogY, 0), cogTop]),
      new LineBasicMaterial({ color: drift ? HAZARD : PASS, depthTest: false, transparent: true, opacity: 0.85 }),
    );
    plumb.renderOrder = 1;
    plumb.visible = s.cases_placed > 0;
    scene.add(plumb);

    const camera = new PerspectiveCamera(FOV, 1, 0.1, 1000);
    const target = new Vector3(0, (top + RETICLE_LIFT) / 2, 0);
    // Bounding sphere of the deck footprint (with overhang slack) and the stack.
    const radius = Math.hypot(26, 22, (top + RETICLE_LIFT) / 2 + 2);
    let distance = 120;
    let angle = 0.65, targetAngle = 0.65, frame = 0;
    const projected = new Vector3();

    const render = () => {
      camera.position.set(Math.sin(angle) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(angle) * Math.cos(PITCH))
        .multiplyScalar(distance).add(target);
      camera.lookAt(target);
      renderer.render(scene, camera);
      const marker = reticle.current;
      if (marker) {
        projected.copy(cogTop).project(camera);
        marker.style.transform = `translate(${(projected.x + 1) / 2 * container.clientWidth}px, ${(1 - projected.y) / 2 * container.clientHeight}px)`;
      }
    };
    // Ease toward the dragged angle, then stop drawing until the next input.
    const animate = () => {
      angle += (targetAngle - angle) * DAMPING;
      if (Math.abs(targetAngle - angle) < 1e-4) { angle = targetAngle; frame = 0; }
      else frame = requestAnimationFrame(animate);
      render();
    };
    const turn = (delta: number) => {
      targetAngle += delta;
      if (!frame) frame = requestAnimationFrame(animate);
    };

    const resize = () => {
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const vertical = FOV * Math.PI / 180;
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      distance = radius / Math.sin(Math.min(vertical, horizontal) / 2);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let dragging: number | undefined, lastX = 0;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragging = event.pointerId; lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== dragging) return;
      turn((event.clientX - lastX) * DRAG);
      lastX = event.clientX;
    };
    const up = (event: PointerEvent) => { if (event.pointerId === dragging) dragging = undefined; };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      turn(event.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('keydown', key);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('keydown', key);
      cartons.forEach(carton => carton.dispose());
      // Carton materials are shared with the live viewport, which owns their lifetime.
      const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
      for (const root of [pallet, overlays, plumb]) root.traverse(object => {
        if (object instanceof Mesh || object instanceof LineSegments) {
          geometries.add(object.geometry);
          for (const material of [object.material].flat()) materials.add(material);
        }
      });
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, [s, crushed, drift]);

  return <div className="f3-viewport-canvas" ref={host}>
    {error
      ? <p role="alert" className="f3-viewport-error">3D view unavailable on this device.</p>
      : s.cases_placed > 0 && <div ref={reticle} className={`f3-cog-reticle ${drift ? 'text-hazard' : 'text-pass'}`} aria-hidden="true">
        <span className="f3-cog-mark" />
        <span className="f3-cog-label">{drift ? `COG drift (${s.cog_drift_inches.toFixed(1)}″)` : 'COG balanced'}</span>
      </div>}
  </div>;
}

/** A translucent red box around a crushed carton, its edges outlined and an X across each side. */
function hazardShell(size: Vector3, center: Vector3, fill: MeshBasicMaterial, line: LineBasicMaterial) {
  const geometry = new BoxGeometry(size.x, size.y, size.z);
  const shell = new Mesh(geometry, fill);
  const edges = new LineSegments(new EdgesGeometry(geometry), line);
  const [x, y, z] = [size.x / 2, size.y / 2, size.z / 2];
  const corners = (sx: number, sz: number, alongX: boolean) => alongX
    ? [new Vector3(-x, -y, sz * z), new Vector3(x, y, sz * z), new Vector3(-x, y, sz * z), new Vector3(x, -y, sz * z)]
    : [new Vector3(sx * x, -y, -z), new Vector3(sx * x, y, z), new Vector3(sx * x, y, -z), new Vector3(sx * x, -y, z)];
  const crosses = new LineSegments(new BufferGeometry().setFromPoints([
    ...corners(0, 1, true), ...corners(0, -1, true), ...corners(1, 0, false), ...corners(-1, 0, false),
  ]), line);
  for (const part of [shell, edges, crosses]) part.position.copy(center);
  return [shell, edges, crosses];
}
