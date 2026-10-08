import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight,
  Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace,
  ShadowMaterial, Vector3, type Camera, type Scene, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLOOR_Y } from '../scene/coordinates';

/**
 * The warehouse around the play area (the "Warehouse Floor" theme): a concrete floor with safety tape,
 * pallet racking down the left with the haul aisle running through it, a dock wall with roll-up doors
 * behind the pallet, high-bay lights, and fog that fades it all into the dark.
 *
 * Laid out for the iso camera, which looks from the +X/+Z corner: the backdrop sits on the -X and -Z
 * sides, clear of the pallet, the floor staging, the conveyor and the hauler's parking spot and lane.
 * Everything is code-built and static, so it is baked for speed (software renderers, which the browser
 * tests use, are slow per vertex and per pixel): the boxes of each material are merged into one mesh, a
 * dozen draw calls in all, without the faces nobody can see. The scene's lights never move and every
 * surface is flat, so each face's diffuse light is worked out once, the way Three's Lambert shading would,
 * and stored with its tint as vertex colours on unlit materials. Nothing casts or takes shadows, and the
 * light pools under the lamps are painted into the floor texture.
 */

export type WarehouseDetail = 'high' | 'low';

export type PieceKind =
  | 'upright' | 'brace' | 'beam' | 'protector' | 'pallet' | 'load' | 'wrapped'
  | 'tape' | 'door' | 'opening' | 'track' | 'leveler' | 'hazard' | 'signal' | 'housing' | 'lens';

/** One box in the layout: centre, size in its own frame, optional rotation and tint. */
export interface Piece { kind: PieceKind; position: Vector3; size: Vector3; quaternion?: Quaternion; tint?: number }

/** Floor-mesh height: the floor plane sits just below the floor cartons' base. */
const FLOOR = FLOOR_Y - 0.025;

/** Selective pallet racking, inches. Beam tops at each level; the floor is the first shelf. */
const BAY = 100;
const DEPTH = 42;
const UPRIGHT = 3;
const LEVELS = [62, 124, 186];
const RACK_HEIGHT = 222;
const BEAM_H = 5;
const BRACE_RISE = 36;
/** Back-to-back rows share a 6" flue. */
const ROW_PITCH = DEPTH + 6;
/** Centreline of the rack row facing the play area, and the haul aisle's half-width through the racks. */
export const RACK_LINE = -205;
export const AISLE_HALF = 46;
/** The dock wall behind the pallet, and the building's other walls. */
export const DOCK_Z = -262;
const WALL_EXTENT = 640;
const CEILING = 340;
const DOORS = [{ x: -60, open: false }, { x: 70, open: true }, { x: 200, open: false }];
const DOOR_W = 100;
const DOOR_H = 110;
/** High-bay lamps hang over the middle of each 20-foot floor slab; one row sits over the dock lanes. */
const SLAB = 240;
const LAMP_ORIGIN = { x: 0, z: -140 };

const CARTON_TINTS = [0xd9b48a, 0xc79a66, 0xb98d5c, 0xe6dfd2, 0xd0a874, 0xbfa07a];

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RackRun {
  /** The world axis the row runs along. */
  axis: 'x' | 'z';
  /** Centreline on the other axis. */
  line: number;
  /** First upright, and which way the row extends from it. */
  start: number;
  dir: 1 | -1;
  bays: number;
  /** Which side of the centreline faces an aisle (gets upright protectors). */
  face: 1 | -1;
}

export interface WarehouseOptions {
  detail?: WarehouseDetail;
  /** Mark out the hauler's parking spot and lane (only where pallets are hauled away). */
  yard?: boolean;
}

/** The warehouse as boxes; deterministic, and free of the DOM so it can be tested. */
export function warehouseLayout({ detail = 'high', yard = false }: WarehouseOptions = {}): Piece[] {
  const pieces: Piece[] = [];
  const random = mulberry32(7);
  const add = (kind: PieceKind, position: Vector3, size: Vector3, extra: Partial<Piece> = {}) => pieces.push({ kind, position, size, ...extra });

  // A cartoned or stretch-wrapped load on a pallet whose base is at `y`; `room` caps its height.
  const load = (at: (y: number) => Vector3, y: number, room: number, wrappedShare: number, size: (u: number, v: number, h: number) => Vector3) => {
    add('pallet', at(y + 2.75), size(40, 48, 5.5));
    const height = Math.min(room, 30 + random() * 20);
    const wrapped = random() < wrappedShare;
    add(wrapped ? 'wrapped' : 'load', at(y + 5.5 + height / 2), size(wrapped ? 39 : 38, wrapped ? 45 : 44, height),
      { tint: CARTON_TINTS[Math.floor(random() * CARTON_TINTS.length)] });
  };

  const rackRun = (run: RackRun) => {
    const at = (u: number, v: number, y: number) => run.axis === 'z' ? new Vector3(run.line + v, y, u) : new Vector3(u, y, run.line + v);
    const size = (su: number, sv: number, sy: number) => run.axis === 'z' ? new Vector3(sv, sy, su) : new Vector3(su, sy, sv);
    const u = (b: number) => run.start + run.dir * b * BAY;
    for (let b = 0; b <= run.bays; b++) {
      for (const v of [-DEPTH / 2, DEPTH / 2]) add('upright', at(u(b), v, FLOOR + RACK_HEIGHT / 2), size(UPRIGHT, UPRIGHT, RACK_HEIGHT));
      // Zig-zag frame bracing between the front and back uprights.
      for (let k = 0; (k + 1) * BRACE_RISE + 10 < RACK_HEIGHT; k++) {
        const dv = (k % 2 ? -1 : 1) * DEPTH;
        const length = Math.hypot(DEPTH, BRACE_RISE);
        const angle = run.axis === 'z' ? Math.atan2(-dv, BRACE_RISE) : Math.atan2(dv, BRACE_RISE);
        const quaternion = new Quaternion().setFromAxisAngle(run.axis === 'z' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0), angle);
        add('brace', at(u(b), 0, FLOOR + 10 + (k + 0.5) * BRACE_RISE), new Vector3(1.2, length, 1.2), { quaternion });
      }
      add('protector', at(u(b), run.face * (DEPTH / 2 + 1), FLOOR + 9), size(7, 6, 18));
    }
    // End-of-row guard on the aisle end.
    add('protector', at(run.start - run.dir * 5, 0, FLOOR + 8), size(5, DEPTH + 8, 16));
    for (let b = 0; b < run.bays; b++) {
      const middle = run.start + run.dir * (b + 0.5) * BAY;
      for (const level of LEVELS) for (const v of [-DEPTH / 2, DEPTH / 2]) {
        add('beam', at(middle, v, FLOOR + level - BEAM_H / 2), size(BAY - UPRIGHT, 2.5, BEAM_H));
      }
      [0, ...LEVELS].forEach((level, i) => {
        const next = LEVELS[i] ?? RACK_HEIGHT + 30;
        for (const offset of [-23, 23]) {
          if (random() < 0.14) continue; // an empty slot here and there
          load(y => at(middle + offset, 0, y), FLOOR + level, next - level - BEAM_H - 10, 0.3, size);
        }
      });
    }
  };

  // Racking down the left, split by the haul aisle: the row facing the play area and, in full detail,
  // the row backing onto it. (Rows further back would be hidden behind these from every camera.)
  const rows = detail === 'high' ? [[RACK_LINE, 1], [RACK_LINE - ROW_PITCH, -1]] as const : [[RACK_LINE, 1]] as const;
  for (const [line, face] of rows) {
    rackRun({ axis: 'z', line, start: AISLE_HALF, dir: 1, bays: 5, face });
    rackRun({ axis: 'z', line, start: -AISLE_HALF, dir: -1, bays: 2, face });
  }

  // Dock doors in the wall behind the pallet: one open onto a dark trailer, the others shut.
  for (const { x, open } of DOORS) {
    const wall = DOCK_Z;
    if (open) {
      add('opening', new Vector3(x, FLOOR + DOOR_H / 2, wall + 0.4), new Vector3(DOOR_W, DOOR_H, 0.5));
      add('door', new Vector3(x, FLOOR + DOOR_H - 8, wall + 1.6), new Vector3(DOOR_W, 16, 3));
    } else {
      add('door', new Vector3(x, FLOOR + DOOR_H / 2, wall + 1), new Vector3(DOOR_W, DOOR_H, 2));
    }
    for (const side of [-1, 1]) add('track', new Vector3(x + side * (DOOR_W / 2 + 2), FLOOR + DOOR_H / 2 + 6, wall + 3), new Vector3(4, DOOR_H + 12, 5));
    add('track', new Vector3(x, FLOOR + DOOR_H + 13, wall + 7), new Vector3(DOOR_W + 12, 14, 14));
    add('leveler', new Vector3(x, FLOOR + 0.12, wall + 36), new Vector3(DOOR_W - 16, 0.25, 72));
    for (const side of [-1, 1]) add('hazard', new Vector3(x + side * (DOOR_W / 2 - 6), FLOOR + 0.16, wall + 36), new Vector3(4, 0.25, 72));
    add('signal', new Vector3(x + DOOR_W / 2 + 12, FLOOR + 72, wall + 1.5), new Vector3(6, 6, 2), { tint: open ? 0x37d65a : 0xff4434 });
  }
  // Outbound pallets staged in front of the open door and the next one.
  for (const [x, z] of [[46, -178], [94, -178], [70, -126], [200, -178]]) {
    load(y => new Vector3(x, y, z), FLOOR, 52, 0.75, (u, v, h) => new Vector3(u, h, v));
  }

  // Safety tape.
  const tapeX = (x0: number, x1: number, z: number, w = 3) => add('tape', new Vector3((x0 + x1) / 2, FLOOR + 0.06, z), new Vector3(Math.abs(x1 - x0), 0.1, w));
  const tapeZ = (z0: number, z1: number, x: number, w = 3) => add('tape', new Vector3(x, FLOOR + 0.06, (z0 + z1) / 2), new Vector3(w, 0.1, Math.abs(z1 - z0)));
  const box = (x0: number, z0: number, x1: number, z1: number) => { tapeX(x0, x1, z0); tapeX(x0, x1, z1); tapeZ(z0, z1, x0); tapeZ(z0, z1, x1); };
  if (yard) {
    // The haul lane out through the rack aisle, and the hauler's parking spot.
    for (const z of [-34, 34]) tapeX(-WALL_EXTENT, -70, z);
    box(-80, -90, 42, -42);
  }
  // Rack-face keep-clear lines either side of the aisle.
  const face = RACK_LINE + DEPTH / 2 + 12;
  tapeZ(AISLE_HALF, AISLE_HALF + 5 * BAY, face);
  tapeZ(-AISLE_HALF, -AISLE_HALF - 2 * BAY, face);
  // Corner marks round the pallet's build spot.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tapeX(sx * 32, sx * 20, sz * 28);
    tapeZ(sz * 28, sz * 16, sx * 32);
  }
  // A staging lane in front of each dock door.
  for (const { x } of DOORS) box(x - 54, DOCK_Z + 74, x + 54, -112);

  // High-bay lights (the floor texture carries their light pools).
  const lampRows = detail === 'high' ? 4 : 3;
  for (let i = -2; i <= 2; i++) for (let j = 0; j < lampRows; j++) {
    const x = LAMP_ORIGIN.x + i * SLAB, z = LAMP_ORIGIN.z + j * SLAB;
    add('housing', new Vector3(x, FLOOR + CEILING - 40, z), new Vector3(16, 5, 48));
    add('lens', new Vector3(x, FLOOR + CEILING - 42.7, z), new Vector3(14, 0.5, 46));
  }
  return pieces;
}

// ------------------------------------------------------------------ textures (canvas-drawn)

function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false, anisotropy = 1): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  if (repeat) texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** One 20-foot slab of sealed concrete: mottled, lit from the lamp above its middle, with saw-cut joints along two edges. */
function concreteTexture() {
  const random = mulberry32(3);
  return canvasTexture(512, 512, g => {
    g.fillStyle = '#62676d';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1800; i++) {
      const v = 80 + random() * 45 | 0;
      g.fillStyle = `rgba(${v},${v + 3},${v + 6},${random() * 0.16})`;
      g.beginPath();
      g.arc(random() * 512, random() * 512, 3 + random() * 26, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 14; i++) { // faint tyre marks, mostly along the slab
      g.strokeStyle = `rgba(30,32,36,${0.03 + random() * 0.03})`;
      g.lineWidth = 3 + random() * 4;
      const y = random() * 512, bend = (random() - 0.5) * 60;
      g.beginPath();
      g.moveTo(-10, y);
      g.quadraticCurveTo(256, y + bend, 522, y + bend * 0.3);
      g.stroke();
    }
    const pool = g.createRadialGradient(256, 256, 0, 256, 256, 250);
    pool.addColorStop(0, 'rgba(255,236,205,0.16)');
    pool.addColorStop(0.5, 'rgba(255,236,205,0.06)');
    pool.addColorStop(1, 'rgba(255,236,205,0)');
    g.fillStyle = pool;
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(30,32,36,0.55)';
    g.fillRect(0, 0, 512, 2);
    g.fillRect(0, 0, 2, 512);
  }, true, 4);
}

/** A face of stacked cartons: a 3 × 2 grid with tape seams and labels, drawn light so tints show. */
function cartonTexture(wrapped: boolean) {
  return canvasTexture(256, 256, g => {
    g.fillStyle = '#efe3cf';
    g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const x = col * 256 / 3, y = row * 128;
      g.strokeStyle = 'rgba(90,64,36,0.55)';
      g.lineWidth = 3;
      g.strokeRect(x + 1.5, y + 1.5, 256 / 3 - 3, 125);
      g.fillStyle = 'rgba(140,110,70,0.35)';
      g.fillRect(x + 256 / 6 - 4, y, 8, 128);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(x + 12, y + 74, 30, 20);
    }
    if (wrapped) {
      g.fillStyle = 'rgba(232,240,246,0.55)';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.25 + (i % 3) * 0.12})`;
        g.lineWidth = 4 + (i % 4) * 3;
        g.beginPath();
        g.moveTo(-40, i * 22);
        g.lineTo(296, i * 22 + 30);
        g.stroke();
      }
    }
  });
}

function slatTexture() {
  return canvasTexture(64, 256, g => {
    g.fillStyle = '#c3cad0';
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 14) {
      g.fillStyle = 'rgba(60,66,72,0.45)';
      g.fillRect(0, y, 64, 2);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(0, y + 2, 64, 2);
    }
  });
}

function hazardTexture() {
  const texture = canvasTexture(64, 64, g => {
    g.fillStyle = '#f2b51d';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1b1d20';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 80, 64); g.lineTo(i * 32 + 64, 64);
      g.fill();
    }
  }, true);
  texture.repeat.set(1, 6);
  return texture;
}

/**
 * Corrugated wall cladding, one inch per pixel up the wall: vertical ribs, with a dark kick-plate band
 * and a yellow stripe painted along the bottom.
 */
function claddingTexture() {
  return canvasTexture(64, CEILING, g => {
    const ribs = g.createLinearGradient(0, 0, 64, 0);
    ribs.addColorStop(0, '#454d55'); ribs.addColorStop(0.2, '#566069'); ribs.addColorStop(0.45, '#3e464e');
    ribs.addColorStop(0.7, '#4b545c'); ribs.addColorStop(1, '#454d55');
    g.fillStyle = ribs;
    g.fillRect(0, 0, 64, CEILING);
    g.fillStyle = '#2f353b';
    g.fillRect(0, CEILING - 40, 64, 40);
    g.fillStyle = '#f0c02a';
    g.fillRect(0, CEILING - 43, 64, 3);
  }, true);
}

interface Sign { text: string; width: number; position: Vector3; yaw: number; background: string; color: string }

/** All the signs on one texture, a 256 × 72 row each. */
function signAtlas(signs: readonly Sign[]) {
  return canvasTexture(256, 72 * signs.length, g => {
    signs.forEach(({ text, background, color }, i) => {
      g.save();
      g.translate(0, i * 72);
      g.fillStyle = background;
      g.fillRect(0, 0, 256, 72);
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.strokeRect(5, 5, 246, 62);
      g.fillStyle = color;
      g.font = 'bold 40px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 38);
      g.restore();
    });
  });
}

// ------------------------------------------------------------------ baked lighting

/** Diffuse light reaching a surface facing a given normal, already divided by π (Three's BRDF_Lambert). */
type Lighting = (normal: Vector3) => Color;

/** The scene's hemisphere and directional lights, as Three's Lambert shading sums them for a flat face. */
function sceneLighting(scene: Scene): Lighting {
  const hemispheres: HemisphereLight[] = [];
  const suns: DirectionalLight[] = [];
  scene.traverse(object => {
    if (object instanceof HemisphereLight) hemispheres.push(object);
    if (object instanceof DirectionalLight) suns.push(object);
  });
  scene.updateMatrixWorld(true);
  const toward = (light: HemisphereLight | DirectionalLight) => {
    const from = light.getWorldPosition(new Vector3());
    return light instanceof DirectionalLight ? from.sub(light.target.getWorldPosition(new Vector3())).normalize() : from.normalize();
  };
  return normal => {
    const light = new Color(0, 0, 0);
    for (const hemisphere of hemispheres) {
      const sky = hemisphere.color.clone().multiplyScalar(hemisphere.intensity);
      const ground = hemisphere.groundColor.clone().multiplyScalar(hemisphere.intensity);
      light.add(ground.lerp(sky, 0.5 * normal.dot(toward(hemisphere)) + 0.5));
    }
    for (const sun of suns) light.add(sun.color.clone().multiplyScalar(sun.intensity * Math.max(0, normal.dot(toward(sun)))));
    if (!hemispheres.length && !suns.length) light.setRGB(Math.PI, Math.PI, Math.PI);
    return light.multiplyScalar(1 / Math.PI);
  };
}

/** Box faces as (normal, across, up): corners at normal/2 ± across/2 ± up/2, wound counter-clockwise from outside. */
const FACES: [Vector3, Vector3, Vector3][] = [
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
  [new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
  [new Vector3(0, 0, -1), new Vector3(-1, 0, 0), new Vector3(0, 1, 0)],
  [new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1)],
  // No bottoms: the camera never goes below the floor.
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * One static geometry for a set of boxes, with each face coloured by its tint times `lighting` (or the
 * tint alone). Flat pieces (tape, plates) keep only their top.
 */
function mergeBoxes(pieces: readonly Piece[], tintOf: (piece: Piece) => number | undefined, lighting?: Lighting) {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], index: number[] = [];
  const corner = new Vector3(), normal = new Vector3(), tint = new Color();
  for (const piece of pieces) {
    const rotation = piece.quaternion ?? new Quaternion();
    const tintHex = tintOf(piece);
    if (tintHex === undefined) tint.setRGB(1, 1, 1);
    else tint.setHex(tintHex);
    const faces = piece.size.y < 0.5 ? FACES.slice(4) : FACES;
    for (const [n, across, up] of faces) {
      normal.copy(n).applyQuaternion(rotation);
      const color = lighting ? lighting(normal).multiply(tint) : tint;
      const first = positions.length / 3;
      for (const [a, b] of CORNERS) {
        corner.copy(n).multiplyScalar(0.5).addScaledVector(across, a - 0.5).addScaledVector(up, b - 0.5)
          .multiply(piece.size).applyQuaternion(rotation).add(piece.position);
        positions.push(corner.x, corner.y, corner.z);
        uvs.push(a, b);
        colors.push(color.r, color.g, color.b);
      }
      index.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Store each vertex's light (from its normal) as its colour. */
function bake<T extends BufferGeometry>(geometry: T, lighting: Lighting): T {
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const normal = new Vector3();
  for (let i = 0; i < normals.count; i++) lighting(normal.fromBufferAttribute(normals, i)).toArray(colors, i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

// ------------------------------------------------------------------ the scene object

/** Fog starts this far beyond the camera's look-at point and is complete this far beyond it. */
const FOG_START = 160;
const FOG_END = 1250;
export const WAREHOUSE_BACKGROUND = '#1a1f25';
/** Side of the shadow-catching floor patch centred on the pallet; covers the sun's shadow camera. */
const SHADOW_PATCH = 150;

/**
 * How each kind is drawn. Plain-coloured kinds share one instanced mesh (lit or unlit) with a colour per
 * instance, so the whole set is a handful of draw calls: on software renderers each draw is costly.
 */
const LOOK: Record<PieceKind, { batch: 'solid' | 'glow' | 'load' | 'wrapped' | 'door' | 'hazard'; color?: number }> = {
  upright: { batch: 'solid', color: 0x2d5391 },
  brace: { batch: 'solid', color: 0x2d5391 },
  beam: { batch: 'solid', color: 0xe2672a },
  protector: { batch: 'solid', color: 0xf2b51d },
  pallet: { batch: 'solid', color: 0xbf9560 },
  tape: { batch: 'solid', color: 0xf0c02a },
  track: { batch: 'solid', color: 0x4a5057 },
  leveler: { batch: 'solid', color: 0x41474e },
  housing: { batch: 'solid', color: 0x9aa0a6 },
  opening: { batch: 'glow', color: 0x07090b },
  signal: { batch: 'glow' },
  lens: { batch: 'glow', color: 0xfff4dc },
  load: { batch: 'load' },
  wrapped: { batch: 'wrapped' },
  door: { batch: 'door' },
  hazard: { batch: 'hazard' },
};

export class Warehouse {
  readonly group = new Group();
  private readonly scene: Scene;
  private readonly fog = new Fog(WAREHOUSE_BACKGROUND, 1, 2);
  private readonly textures: Texture[] = [];
  private readonly scratch = new Vector3();

  constructor(scene: Scene, options: WarehouseOptions = {}) {
    this.scene = scene;
    this.group.name = 'warehouse';
    const keep = <T extends Texture>(texture: T) => { this.textures.push(texture); return texture; };
    // Unlit, coloured by the baked light in the vertex colours (the lamps' glow ignores it).
    const lit = (color: number, map?: Texture) => new MeshBasicMaterial({ color, vertexColors: true, ...(map && { map }) });
    const lighting = sceneLighting(scene);

    const materials = {
      solid: lit(0xffffff),
      glow: new MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      load: lit(0xffffff, keep(cartonTexture(false))),
      wrapped: lit(0xffffff, keep(cartonTexture(true))),
      door: lit(0xffffff, keep(slatTexture())),
      hazard: lit(0xffffff, keep(hazardTexture())),
    };
    const batches = new Map<keyof typeof materials, Piece[]>();
    for (const piece of warehouseLayout(options)) {
      const { batch } = LOOK[piece.kind];
      if (!batches.has(batch)) batches.set(batch, []);
      batches.get(batch)!.push(piece);
    }
    for (const [batch, pieces] of batches) {
      // Nearest the iso camera (+X/+Z) first, so the depth test skips what they hide.
      pieces.sort((a, b) => (b.position.x + b.position.z) - (a.position.x + a.position.z));
      const geometry = mergeBoxes(pieces, piece => piece.tint ?? LOOK[piece.kind].color, batch === 'glow' ? undefined : lighting);
      const mesh = new Mesh(geometry, materials[batch]);
      mesh.name = `warehouse-${batch}`;
      this.group.add(mesh);
    }

    // The floor: one slab texture repeated every 240", offset so each slab's middle sits under a lamp.
    // (On the floor plane, u runs with +X from x0 and v runs with -Z from z1.)
    const span = { x0: -WALL_EXTENT, x1: WALL_EXTENT, z0: DOCK_Z, z1: WALL_EXTENT };
    const concrete = keep(concreteTexture());
    const fraction = (n: number) => n - Math.floor(n);
    concrete.repeat.set((span.x1 - span.x0) / SLAB, (span.z1 - span.z0) / SLAB);
    concrete.offset.set(0.5 - fraction((LAMP_ORIGIN.x - span.x0) / SLAB), 0.5 - fraction((span.z1 - LAMP_ORIGIN.z) / SLAB));
    const floorGeometry = new PlaneGeometry(span.x1 - span.x0, span.z1 - span.z0).rotateX(-Math.PI / 2);
    const floor = new Mesh(bake(floorGeometry, lighting), lit(0xffffff, concrete));
    floor.name = 'warehouse-floor';
    floor.position.set((span.x0 + span.x1) / 2, FLOOR, (span.z0 + span.z1) / 2);
    // Drawn after everything standing on it, then the walls, so hidden floor and wall pixels aren't shaded.
    floor.renderOrder = 1;
    this.group.add(floor);
    // The sun's shadow map only covers the pallet's surroundings, so only a patch there takes shadows
    // (over the tape too); shading the whole floor for them is costly on software renderers.
    const shadows = new Mesh(new PlaneGeometry(SHADOW_PATCH, SHADOW_PATCH), new ShadowMaterial({ opacity: 0.35 }));
    shadows.name = 'warehouse-shadows';
    shadows.rotation.x = -Math.PI / 2;
    shadows.position.y = FLOOR + 0.14;
    shadows.receiveShadow = true;
    this.group.add(shadows);

    // Walls (one mesh) and ceiling face inward, so a camera zoomed out past them still sees in.
    const mid = FLOOR + CEILING / 2;
    const wall = (length: number, position: Vector3, yaw: number) => {
      const plane = new PlaneGeometry(length, CEILING);
      const uv = plane.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * length / 8); // a rib every 8"
      return plane.applyMatrix4(new Matrix4().compose(position, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1)));
    };
    const walls = new Mesh(bake(mergeGeometries([
      wall(2 * WALL_EXTENT, new Vector3(0, mid, DOCK_Z), 0),
      wall(2 * WALL_EXTENT, new Vector3(0, mid, WALL_EXTENT), Math.PI),
      wall(WALL_EXTENT - DOCK_Z, new Vector3(-WALL_EXTENT, mid, (WALL_EXTENT + DOCK_Z) / 2), Math.PI / 2),
      wall(WALL_EXTENT - DOCK_Z, new Vector3(WALL_EXTENT, mid, (WALL_EXTENT + DOCK_Z) / 2), -Math.PI / 2),
    ])!, lighting), lit(0xffffff, keep(claddingTexture())));
    walls.name = 'warehouse-walls';
    walls.renderOrder = 2;
    const ceiling = new Mesh(bake(new PlaneGeometry(2 * WALL_EXTENT, WALL_EXTENT - DOCK_Z).rotateX(Math.PI / 2), lighting), lit(0x23282e));
    ceiling.name = 'warehouse-ceiling';
    ceiling.position.set(0, FLOOR + CEILING, (WALL_EXTENT + DOCK_Z) / 2);
    ceiling.renderOrder = 2;
    this.group.add(walls, ceiling);

    // Signs (one mesh): the aisle number over the haul aisle and a number over each dock door.
    const signs: Sign[] = [
      { text: 'AISLE 07', width: 64, position: new Vector3(RACK_LINE + DEPTH / 2 + 2, FLOOR + 176, 0), yaw: Math.PI / 2, background: '#1f4f9a', color: '#ffffff' },
      ...DOORS.map(({ x }, i) => ({ text: `DOCK 0${i + 1}`, width: 52, position: new Vector3(x, FLOOR + 150, DOCK_Z + 0.6), yaw: 0, background: '#f2b51d', color: '#15171a' })),
    ];
    const signMaterial = lit(0xffffff, keep(signAtlas(signs)));
    signMaterial.side = DoubleSide;
    const board = new Mesh(bake(mergeGeometries(signs.map(({ width, position, yaw }, i) => {
      const plane = new PlaneGeometry(width, width * 72 / 256);
      const uv = plane.getAttribute('uv');
      // Row i of the atlas; the canvas's top row is v = 1.
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / signs.length);
      return plane.applyMatrix4(new Matrix4().compose(position, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1)));
    }))!, lighting), signMaterial);
    board.name = 'warehouse-signs';
    this.group.add(board);

    this.group.traverse(object => { object.castShadow = false; });
    scene.add(this.group);
  }

  /** Show or hide the warehouse; it brings its fog with it. */
  setEnabled(enabled: boolean) {
    this.group.visible = enabled;
    this.scene.fog = enabled ? this.fog : null;
  }

  /** Keep the fog's range just behind the play area, wherever the camera is zoomed to. */
  update(camera: Camera, target: Vector3) {
    const distance = camera.getWorldPosition(this.scratch).distanceTo(target);
    this.fog.near = distance + FOG_START;
    this.fog.far = distance + FOG_END;
  }

  dispose() {
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.group.removeFromParent();
    const disposed = new Set<{ dispose(): void }>();
    this.group.traverse(object => {
      if (object instanceof Mesh) {
        disposed.add(object.geometry);
        for (const material of [object.material].flat()) disposed.add(material);
      }
    });
    for (const texture of this.textures) disposed.add(texture);
    disposed.forEach(item => item.dispose());
  }
}
