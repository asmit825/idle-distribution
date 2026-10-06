import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, Clock, Color, DirectionalLight, GridHelper, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { FlipVertical2, RotateCw } from 'lucide-react';
import { PlacementController, type PlacementEvent } from '../controls/PlacementController';
import { PointerManager } from '../controls/PointerManager';
import { BoxMesh } from '../rendering/BoxMesh';
import { CameraController, type CameraPreset, type Insets } from '../rendering/CameraController';
import { disposeBoxMaterials } from '../rendering/materials';
import { createPallet } from '../scene/pallet';
import { orientedSize, placedCaseBox, toScene } from '../scene/coordinates';
import { STAGING_BAYS } from '../scene/staging';
import { skuById } from '../types/catalog';
import type { EngineSnapshot, PalletEngine, Rejection } from '../types/engine';

/** SPEC-01 §7.3: phone layouts, where HUD chrome overlays the canvas. */
export const COMPACT_QUERY = '(max-width:900px),(max-height:540px),(pointer:coarse)';

const PRESETS: { name: CameraPreset; label: string }[] = [
  { name: 'iso', label: 'Iso' }, { name: 'top', label: 'Top' }, { name: 'side', label: 'Side' }, { name: 'reset', label: 'Reset' },
];

const REJECTIONS: Record<Rejection, string> = {
  above_ceiling: 'it would rise above the 60″ ceiling',
  excess_overhang: 'it would overhang more than 2″',
  unsupported: 'over 30% of its base would be unsupported',
};

/** The live controllers, for the overlay buttons. */
interface Interaction {
  placement: PlacementController;
  camera: CameraController;
}

export function PalletCanvas({ engine }: { engine: PalletEngine }) {
  const host = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction>();
  const [error, setError] = useState(false);
  const [placedGroup, setPlacedGroup] = useState<Group>();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => engine.get_snapshot());
  const [holding, setHolding] = useState(false);
  const [message, setMessage] = useState('Drag a carton from the floor onto the pallet.');

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
    const placed = new Group();
    const interactive = new Group();
    scene.add(placed, interactive);
    setPlacedGroup(placed);
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
    const cameraController = new CameraController(camera, renderer.domElement);
    const initial = engine.get_snapshot();
    setSnapshot(initial);
    cameraController.setStackHeight(initial.max_height_inches);
    const placement = new PlacementController({
      engine,
      camera,
      parent: interactive,
      viewport: () => ({ width: container.clientWidth, height: container.clientHeight }),
      onEvent: event => {
        setMessage(placementMessage(event, engine));
        if (event.type === 'pick') setHolding(true);
        if (event.type === 'placed' || event.type === 'returned') setHolding(false);
        if (event.type === 'placed') {
          setSnapshot(event.snapshot);
          cameraController.setStackHeight(event.snapshot.max_height_inches);
        }
      },
    });
    const pointers = new PointerManager(container, placement);
    interaction.current = { placement, camera: cameraController };

    const compact = window.matchMedia(COMPACT_QUERY);
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      cameraController.setViewport(width, height, compact.matches ? chromeInsets(container) : undefined);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    for (const chrome of chromeElements(container)) observer.observe(chrome);
    window.addEventListener('resize', resize);
    compact.addEventListener('change', resize);
    resize();
    const clock = new Clock();
    renderer.setAnimationLoop(() => {
      cameraController.update(clock.getDelta());
      renderer.render(scene, camera);
    });

    if (import.meta.env.DEV) {
      // Lets browser tests find on-screen positions of domain points and floor cartons.
      const toClient = (point: Vector3) => {
        const ndc = point.project(camera);
        const rect = container.getBoundingClientRect();
        return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
      };
      window.__palletTest = {
        deckPoint: (x, y, elevation = 0) => toClient(toScene(x, y, elevation)),
        bayCarton: skuId => {
          const { bounds } = STAGING_BAYS.find(bay => bay.sku.id === skuId)!;
          return toClient(bounds.getCenter(new Vector3()).setY(bounds.max.y));
        },
      };
    }

    return () => {
      delete window.__palletTest;
      interaction.current = undefined;
      observer.disconnect();
      window.removeEventListener('resize', resize);
      compact.removeEventListener('change', resize);
      renderer.setAnimationLoop(null);
      pointers.dispose();
      placement.dispose();
      cameraController.dispose();
      // Placed cartons belong to their BoxMesh components; their cached SKU materials are released
      // here and regenerated on the next mount.
      scene.remove(placed, interactive);
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
  }, [engine]);

  return (
    <>
      <div ref={host} className="canvas-host">
        {error && <p role="alert" className="startup">WebGL is unavailable. Enable hardware acceleration or try another browser.</p>}
        {placedGroup && snapshot.placed_cases.map(placed => {
          const box = placedCaseBox(placed);
          const base = box.getCenter(new Vector3()).setY(box.min.y);
          return (
            <BoxMesh
              key={placed.id} parent={placedGroup} sku={skuById(placed.sku_id)} crushed={placed.crushed}
              flipped={placed.flipped} yaw={placed.rotation_yaw} position={[base.x, base.y, base.z]}
            />
          );
        })}
      </div>
      <nav className="camera-presets" aria-label="Camera views" data-chrome>
        {PRESETS.map(({ name, label }) => (
          <button key={name} type="button" onClick={() => interaction.current?.camera.preset(name)}>{label}</button>
        ))}
      </nav>
      <div className="case-actions" data-chrome>
        <button type="button" disabled={!holding} onClick={() => interaction.current?.placement.rotate()}><RotateCw size={16} />Rotate <kbd>R</kbd></button>
        <button type="button" disabled={!holding} onClick={() => interaction.current?.placement.flip()}><FlipVertical2 size={16} />Flip <kbd>F</kbd></button>
        <p className="placement-status" aria-live="polite">{message}</p>
      </div>
    </>
  );
}

function placementMessage(event: PlacementEvent, engine: PalletEngine) {
  switch (event.type) {
    case 'pick':
      return `Holding ${event.sku.name}.`;
    case 'placed': {
      const { placed, sku, snapshot } = event;
      const size = orientedSize(sku, { yaw: placed.rotation_yaw, flipped: placed.flipped });
      const count = `${snapshot.cases_placed} ${snapshot.cases_placed === 1 ? 'case' : 'cases'} on the pallet`;
      return `Placed ${sku.name}, ${size.x}″ × ${size.y}″, at ${placed.elevation_z}″. ${count}.`;
    }
    case 'returned':
      return `${event.sku.name} went back to its bay${event.rejection ? `: ${REJECTIONS[event.rejection]}` : ''}.`;
    case 'select': {
      const target = event.target;
      if (!target) return 'Selection cleared.';
      if (target.kind === 'bay') return `Selected ${target.bay.sku.name}.`;
      const placed = engine.get_snapshot().placed_cases.find(({ id }) => id === target.id)!;
      return `Selected ${skuById(placed.sku_id).name} on the pallet.`;
    }
  }
}

/** HUD overlays marked `data-chrome` beside the canvas host. */
function chromeElements(container: HTMLElement) {
  return [...container.parentElement?.querySelectorAll<HTMLElement>('[data-chrome]') ?? []];
}

/**
 * How far the marked overlays reach into the canvas from its top and bottom edges. Each overlay
 * counts toward the edge it sits nearer, wherever the current layout puts it.
 */
function chromeInsets(container: HTMLElement): Insets {
  const canvas = container.getBoundingClientRect();
  const middle = (canvas.top + canvas.bottom) / 2;
  const insets = { top: 0, bottom: 0 };
  for (const chrome of chromeElements(container)) {
    const rect = chrome.getBoundingClientRect();
    if (rect.height === 0) continue;
    if ((rect.top + rect.bottom) / 2 < middle) insets.top = Math.max(insets.top, rect.bottom - canvas.top);
    else insets.bottom = Math.max(insets.bottom, canvas.bottom - rect.top);
  }
  return insets;
}

declare global {
  interface Window {
    /** Development-only hooks for browser tests: client coordinates of scene features. */
    __palletTest?: {
      deckPoint(x: number, y: number, elevation?: number): { x: number; y: number };
      bayCarton(skuId: string): { x: number; y: number };
    };
  }
}
