import { MathUtils } from 'three';
import { orientedSize, PALLET_LENGTH_IN, PALLET_WIDTH_IN } from '../scene/coordinates';
import { stagingBay, type StagingBay } from '../scene/staging';
import { skuById } from '../types/catalog';
import type { FloorCase } from '../types/engine';

/**
 * Where Mode 1's floor cases wait (SPEC-01 §5.1): desktop clusters radiating around the pallet,
 * or, on phones, 26" bay slots shaped for the screen. The engine decides which cases spawn and
 * which way they lie; this decides only where they sit. All layouts are pure and deterministic.
 */
export type FloorLayout = 'radial' | 'portrait' | 'landscape';

/** Mobile bay slot pitch: the longest case side (24") plus a 2" aisle. */
export const BAY_IN = 26;

/**
 * Desktop: the floor splits into one cluster per heading, in degrees around the pallet. The
 * sides go first, hugging the pallet; the corners then fill the gaps between them.
 */
const CLUSTER_HEADINGS = [0, 180, 90, 270, 45, 225, 135, 315];
/** Space between cartons in a cluster, and between clusters. */
const GAP_IN = 3;
/** Clusters keep this far from the pallet edge, leaving room for overhang and the ghost. */
const PALLET_CLEARANCE_IN = 8;
/** Clusters slide outward from the pallet in steps of this many inches until clear. */
const PUSH_STEP_IN = 2;
/**
 * Mobile bay fields are elliptical in screen terms: the isometric camera looks along the X = Z
 * diagonal, so X − Z runs across the screen and X + Z up it, foreshortened. Each ratio is the
 * field's width across the screen over its length up the screen, in floor inches.
 */
const BAY_FIELD_RATIO = { portrait: 0.4, landscape: 1.6 } as const;

export function stageFloor(cases: readonly FloorCase[], layout: FloorLayout): StagingBay[] {
  return layout === 'radial' ? radialClusters(cases) : baySlots(cases, BAY_FIELD_RATIO[layout]);
}

/** A rectangle on the floor plane: scene X and Z, min inclusive, max exclusive. */
interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * Splits the floor into consecutive clusters, packs each into rows, and slides each outward
 * from the pallet along its heading until it clears the pallet and earlier clusters.
 */
function radialClusters(cases: readonly FloorCase[]): StagingBay[] {
  const keepOut = inflate({
    x0: -PALLET_LENGTH_IN / 2, z0: -PALLET_WIDTH_IN / 2, x1: PALLET_LENGTH_IN / 2, z1: PALLET_WIDTH_IN / 2,
  }, PALLET_CLEARANCE_IN);
  const placed: Rect[] = [];
  const bays: StagingBay[] = [];
  const count = CLUSTER_HEADINGS.length;
  for (const [k, degrees] of CLUSTER_HEADINGS.entries()) {
    const members = cases.slice(Math.round(k * cases.length / count), Math.round((k + 1) * cases.length / count));
    if (members.length === 0) continue;
    const { slots, width, depth } = packRows(members);
    const heading = MathUtils.degToRad(degrees);
    let block: Rect;
    for (let distance = 0; ; distance += PUSH_STEP_IN) {
      const cx = Math.round(Math.cos(heading) * distance);
      const cz = Math.round(Math.sin(heading) * distance);
      block = { x0: cx - width / 2, z0: cz - depth / 2, x1: cx + width / 2, z1: cz + depth / 2 };
      const padded = inflate(block, GAP_IN);
      if (!intersects(padded, keepOut) && !placed.some(other => intersects(padded, other))) break;
    }
    placed.push(block);
    for (const { floorCase, x, z } of slots) bays.push(bay(floorCase, block.x0 + x, block.z0 + z));
  }
  return bays;
}

/**
 * Shelf-packs cases left to right into rows about as wide as the cluster is deep; returns each
 * case's center within the block.
 */
function packRows(cases: readonly FloorCase[]) {
  const sizes = cases.map(floorCase => orientedSize(skuById(floorCase.sku_id), { yaw: floorCase.yaw, flipped: false }));
  const rowLimit = Math.sqrt(sizes.reduce((area, size) => area + (size.x + GAP_IN) * (size.y + GAP_IN), 0));
  const slots: { floorCase: FloorCase; x: number; z: number }[] = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  let width = 0;
  for (const [index, floorCase] of cases.entries()) {
    const size = sizes[index];
    if (x > 0 && x + size.x > rowLimit) {
      z += rowDepth + GAP_IN;
      x = 0;
      rowDepth = 0;
    }
    // Domain Y runs along scene Z.
    slots.push({ floorCase, x: x + size.x / 2, z: z + size.y / 2 });
    width = Math.max(width, x + size.x);
    rowDepth = Math.max(rowDepth, size.y);
    x += size.x + GAP_IN;
  }
  return { slots, width, depth: z + rowDepth };
}

/**
 * One case per 26" slot on a lattice whose 2 × 2 center block holds the pallet. Slots fill
 * nearest-first in an ellipse stretched toward the screen's long side.
 */
function baySlots(cases: readonly FloorCase[], ratio: number): StagingBay[] {
  // Enough rings for any reasonable floor in the narrower direction.
  const reach = Math.ceil(Math.sqrt(cases.length / ratio) + Math.sqrt(cases.length * ratio)) + 2;
  const slots: { x: number; z: number; rank: number }[] = [];
  for (let i = -reach; i < reach; i++) {
    for (let j = -reach; j < reach; j++) {
      if ((i === -1 || i === 0) && (j === -1 || j === 0)) continue; // the pallet
      const x = (i + 0.5) * BAY_IN;
      const z = (j + 0.5) * BAY_IN;
      const up = x + z;
      const across = (x - z) / ratio;
      slots.push({ x, z, rank: up * up + across * across });
    }
  }
  // Ties break on position, so equal ranks always fill in the same order.
  slots.sort((a, b) => a.rank - b.rank || a.x - b.x || a.z - b.z);
  return cases.map((floorCase, index) => bay(floorCase, slots[index].x, slots[index].z));
}

function bay(floorCase: FloorCase, x: number, z: number): StagingBay {
  return stagingBay(floorCase.id, skuById(floorCase.sku_id), floorCase.yaw, x, z);
}

function inflate(rect: Rect, by: number): Rect {
  return { x0: rect.x0 - by, z0: rect.z0 - by, x1: rect.x1 + by, z1: rect.z1 + by };
}

function intersects(a: Rect, b: Rect) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}
