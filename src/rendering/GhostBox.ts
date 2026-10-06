import {
  Box3, BoxGeometry, Color, DataTexture, EdgesGeometry, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, PlaneGeometry,
} from 'three';
import type { PlacementStatus } from '../types/engine';

/** SPEC-01 §7.1 accent palette. */
export const GHOST_COLORS: Record<PlacementStatus, string> = {
  valid: 'hsl(145, 75%, 45%)',
  warning: 'hsl(45, 95%, 50%)',
  invalid: 'hsl(0, 85%, 55%)',
};

const FILL_OPACITY = 0.3;
const SHADOW_SPREAD_IN = 1.5;
const SHADOW_TEXELS = 64;

/**
 * The translucent landing volume for a held case (SPEC-01 §6.3), with a soft contact shadow
 * on the surface it would land on. Driven imperatively on every pointer move.
 */
export class GhostBox extends Group {
  status: PlacementStatus = 'valid';
  readonly color = new Color();
  private readonly fill: Mesh<BoxGeometry, MeshBasicMaterial>;
  private readonly edges: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private readonly shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly box = new Box3();

  constructor() {
    super();
    // Unit cube with its base at the origin, scaled to each case.
    const cube = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.fill = new Mesh(cube, new MeshBasicMaterial({ transparent: true, opacity: FILL_OPACITY, depthWrite: false }));
    this.edges = new LineSegments(new EdgesGeometry(cube), new LineBasicMaterial());
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: 0x000000, alphaMap: contactShadowTexture(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    );
    // Drawn after the cartons, so the translucent fill never hides what is behind it.
    this.fill.renderOrder = this.edges.renderOrder = this.shadow.renderOrder = 1;
    this.add(this.shadow, this.fill, this.edges);
    this.visible = false;
  }

  /** The landing volume in scene inches, while shown. */
  get bounds(): Readonly<Box3> {
    return this.box;
  }

  /** Shows the ghost filling `box`, colored by `status`. */
  show(box: Box3, status: PlacementStatus) {
    this.box.copy(box);
    const size = box.getSize(this.position);
    this.fill.scale.copy(size);
    this.edges.scale.copy(size);
    this.shadow.scale.set(size.x + 2 * SHADOW_SPREAD_IN, 1, size.z + 2 * SHADOW_SPREAD_IN);
    box.getCenter(this.position).setY(box.min.y);
    if (status !== this.status || !this.visible) {
      this.status = status;
      this.color.setStyle(GHOST_COLORS[status]);
      this.fill.material.color.copy(this.color);
      this.edges.material.color.copy(this.color);
    }
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  dispose() {
    for (const part of [this.fill, this.edges, this.shadow]) {
      part.geometry.dispose();
      part.material.dispose();
    }
    this.shadow.material.alphaMap!.dispose();
  }
}

/** A soft-edged rectangle: opaque in the middle, fading out over the spread margin. */
function contactShadowTexture() {
  const data = new Uint8Array(SHADOW_TEXELS * SHADOW_TEXELS * 4);
  for (let row = 0; row < SHADOW_TEXELS; row++) {
    for (let column = 0; column < SHADOW_TEXELS; column++) {
      const edge = Math.min(row, column, SHADOW_TEXELS - 1 - row, SHADOW_TEXELS - 1 - column) / (SHADOW_TEXELS * 0.2);
      const alpha = Math.min(1, edge) ** 2 * 0.55;
      data.fill(Math.round(alpha * 255), (row * SHADOW_TEXELS + column) * 4, (row * SHADOW_TEXELS + column) * 4 + 4);
    }
  }
  const texture = new DataTexture(data, SHADOW_TEXELS, SHADOW_TEXELS);
  texture.needsUpdate = true;
  return texture;
}
