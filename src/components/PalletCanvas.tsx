import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, Color, DirectionalLight, GridHelper, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BoxMesh } from '../rendering/BoxMesh';
import { disposeBoxMaterials } from '../rendering/materials';
import { createPallet } from '../scene/pallet';
import { SKU_CATALOG } from '../types/catalog';

/** Pallet underside, where floor-staged cartons rest. */
const FLOOR_Y = -2.375;
const GAP = 3;

/** One carton of each SKU staged on the floor, widths along X: four behind the pallet, four in front. */
const STAGED = [SKU_CATALOG.slice(0, 4), SKU_CATALOG.slice(4)].flatMap((row, i) => {
  const side = i === 0 ? -1 : 1;
  let x = -(row.reduce((sum, sku) => sum + sku.width_in, 0) + (row.length - 1) * GAP) / 2;
  return row.map(sku => {
    const position = [x + sku.width_in / 2, FLOOR_Y, side * (20 + GAP + sku.length_in / 2)] as const;
    x += sku.width_in + GAP;
    return { sku, yaw: 90 as const, position };
  });
});

export function PalletCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [staging, setStaging] = useState<Group>();

  useEffect(() => {
    const container = host.current!;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ antialias: true }); }
    catch { setError(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Interactive 48 by 40 inch stringer pallet');
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color('#131c26');
    scene.add(createPallet());
    const cartons = new Group();
    scene.add(cartons);
    setStaging(cartons);
    scene.add(new HemisphereLight(0xcce4ff, 0x6b5037, 2.5));
    const sun = new DirectionalLight(0xffe5bc, 3.5);
    sun.position.set(30, 70, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 180 });
    sun.shadow.normalBias = 0.08;
    scene.add(sun);
    const floor = new Mesh(new PlaneGeometry(1000, 1000), new MeshStandardMaterial({ color: 0x202d38, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new GridHelper(240, 24, 0x354857, 0x293946);
    grid.position.y = -2.39;
    scene.add(grid);

    const camera = new PerspectiveCamera(40, 1, 0.1, 2000);
    camera.position.set(1, 1, 1).normalize();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    let previousFitDistance = 1;
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Fit the pallet's bounding sphere in either orientation and preserve zoom/orbit.
      const verticalFov = camera.fov * Math.PI / 180;
      const limitingFov = Math.min(verticalFov, 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect));
      const fitDistance = 46 / Math.sin(limitingFov / 2);
      const offset = new Vector3().subVectors(camera.position, controls.target);
      camera.position.copy(controls.target).add(offset.multiplyScalar(fitDistance / previousFitDistance));
      previousFitDistance = fitDistance;
      controls.minDistance = fitDistance * 0.45;
      controls.maxDistance = fitDistance * 3;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      controls.update();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener('resize', resize);
    resize();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      renderer.setAnimationLoop(null);
      controls.dispose();
      // Cartons belong to their BoxMesh components; their cached SKU materials are released here
      // and regenerated on the next mount.
      scene.remove(cartons);
      disposeBoxMaterials();
      // Shared pallet materials/geometries are disposed exactly once.
      const geometries = new Set<import('three').BufferGeometry>();
      const materials = new Set<import('three').Material>();
      scene.traverse(object => {
        if (object instanceof Mesh || object instanceof GridHelper) {
          geometries.add(object.geometry);
          for (const material of [object.material].flat()) materials.add(material);
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={host} className="canvas-host">
      {error && <p role="alert" className="startup">WebGL is unavailable. Enable hardware acceleration or try another browser.</p>}
      {staging && STAGED.map(({ sku, yaw, position }) => <BoxMesh key={sku.id} parent={staging} sku={sku} yaw={yaw} position={position} />)}
    </div>
  );
}
