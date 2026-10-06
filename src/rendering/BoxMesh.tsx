import { useEffect, useRef } from 'react';
import { BoxGeometry, Group, Mesh, MathUtils, Vector3, type MeshStandardMaterial, type Object3D } from 'three';
import type { SkuDef } from '../types/catalog';
import { cartonSize, getBoxMaterials } from './materials';

/** SPEC-01 §8.3 squash; the lateral bulge is capped a hairline inside the carton's grid footprint. */
const CRUSH_SCALE = { lateral: 1.03, vertical: 0.92 };
const HAIRLINE_IN = 1 / 64;
const CRUSH_SECONDS = 0.25;
/** Crushed shape: the top-center sinks by this fraction of height; base and top edges pinch in by this fraction. */
const SINK = 0.05;
const BOW = 0.025;
const SEGMENTS = 6;

export type Yaw = 0 | 90 | 180 | 270;

/**
 * A corrugated carton in inches, Y up. Length runs along X, width along Z.
 * The origin is the center of its base, which stays planted while it squashes.
 */
export class Carton extends Group {
  readonly sku: SkuDef;
  private readonly body: Mesh<BoxGeometry, MeshStandardMaterial[]>;
  private readonly crushedScale: Vector3;
  private target: 0 | 1;
  /** 0 intact … 1 fully crushed. */
  private progress: number;
  private lastFrame?: number;

  constructor(sku: SkuDef, { crushed = false } = {}) {
    super();
    this.sku = sku;
    const { x, y, z } = cartonSize(sku);
    const geometry = new BoxGeometry(x, y, z, SEGMENTS, SEGMENTS, SEGMENTS);
    geometry.translate(0, y / 2, 0);
    addCrushedShape(geometry);
    // A per-mesh array, so one carton's material slots can change without affecting its SKU siblings.
    this.body = new Mesh(geometry, [...getBoxMaterials(sku)]);
    this.body.castShadow = this.body.receiveShadow = true;
    // Advance the squash with the render loop; repeat calls within one frame get a ~0 delta.
    this.body.onBeforeRender = () => {
      const now = performance.now();
      if (this.lastFrame !== undefined) this.update((now - this.lastFrame) / 1000);
      this.lastFrame = now;
    };
    this.add(this.body);
    this.crushedScale = new Vector3(
      Math.min(CRUSH_SCALE.lateral, (sku.length_in - 2 * HAIRLINE_IN) / x),
      CRUSH_SCALE.vertical,
      Math.min(CRUSH_SCALE.lateral, (sku.width_in - 2 * HAIRLINE_IN) / z),
    );
    this.target = crushed ? 1 : 0;
    this.progress = this.target;
    this.applyProgress();
  }

  get crushed() { return this.target === 1; }

  /** Starts an eased transition toward the crushed or intact shape. */
  set crushed(crushed: boolean) {
    this.target = crushed ? 1 : 0;
    this.lastFrame = undefined;
  }

  /** Advances the squash transition by `seconds`. Called automatically before each render. */
  update(seconds: number) {
    if (this.progress === this.target) return;
    const step = seconds / CRUSH_SECONDS;
    this.progress = this.target > this.progress
      ? Math.min(this.target, this.progress + step)
      : Math.max(this.target, this.progress - step);
    this.applyProgress();
  }

  /** Frees this carton's geometry; the cached SKU materials are shared and stay alive. */
  dispose() {
    this.body.geometry.dispose();
  }

  private applyProgress() {
    const eased = MathUtils.smoothstep(this.progress, 0, 1);
    this.body.scale.lerpVectors(new Vector3(1, 1, 1), this.crushedScale, eased);
    this.body.morphTargetInfluences![0] = eased;
  }
}

/** Adds a morph target with a sunken top and sides that bow out between pinched base and top edges. */
function addCrushedShape(geometry: BoxGeometry) {
  const { width, height, depth } = geometry.parameters;
  const crushed = geometry.clone();
  const position = crushed.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const t = y / height;
    // Full width at mid-height, so the bulge never exceeds the scaled footprint.
    const pinch = 1 - BOW * (1 - Math.sin(Math.PI * t));
    // Zero along the side faces (|u| or |w| = 1) and the base (t = 0); deepest at the top center.
    const [u, w] = [2 * x / width, 2 * z / depth];
    const sink = SINK * height * (1 - u * u) * (1 - w * w) * t;
    position.setXYZ(i, x * pinch, y - sink, z * pinch);
  }
  crushed.computeVertexNormals();
  geometry.morphAttributes.position = [position];
  geometry.morphAttributes.normal = [crushed.attributes.normal];
}

export function createBoxMesh(sku: SkuDef, options?: { crushed?: boolean }) {
  return new Carton(sku, options);
}

export interface BoxMeshProps {
  /** Scene node the carton is attached to while mounted. */
  parent: Object3D;
  sku: SkuDef;
  crushed?: boolean;
  /** Base-center position in scene inches. */
  position?: readonly [number, number, number];
  yaw?: Yaw;
}

/** Mounts a carton into an imperative Three.js scene for the component's lifetime. */
export function BoxMesh({ parent, sku, crushed = false, position = [0, 0, 0], yaw = 0 }: BoxMeshProps) {
  const carton = useRef<Carton>();
  const latestCrushed = useRef(crushed);
  const [x, y, z] = position;

  useEffect(() => {
    const created = createBoxMesh(sku, { crushed: latestCrushed.current });
    carton.current = created;
    parent.add(created);
    return () => {
      parent.remove(created);
      created.dispose();
      carton.current = undefined;
    };
  }, [parent, sku]);

  useEffect(() => {
    latestCrushed.current = crushed;
    if (carton.current) carton.current.crushed = crushed;
  }, [crushed]);

  useEffect(() => {
    carton.current?.position.set(x, y, z);
    carton.current?.rotation.set(0, MathUtils.degToRad(yaw), 0);
  }, [parent, sku, x, y, z, yaw]);

  return null;
}
