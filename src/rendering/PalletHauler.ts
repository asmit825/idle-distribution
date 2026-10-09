import {
  BackSide,
  type AnimationClip,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type HaulerRenderMode = 'model' | 'sprite' | 'procedural';

let haulerRenderMode: HaulerRenderMode = 'model';
let cachedGltfScene: Group | null = null;
let gltfLoadingPromise: Promise<Group | null> | null = null;
let cachedSpriteTexture: Texture | null = null;

const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) ? import.meta.env.BASE_URL : '/';
export const assetUrl = (path: string) => `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

/** Fork length, and where the fork heels sit relative to the hauler's origin (inches; forks point +X). */
const FORK_LENGTH = 42;
/** Origin x at which the forks sit fully under a pallet centered at the scene origin. */
const UNDER_PALLET_X = -22;
const START_X = -210;
/** Floor level (the pallet's underside), in hauler-local y when the hauler sits on the floor. */
const HAULER_Y = -1.4;
/** Fork thickness above the floor; the forks must rise this far before they touch the pallet's top deck. */
const FORK_TOP = 2.4;
const DECK_GAP_TOP = 1.75 + 2.4;
const FORK_RISE = 3 + DECK_GAP_TOP - FORK_TOP;

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const OUTLINE = new MeshBasicMaterial({ color: 0x14110f, side: BackSide });

/** Configure the active rendering mode for the pallet hauler rig. */
export function setHaulerRenderMode(mode: HaulerRenderMode): void {
  haulerRenderMode = mode;
}

/** Get the currently configured hauler rendering mode. */
export function getHaulerRenderMode(): HaulerRenderMode {
  return haulerRenderMode;
}

/** Preload the 3D GLB model asset for instant instantiation. */
export async function preloadHaulerModel(url = assetUrl('models/pallet_hauler.glb')): Promise<Group | null> {
  if (cachedGltfScene) return cachedGltfScene;
  if (gltfLoadingPromise) return gltfLoadingPromise;

  gltfLoadingPromise = new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' && typeof globalThis.fetch === 'undefined') {
        resolve(null);
        return;
      }
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          cachedGltfScene = gltf.scene;
          if (!cachedGltfScene.getObjectByName('forks')) {
            const forks = new Group();
            forks.name = 'forks';
            cachedGltfScene.add(forks);
          }
          resolve(cachedGltfScene);
        },
        undefined,
        (err) => {
          console.warn('PalletHauler: Failed to load GLB model from', url, err);
          resolve(null);
        }
      );
    } catch (e) {
      console.warn('PalletHauler: GLTFLoader error', e);
      resolve(null);
    }
  });

  return gltfLoadingPromise;
}

/** Austin's animation clips (skeleton-only GLBs from Meshy): idle and walk on foot, upper-body motion while riding. */
export interface HaulerClips { idle: AnimationClip; walk: AnimationClip; ride: AnimationClip }
export interface HaulerAssets { model: Group; clips: HaulerClips }

const CLIP_URLS: Record<keyof HaulerClips, string> = {
  idle: assetUrl('models/animations/clip-idle.glb'),
  walk: assetUrl('models/animations/clip-walk.glb'),
  ride: assetUrl('models/animations/clip-breathe-look.glb'),
};
let cachedAssets: HaulerAssets | null = null;
let assetsPromise: Promise<HaulerAssets | null> | null = null;

/** Loads the GLB rig and Austin's clips once; resolves null if any of them can't be loaded. */
export function loadHaulerAssets(): Promise<HaulerAssets | null> {
  if (cachedAssets) return Promise.resolve(cachedAssets);
  assetsPromise ??= (async () => {
    const model = await preloadHaulerModel();
    if (!model) return null;
    try {
      const loader = new GLTFLoader();
      const clip = async (url: string) => (await loader.loadAsync(url)).animations[0];
      const [idle, walk, ride] = await Promise.all([clip(CLIP_URLS.idle), clip(CLIP_URLS.walk), clip(CLIP_URLS.ride)]);
      if (!idle || !walk || !ride) return null;
      const clips: HaulerClips = { idle, walk, ride };
      cachedAssets = { model, clips };
      return cachedAssets;
    } catch (e) {
      console.warn('PalletHauler: could not load operator animation clips', e);
      return null;
    }
  })();
  return assetsPromise;
}

/** The loaded rig and clips, when the model render mode is active and everything has loaded. */
export function getHaulerAssets(): HaulerAssets | null {
  return haulerRenderMode === 'model' ? cachedAssets : null;
}

/**
 * The operator, after reference-docs/person/austin.md: a flat, thin-outlined sitcom-cartoon man with
 * medium-length dark brown hair brushed back, a full beard, a slate-blue T-shirt, black jeans and
 * boots. He stands on the platform facing +X (toward the tiller) with one hand on it.
 */
function createOperator(): Group {
  const person = new Group();
  person.name = 'operator';
  person.position.x = -9;
  const skin = 0xe9c3a6, hair = 0x3a2a21, beard = 0x2b2019, shirt = 0x6b7b8c, jeans = 0x1d1f22, boots = 0x15171a;
  const toon = (geometry: BufferGeometry, color: number, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1], outline = true) => {
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color, roughness: 1, metalness: 0 }));
    mesh.position.set(x, y, z);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    if (outline) {
      const shell = new Mesh(geometry, OUTLINE);
      shell.scale.setScalar(1.06);
      mesh.add(shell);
    }
    person.add(mesh);
    return mesh;
  };
  const limb = (from: Vector3, to: Vector3, radius: number, color: number) => {
    const length = from.distanceTo(to);
    const mesh = toon(new CylinderGeometry(radius, radius * 0.88, length, 10), color, 0, 0, 0);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    return mesh;
  };
  const sphere = new SphereGeometry(1, 16, 12);
  const box = new BoxGeometry(1, 1, 1);
  for (const z of [-3.6, 3.6]) {
    toon(new BoxGeometry(9, 4.5, 4.6), boots, -28, 7.4, z);
    limb(new Vector3(-30, 9.5, z), new Vector3(-30, 34, z * 0.9), 2.5, jeans);
  }
  toon(new BoxGeometry(8.6, 22, 15.5), shirt, -30, 44, 0);
  toon(new CylinderGeometry(3.2, 3.2, 3, 10), 0xe9c3a6, -29.5, 56.5, 0);
  const shoulderL = new Vector3(-30, 52.5, -8.4), shoulderR = new Vector3(-30, 52.5, 8.4);
  const sleeve = (from: Vector3, to: Vector3) => limb(from, from.clone().lerp(to, 0.4), 3, shirt);
  const handL = new Vector3(-29, 33, -9.6), handR = new Vector3(-6, 37.5, 4.5);
  const elbowR = new Vector3(-20, 42, 9.4);
  sleeve(shoulderL, handL); limb(shoulderL.clone().lerp(handL, 0.38), handL, 2.1, skin);
  toon(sphere, skin, handL.x, handL.y - 1, handL.z, [1.7, 3, 1.5]);
  limb(shoulderR, elbowR, 2.6, shirt); limb(elbowR, handR, 2.1, skin);
  toon(sphere, skin, handR.x, handR.y, handR.z, [2.2, 1.8, 2]);
  const head = new Group();
  head.position.set(-29.5, 63.5, 0);
  head.rotation.y = -0.12;
  person.add(head);
  const headPart = (geometry: BufferGeometry, color: number, x: number, y: number, z: number, scale: [number, number, number], outline = true) => {
    const before = person.children.length;
    const mesh = toon(geometry, color, x, y, z, scale, outline);
    person.remove(mesh); head.add(mesh);
    return before;
  };
  headPart(sphere, skin, 0, 0, 0, [5, 6.6, 4.6]);
  headPart(sphere, hair, -1.4, 2.4, 0, [5.3, 5.2, 5.1]);
  headPart(box, hair, -4, -3.6, 0, [2.8, 9, 8.6]);
  headPart(sphere, beard, 1.6, -3.4, 0, [4.2, 4.2, 4.4]);
  headPart(sphere, skin, 4.7, -0.1, 0, [1.3, 1.9, 1.1]);
  for (const z of [-1.9, 1.9]) {
    headPart(sphere, 0xffffff, 4.2, 1.7, z, [0.9, 1.5, 1.35], false);
    headPart(sphere, 0x111111, 4.9, 1.7, z + 0.2, [0.35, 0.6, 0.55], false);
    headPart(box, hair, 4.2, 3.7, z, [0.5, 0.55, 2.6], false);
  }
  return person;
}

/** Procedural fallback: A ride-on pallet hauler with operator built from primitives. */
export function createProceduralHauler(): Group {
  const hauler = new Group();
  hauler.name = 'pallet-hauler';
  const forks = new Group();
  forks.name = 'forks';
  hauler.add(forks);
  const part = (geometry: BoxGeometry | CylinderGeometry | SphereGeometry, color: number, x: number, y: number, z: number, roughness = 0.6, metalness = 0.1, into: Group = hauler) => {
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color, roughness, metalness }));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    into.add(mesh);
    return mesh;
  };
  const dark = 0x2b3036, cream = 0xcdbb98, steel = 0x59626b;
  for (const z of [-10, 10]) {
    part(new BoxGeometry(FORK_LENGTH, 2.4, 7), dark, FORK_LENGTH / 2, 0.2, z, 0.6, 0.1, forks);
    part(new BoxGeometry(5, 1, 7.2), 0xf08a24, FORK_LENGTH - 2.5, 1.5, z, 0.6, 0.1, forks);
    part(new CylinderGeometry(1.3, 1.3, 3, 14).rotateX(Math.PI / 2), 0x111417, FORK_LENGTH - 6, -0.1, z, 0.6, 0.1, forks);
  }
  part(new BoxGeometry(34, 22, 30), cream, -17, 11, 0);
  part(new BoxGeometry(10, 5, 30), 0x39424b, -39, 2.5, 0);
  part(new BoxGeometry(8, 16, 30), cream, -35, 8, 0);
  part(new BoxGeometry(3, 1, 20), 0xf08a24, -41, 5.2, 0);
  part(new CylinderGeometry(0.8, 0.8, 34, 8), steel, -44, 26, -13, 0.4, 0.7);
  part(new CylinderGeometry(0.8, 0.8, 34, 8), steel, -44, 26, 13, 0.4, 0.7);
  part(new BoxGeometry(1.5, 1.5, 28), steel, -44, 41, 0, 0.4, 0.7);
  part(new BoxGeometry(14, 14, 3), dark, -12, 28, -9);
  part(new BoxGeometry(12, 10, 14), dark, -12, 27, 0);
  part(new CylinderGeometry(1.2, 1.2, 14, 8).rotateZ(Math.PI / 5), steel, -15, 37, 0, 0.4, 0.7);
  hauler.add(createOperator());
  return hauler;
}

/** Pre-rendered isometric sprite billboard option (100% Picture 2 fidelity). */
export function createSpriteHauler(): Group {
  const hauler = new Group();
  hauler.name = 'pallet-hauler';

  const forks = new Group();
  forks.name = 'forks';
  hauler.add(forks);

  // Soft oval ground shadow
  const shadowGeo = new PlaneGeometry(68, 42);
  const shadowMat = new MeshBasicMaterial({
    color: 0x070c12,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const shadowMesh = new Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(-18, 0.2, 0);
  hauler.add(shadowMesh);

  if (!cachedSpriteTexture && typeof window !== 'undefined') {
    try {
      const loader = new TextureLoader();
      cachedSpriteTexture = loader.load(assetUrl('sprites/austin-hauler-sprite.png'));
    } catch {
      // ignore
    }
  }

  const spriteGeo = new PlaneGeometry(78, 78);
  const spriteMat = new MeshStandardMaterial({
    map: cachedSpriteTexture,
    transparent: true,
    roughness: 0.6,
    metalness: 0.1,
    alphaTest: 0.02,
  });
  const billboard = new Mesh(spriteGeo, spriteMat);
  billboard.position.set(-18, 28, 0);
  billboard.rotation.y = Math.PI / 4;
  billboard.castShadow = true;
  hauler.add(billboard);

  return hauler;
}

/**
 * An instance of the loaded GLB rig. SkeletonUtils keeps the operator's skinned mesh bound to its own
 * cloned skeleton (a plain clone would leave it on the cached one). Geometry, materials and textures stay
 * shared with the cached model, so instances must not dispose them. The GLB carries a display pallet on
 * its forks; the game hauls its own pallet rig, so that one is dropped.
 */
export function instantiateHaulerModel(source: Object3D): Group {
  const clone = cloneSkinned(source) as Group;
  clone.name = 'pallet-hauler';
  clone.userData.sharedResources = true;
  clone.getObjectByName('pallet-payload')?.removeFromParent();
  clone.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  if (!clone.getObjectByName('forks')) {
    const forks = new Group();
    forks.name = 'forks';
    clone.add(forks);
  }
  return clone;
}

/** A ride-on pallet hauler with its operator. Supports model, sprite, or procedural rendering. */
export function createHauler(mode: HaulerRenderMode = haulerRenderMode): Group {
  if (mode === 'model' && cachedGltfScene) {
    return instantiateHaulerModel(cachedGltfScene);
  }

  if (mode === 'sprite') {
    return createSpriteHauler();
  }

  return createProceduralHauler();
}

/**
 * A one-shot haul. `depart`: the empty hauler drives under the pallet, lifts it, and backs away with
 * it. `arrive`: the hauler delivers a pallet, lowers it, and backs away empty. The rig (pallet and
 * its cartons) moves with the forks while lifted. Returns a per-frame stepper that reports when done.
 */
export function startHaul(kind: 'depart' | 'arrive', rig: Object3D, parent: Object3D, onDone: () => void, mode?: HaulerRenderMode) {
  const hauler = createHauler(mode);
  parent.add(hauler);
  const durations = kind === 'depart' ? { drive: 2.1, lift: 0.7, away: 2.4 } : { drive: 2.1, lift: 0.7, away: 2.0 };
  const total = durations.drive + durations.lift + durations.away;
  let time = 0;
  let finished = false;
  /** Raises the forks by `rise` (0..1 of full travel) and the carried pallet with them once they touch. */
  const lifted = (rise: number) => {
    const height = rise * FORK_RISE;
    const forks = hauler.getObjectByName('forks');
    if (forks) forks.position.y = height;
    return Math.max(0, height - DECK_GAP_TOP + FORK_TOP);
  };
  const step = (dt: number) => {
    if (finished) return;
    time += dt;
    const { drive, lift, away } = durations;
    hauler.position.y = HAULER_Y;
    if (time < drive) {
      const x = START_X + (UNDER_PALLET_X - START_X) * ease(time / drive);
      hauler.position.x = x;
      const raised = kind === 'arrive' ? 1 : 0;
      rig.position.set(x - UNDER_PALLET_X, lifted(raised), 0);
      if (kind === 'depart') rig.position.set(0, 0, 0);
    } else if (time < drive + lift) {
      const t = ease((time - drive) / lift);
      hauler.position.x = UNDER_PALLET_X;
      rig.position.set(0, lifted(kind === 'depart' ? t : 1 - t), 0);
    } else if (time < total) {
      const t = ease(clamp01((time - drive - lift) / away));
      const x = UNDER_PALLET_X + (START_X - UNDER_PALLET_X) * t;
      hauler.position.x = x;
      if (kind === 'depart') rig.position.set(x - UNDER_PALLET_X, lifted(1), 0);
      else { lifted(0); rig.position.set(0, 0, 0); }
    } else {
      finished = true;
      parent.remove(hauler);
      if (!hauler.userData.sharedResources) hauler.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((m) => m?.dispose());
          } else {
            object.material?.dispose();
          }
        }
      });
      if (kind === 'arrive') rig.position.set(0, 0, 0);
      onDone();
    }
  };
  step(0);
  return step;
}

