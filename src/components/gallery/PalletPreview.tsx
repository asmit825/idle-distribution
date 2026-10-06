import { useEffect, useRef, useState } from 'react';
import { Color, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type BufferGeometry, type Material } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createPallet } from '../../scene/pallet';
import { caseBox } from '../../scene/coordinates';
import { createBoxMesh } from '../../rendering/BoxMesh';
import { skuById } from '../../types/catalog';
import type { PlacedCaseSnapshot } from '../../storage/types';

export function PalletPreview({ cases }: { cases: PlacedCaseSnapshot[] }) {
  const host = useRef<HTMLDivElement>(null);
  const orbit = useRef<(angle: number) => void>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const container = host.current!;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ antialias: true }); }
    catch { setError(true); return; }
    setError(false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', `Saved pallet: ${cases.length} cases`);
    container.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color('#111d2b');
    const pallet = createPallet();
    scene.add(pallet, new HemisphereLight(0xcce4ff, 0x6b5037, 3));
    const light = new DirectionalLight(0xffe5bc, 3);
    light.position.set(40, 80, 30); scene.add(light);
    let height = 0;
    const cartons = cases.map(placed => {
      const sku = skuById(placed.sku_id);
      const box = caseBox(sku, { yaw: placed.rotation_yaw, flipped: placed.flipped }, placed.grid_x, placed.grid_y, placed.elevation_z);
      const carton = createBoxMesh(sku, { crushed: placed.crushed, flipped: placed.flipped });
      carton.position.copy(box.getCenter(new Vector3()).setY(box.min.y));
      carton.rotation.y = placed.rotation_yaw * Math.PI / 180;
      height = Math.max(height, box.max.y); scene.add(carton);
      return carton;
    });
    const camera = new PerspectiveCamera(40, 1, 0.1, 1000);
    const target = new Vector3(0, height / 2, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target); controls.minDistance = 35; controls.maxDistance = 350;
    const render = () => renderer.render(scene, camera);
    let first = true;
    const resize = () => {
      const width = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
      renderer.setSize(width, h); camera.aspect = width / h; camera.updateProjectionMatrix();
      if (first) {
        const distance = Math.max(110, (height + 65) / Math.min(1, camera.aspect));
        camera.position.copy(target).add(new Vector3(1, 0.9, 1).normalize().multiplyScalar(distance));
        controls.update(); first = false;
      }
      render();
    };
    controls.addEventListener('change', render);
    orbit.current = angle => {
      camera.position.sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), angle).add(controls.target);
      controls.update();
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    return () => {
      orbit.current = undefined; observer.disconnect(); controls.dispose();
      cartons.forEach(carton => carton.dispose());
      const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
      pallet.traverse(object => {
        if (object instanceof Mesh) { geometries.add(object.geometry); for (const material of [object.material].flat()) materials.add(material); }
      });
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
      // Carton materials are shared with the live viewport, which owns their lifetime.
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [cases]);
  return <div>
    <div className="gallery-canvas" ref={host}>{error && <p role="alert">3D preview unavailable. Saved coordinates are listed below.</p>}</div>
    <div className="gallery-orbit"><span>Drag to orbit · scroll or pinch to zoom</span>
      <button type="button" onClick={() => orbit.current?.(-Math.PI / 6)}>Orbit left</button>
      <button type="button" onClick={() => orbit.current?.(Math.PI / 6)}>Orbit right</button></div>
  </div>;
}
