import { useEffect, useRef } from 'react';
import {
  CircleGeometry, DirectionalLight, Group, HemisphereLight, Mesh, PCFSoftShadowMap,
  PerspectiveCamera, Scene, ShadowMaterial, Vector2, Vector3, WebGLRenderer,
  type BufferGeometry, type Material,
} from 'three';
import { createBoxMesh } from '../../rendering/BoxMesh';
import { DECK_Y, FLOOR_Y } from '../../scene/coordinates';
import { createPallet } from '../../scene/pallet';
import { skuById, type SkuId } from '../../types/catalog';

const DISPLAY_CASES: readonly { sku: SkuId; position: readonly [number, number, number] }[] = [
  { sku: 'SKU-HF', position: [-12, DECK_Y, -10] },
  { sku: 'SKU-HF', position: [12, DECK_Y, -10] },
  { sku: 'SKU-MS', position: [-12, DECK_Y, 6] },
  { sku: 'SKU-MQ', position: [8, DECK_Y, 6] },
  { sku: 'SKU-LT', position: [-12, DECK_Y + 8, -10] },
];

/** Decorative preview, independent of the gameplay engine and its render loop. */
export function AmbientPallet({ seed = 0n }: { seed?: bigint }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      // The portal remains usable when WebGL is unavailable.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const display = new Group();
    display.rotation.y = -0.25 + Number(seed % 100n) / 500;
    const pallet = createPallet();
    display.add(pallet);
    const cartons = DISPLAY_CASES.map(({ sku, position }) => {
      const carton = createBoxMesh(skuById(sku));
      carton.position.set(...position);
      display.add(carton);
      return carton;
    });
    scene.add(display, new HemisphereLight(0xc8dfff, 0x6f4b2f, 2.2));

    const keyLight = new DirectionalLight(0xffddad, 3.3);
    keyLight.position.set(28, 90, 45);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    Object.assign(keyLight.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x8babd5, 1.2);
    fillLight.position.set(-50, 25, -30);
    scene.add(fillLight);

    const floor = new Mesh(new CircleGeometry(65, 48), new ShadowMaterial({ opacity: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y - 0.025;
    floor.receiveShadow = true;
    scene.add(floor);

    const camera = new PerspectiveCamera(34, 1, 0.1, 500);
    const target = new Vector3(0, 9, 0);
    const baseCamera = new Vector3();
    const cameraOffset = new Vector2();
    const pointer = new Vector2();
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame: number | undefined;
    let lastTime: number | undefined;

    const positionCamera = () => {
      camera.position.copy(baseCamera);
      camera.position.x += cameraOffset.x * 4;
      camera.position.y -= cameraOffset.y * 3;
      camera.lookAt(target);
    };
    const render = () => {
      if (!document.hidden) renderer.render(scene, camera);
    };
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Keep the complete pallet in frame when the portal becomes a narrow column.
      const distance = Math.max(1, 0.75 / camera.aspect);
      baseCamera.set(75, 67, 90).multiplyScalar(distance).add(target);
      positionCamera();
      render();
    };
    const animate = (time: number) => {
      frame = undefined;
      if (document.hidden || motionPreference.matches) return;
      const seconds = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      display.rotation.y += seconds * 0.12;
      cameraOffset.lerp(pointer, 1 - Math.exp(-seconds * 3));
      positionCamera();
      render();
      frame = window.requestAnimationFrame(animate);
    };
    const updateMotion = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      lastTime = undefined;
      if (motionPreference.matches) {
        pointer.set(0, 0);
        cameraOffset.set(0, 0);
        positionCamera();
      }
      render();
      if (!document.hidden && !motionPreference.matches) frame = window.requestAnimationFrame(animate);
    };
    const movePointer = (event: PointerEvent) => {
      if (motionPreference.matches || event.pointerType !== 'mouse') return;
      pointer.set(
        Math.max(-1, Math.min(1, event.clientX / Math.max(1, window.innerWidth) * 2 - 1)),
        Math.max(-1, Math.min(1, event.clientY / Math.max(1, window.innerHeight) * 2 - 1)),
      );
    };
    const resetPointer = () => pointer.set(0, 0);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener('pointermove', movePointer, { passive: true });
    window.addEventListener('blur', resetPointer);
    document.addEventListener('visibilitychange', updateMotion);
    motionPreference.addEventListener('change', updateMotion);
    resize();
    updateMotion();

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('blur', resetPointer);
      document.removeEventListener('visibilitychange', updateMotion);
      motionPreference.removeEventListener('change', updateMotion);
      cartons.forEach(carton => carton.dispose());
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      pallet.traverse(object => {
        if (object instanceof Mesh) {
          geometries.add(object.geometry);
          for (const material of [object.material].flat()) materials.add(material);
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      keyLight.shadow.map?.dispose();
      // Catalog carton materials and textures are cached and shared with gameplay.
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [seed]);

  return <div ref={host} className="landing-ambient" aria-hidden="true" />;
}
