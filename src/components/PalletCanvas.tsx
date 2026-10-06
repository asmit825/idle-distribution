import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, Clock, Color, DirectionalLight, GridHelper, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { useRoundAutoSave } from '../hooks/useRoundAutoSave';
import { DataPortabilityModal } from './settings/DataPortabilityModal';
import { PalletGalleryModal } from './gallery/PalletGalleryModal';
import { ResultModal } from './hud/ResultModal';
import { MobileHud, type WarehouseTheme } from './hud/MobileHud';
import { COMPACT_QUERY, useCompact } from './hud/useCompact';
import { DesktopDashboard } from './hud/DesktopDashboard';
import type { ActiveCase, RoundHud } from './hud/types';
import { PlacementController, type PlacementEvent } from '../controls/PlacementController';
import { PointerManager, type NudgeDirection } from '../controls/PointerManager';
import { BoxMesh } from '../rendering/BoxMesh';
import { ConveyorBelt, CONVEYOR_BOUNDS } from '../rendering/ConveyorBelt';
import { CameraController, type CameraPreset, type Insets } from '../rendering/CameraController';
import { disposeBoxMaterials } from '../rendering/materials';
import { createPallet } from '../scene/pallet';
import { orientedSize, placedCaseBox, toScene } from '../scene/coordinates';
import type { StagingBay } from '../scene/staging';
import { skuById } from '../types/catalog';
import type { ConveyorStatus, EngineSnapshot, PalletEngine, Rejection } from '../types/engine';

const PRESETS: { name: CameraPreset; label: string }[] = [
  { name: 'iso', label: 'Iso' }, { name: 'top', label: 'Top' }, { name: 'side', label: 'Side' }, { name: 'reset', label: 'Reset' },
];

const REJECTIONS: Record<Rejection, string> = {
  above_ceiling: 'it would rise above the 60″ ceiling',
  excess_overhang: 'it would overhang more than 2″',
  unsupported: 'over 30% of its base would be unsupported',
  heavy_on_light: 'heavy cases cannot rest on light or fragile ones',
};

/** The live controllers, for the overlay buttons. */
interface Interaction {
  placement: PlacementController;
  camera: CameraController;
  /** The floor layout the controllers have. */
  bays?: readonly StagingBay[];
}

export interface PalletCanvasProps {
  engine: PalletEngine;
  hud: RoundHud;
  /** A floor whose bays stay empty once placed (Mode 1); the sandbox's refilling bays otherwise. */
  bays?: readonly StagingBay[];
  /** Asked as a case leaves the floor; false refuses the pick. */
  pick?: (bay: StagingBay) => boolean;
  /** Asked before a held case lands in a valid spot; false returns it to the floor. */
  canDrop?: () => boolean;
  /** Ends floor interaction for good: any held case returns and nothing more can be picked. */
  locked?: boolean;
  onPlaced?: (snapshot: EngineSnapshot) => void;
  conveyor?: () => ConveyorStatus | undefined;
}

export function PalletCanvas({ engine, bays, pick, canDrop, locked = false, onPlaced, conveyor, hud }: PalletCanvasProps) {
  const compact = useCompact();
  const save = useRoundAutoSave(hud.result);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const storageControls = <div className="storage-controls"><button type="button" onClick={() => { setMenuOpen(false); setGalleryOpen(true); }}>Pallet gallery</button><button type="button" onClick={() => { setMenuOpen(false); setDataOpen(true); }}>Saved data</button></div>;
  const [theme, setTheme] = useState<WarehouseTheme>('industrial');
  const sceneStyle = useRef<{ scene: Scene; floor: MeshStandardMaterial }>();
  const host = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction>();
  const replayActions = useRef<({ elapsed_ms: number } & ({ type: 'pick'; source_id: number } | { type: 'place'; placement: EngineSnapshot['placed_cases'][number] } | { type: 'remove'; case_id: number }))[]>([]);
  /** The latest props, for the long-lived controllers. */
  const props = useRef({ bays, pick, canDrop, onPlaced, conveyor });
  props.current = { bays, pick, canDrop, onPlaced, conveyor };
  const moveConveyorPick = useCallback((id: number, position: Vector3) => interaction.current?.placement.moveBay(id, position), []);
  const heldConveyorCase = useCallback(() => interaction.current?.placement.held?.bay.id, []);
  const [error, setError] = useState(false);
  const [placedGroup, setPlacedGroup] = useState<Group>();
  const [conveyorGroup, setConveyorGroup] = useState<Group>();
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => engine.get_snapshot());
  const [active, setActive] = useState<ActiveCase>();
  const [available, setAvailable] = useState<readonly StagingBay[]>(bays ?? []);
  const syncInspector = useCallback(() => {
    const placement = interaction.current?.placement;
    if (!placement) return;
    const held = placement.held;
    const selected = placement.selected;
    const placed = selected?.kind === 'case' ? engine.get_snapshot().placed_cases.find(c => c.id === selected.id) : undefined;
    const sku = held?.bay.sku ?? (selected?.kind === 'bay' ? selected.bay.sku : placed ? skuById(placed.sku_id) : undefined);
    setActive(sku ? { sku, holding: !!held, removable: !!held || !!placed, orientation: held?.orientation ?? { yaw: placed?.rotation_yaw ?? (selected?.kind === 'bay' ? selected.bay.yaw : 0), flipped: placed?.flipped ?? false },
      grid: held?.aim ? [held.aim.gridX, held.aim.gridY] : undefined, verdict: held?.aim?.validation.status } : undefined);
    setAvailable(placement.bays);
  }, [engine]);
  const [message, setMessage] = useState(conveyor ? 'Drag the oldest carton from the pick spur onto the pallet.' : 'Drag a carton from the floor onto the pallet.');

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
    const equipment = new Group();
    scene.add(placed, interactive, equipment);
    setConveyorGroup(equipment);
    setPlacedGroup(placed);
    scene.add(new HemisphereLight(0xcce4ff, 0x6b5037, 2.5));
    const sun = new DirectionalLight(0xffe5bc, 3.5);
    sun.position.set(30, 70, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 180 });
    sun.shadow.normalBias = 0.08;
    scene.add(sun);
    const floor = new Mesh(new PlaneGeometry(10000, 10000), new MeshStandardMaterial({ color: 0x202d38, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    floor.receiveShadow = true;
    scene.add(floor);
    sceneStyle.current = { scene, floor: floor.material };
    const grid = new GridHelper(240, 24, 0x354857, 0x293946);
    grid.position.y = -2.39;
    scene.add(grid);

    const camera = new PerspectiveCamera(40, 1, 0.1, 2000);
    const cameraController = new CameraController(camera, renderer.domElement);
    const initial = engine.get_snapshot();
    setSnapshot(initial);
    cameraController.setStackHeight(initial.max_height_inches);
    const floorBays = props.current.bays;
    if (floorBays) cameraController.setFloor(floorBays, props.current.conveyor ? [CONVEYOR_BOUNDS] : []);
    const placement = new PlacementController({
      engine,
      camera,
      parent: interactive,
      viewport: () => ({ width: container.clientWidth, height: container.clientHeight }),
      bays: floorBays,
      refill: !floorBays,
      renderBays: !props.current.conveyor,
      pick: bay => props.current.pick?.(bay) ?? true,
      canDrop: () => props.current.canDrop?.() ?? true,
      onPreview: syncInspector,
      onEvent: event => {
        if (event.type === 'pick' || event.type === 'placed' || event.type === 'removed') {
          const state = engine.get_snapshot();
          const elapsed_ms = props.current.conveyor?.()?.elapsed_ms ?? (60_000 - (state.mode1?.time_remaining_ms ?? 60_000));
          replayActions.current.push(event.type === 'pick' ? { type: 'pick', source_id: event.bay.id, elapsed_ms }
            : event.type === 'placed' ? { type: 'place', placement: event.placed, elapsed_ms }
            : { type: 'remove', case_id: event.id, elapsed_ms });
        }
        setMessage(placementMessage(event, engine));
        syncInspector();
        if (event.type === 'select' && event.target?.kind === 'bay' && window.matchMedia(COMPACT_QUERY).matches) placement.pickSelected();
        if (event.type === 'placed' || event.type === 'removed') {
          setSnapshot(event.snapshot);
          cameraController.setStackHeight(event.snapshot.max_height_inches);
          props.current.onPlaced?.(event.snapshot);
        }
      },
    });
    const pointers = new PointerManager(container, placement);
    interaction.current = { placement, camera: cameraController, bays: floorBays };

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
        conveyorCartons: () => {
          const positions: Record<number, { x: number; y: number; z: number }> = {};
          equipment.traverse(object => {
            if (object.name.startsWith('conveyor-carton-')) {
              const id = Number(object.name.slice('conveyor-carton-'.length));
              const { x, y, z } = object.position;
              positions[id] = { x, y, z };
            }
          });
          return positions;
        },
        deckPoint: (x, y, elevation = 0) => toClient(toScene(x, y, elevation)),
        floorBounds: () => {
          const extent = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
          for (const { bounds: { min, max } } of placement.bays) {
            for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
              const { x, y } = toClient(new Vector3(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z));
              extent.left = Math.min(extent.left, x); extent.right = Math.max(extent.right, x);
              extent.top = Math.min(extent.top, y); extent.bottom = Math.max(extent.bottom, y);
            }
          }
          return extent;
        },
        bayCarton: (skuId, yaw) => {
          // The first matching carton whose top is not hidden behind a neighbor.
          const rect = container.getBoundingClientRect();
          for (const bay of placement.bays) {
            if (bay.sku.id !== skuId || (yaw !== undefined && bay.yaw !== yaw)) continue;
            const point = toClient(bay.bounds.getCenter(new Vector3()).setY(bay.bounds.max.y));
            const hit = placement.hitTest({ x: point.x - rect.left, y: point.y - rect.top });
            if (hit?.target.kind === 'bay' && hit.target.bay === bay) return point;
          }
          throw new Error(`no ${skuId} in reach on the floor`);
        },
      };
    }

    return () => {
      delete window.__palletTest;
      interaction.current = undefined;
      sceneStyle.current = undefined;
      observer.disconnect();
      window.removeEventListener('resize', resize);
      compact.removeEventListener('change', resize);
      renderer.setAnimationLoop(null);
      pointers.dispose();
      placement.dispose();
      cameraController.dispose();
      // Placed cartons belong to their BoxMesh components; their cached SKU materials are released
      // here and regenerated on the next mount.
      scene.remove(placed, interactive, equipment);
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

  useEffect(() => {
    const current = interaction.current;
    if (!bays || !current || current.bays === bays) return;
    current.bays = bays;
    current.placement.setBays(bays);
    syncInspector();
    if (!props.current.conveyor) current.camera.setFloor(bays);
  }, [bays, syncInspector]);

  useEffect(() => {
    if (locked) interaction.current?.placement.lock();
  }, [locked]);

  useEffect(() => {
    const style = sceneStyle.current;
    if (!style) return;
    const colors = { industrial: ['#131c26', '#202d38'], studio: ['#b8c4ce', '#8d9da8'], blueprint: ['#071e49', '#123666'] }[theme];
    style.scene.background = new Color(colors[0]); style.floor.color.set(colors[1]);
  }, [theme]);
  useEffect(() => { if (!compact || locked) setMenuOpen(false); }, [compact, locked]);
  const actions = { rotate: () => interaction.current?.placement.rotate(), flip: () => interaction.current?.placement.flip(),
    remove: () => {
      try { interaction.current?.placement.remove(); }
      catch (error) { setMessage(String(error).replace(/^Error: /, '')); }
    }, done: () => interaction.current?.placement.drop(),
    nudge: (direction: NudgeDirection) => interaction.current?.placement.nudge(direction) };
  const cameras = <nav className="camera-presets" aria-label="Camera views">{PRESETS.map(({ name, label }) =>
    <button key={name} type="button" onClick={() => interaction.current?.camera.preset(name)}>{label}</button>)}</nav>;

  return (
    <>
      <div ref={host} className="canvas-host">
        {error && <p role="alert" className="startup">WebGL is unavailable. Enable hardware acceleration or try another browser.</p>}
        {conveyorGroup && conveyor && <ConveyorBelt revision={hud.conveyor} parent={conveyorGroup} readStatus={conveyor} movePick={moveConveyorPick} heldCase={heldConveyorCase} />}
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
      {dataOpen && <DataPortabilityModal close={() => setDataOpen(false)} />}
      {galleryOpen && <PalletGalleryModal close={() => setGalleryOpen(false)} />}
      <DesktopDashboard storageControls={storageControls} round={hud} snapshot={snapshot} bays={available} active={active} compact={compact} message={message}
        actions={actions} cameras={cameras} mobileMenu={<button type="button" className="mobile-menu" aria-label="Open warehouse menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button>} />
      {hud.result && <ResultModal storageControls={storageControls} save={save} snapshot={hud.result} title={hud.resultTitle} restart={hud.restart} exportReplay={() => {
        const result = hud.result!;
        const seed = result.mode1?.seed ?? result.mode2!.seed;
        const blob = new Blob([JSON.stringify({ version: 1, mode: hud.mode, seed, actions: replayActions.current, result }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `pallet-mode${hud.mode}-${seed}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }} />}
      {compact && <MobileHud storageControls={storageControls} round={hud} snapshot={snapshot} bays={available} active={active} actions={actions} cameras={cameras}
        message={message} menuOpen={menuOpen} closeMenu={() => setMenuOpen(false)} theme={theme} setTheme={setTheme} />}
    </>
  );
}

function placementMessage(event: PlacementEvent, engine: PalletEngine) {
  switch (event.type) {
    case 'removed': return 'Case removed. Load quality updated.';
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
      conveyorCartons(): Record<number, { x: number; y: number; z: number }>;
      deckPoint(x: number, y: number, elevation?: number): { x: number; y: number };
      /** The client-space box around every floor carton. */
      floorBounds(): { left: number; top: number; right: number; bottom: number };
      /** The top of a visible floor carton of this SKU, optionally lying at `yaw`. */
      bayCarton(skuId: string, yaw?: number): { x: number; y: number };
    };
  }
}
