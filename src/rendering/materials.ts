import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from 'three';
import type { SkuDef } from '../types/catalog';

/** Uniform texel density on every face, so no texture is stretched. */
export const PX_PER_IN = 32;
/** Visual clearance per side, so flush neighbors never share a plane (no z-fighting). */
const SEAM_IN = 1 / 8;
/** One sealing strip runs along the top seam and folds down both end panels. */
const TAPE_IN = 2.5;
const INK = 'rgba(28, 20, 12, 0.9)';
const RED = '#c81e1e';

type FaceKind = 'end' | 'top' | 'side';
/** BoxGeometry group order: +X, −X, +Y, −Y, +Z, −Z. */
const FACE_KINDS: readonly FaceKind[] = ['end', 'end', 'top', 'top', 'side', 'side'];

interface Face {
  w: number;
  h: number;
  /** Both contexts draw in inches. */
  color: CanvasRenderingContext2D;
  /** Red = bump height, green = roughness; bound as both `bumpMap` and `roughnessMap`. */
  surface: CanvasRenderingContext2D;
  random: () => number;
}

/** Rendered carton size in scene inches: length on X, height on Y, width on Z, inset by the seam. */
export function cartonSize(sku: SkuDef) {
  return { x: sku.length_in - 2 * SEAM_IN, y: sku.height_in, z: sku.width_in - 2 * SEAM_IN };
}

const cache = new Map<string, readonly MeshStandardMaterial[]>();

/** Six materials in BoxGeometry face order; opposite faces share one material. Cached per SKU. */
export function getBoxMaterials(sku: SkuDef): readonly MeshStandardMaterial[] {
  let materials = cache.get(sku.id);
  if (!materials) {
    const byKind = { end: paintFace(sku, 'end'), top: paintFace(sku, 'top'), side: paintFace(sku, 'side') };
    materials = FACE_KINDS.map(kind => byKind[kind]);
    cache.set(sku.id, materials);
  }
  return materials;
}

export function disposeBoxMaterials() {
  for (const material of new Set([...cache.values()].flat())) {
    material.map?.dispose();
    material.bumpMap?.dispose(); // also the roughness map
    material.dispose();
  }
  cache.clear();
}

function paintFace(sku: SkuDef, kind: FaceKind): MeshStandardMaterial {
  const size = cartonSize(sku);
  const [w, h] = kind === 'end' ? [size.z, size.y] : kind === 'top' ? [size.x, size.z] : [size.x, size.y];
  const face: Face = { w, h, color: context(w, h), surface: context(w, h), random: prng(`${sku.id}/${kind}`) };
  paintCardboard(face, kind);
  if (kind === 'top') paintTape(face, sku, 0, (h - TAPE_IN) / 2, w, false);
  if (kind === 'end') {
    const tab = Math.min(2.5, h / 4);
    paintTape(face, sku, (w - TAPE_IN) / 2, 0, tab, true);
    paintTape(face, sku, (w - TAPE_IN) / 2, h - tab, tab, true);
  }
  paintMarkings(face, sku, kind);

  const map = new CanvasTexture(face.color.canvas);
  map.colorSpace = SRGBColorSpace;
  const surface = new CanvasTexture(face.surface.canvas);
  map.anisotropy = surface.anisotropy = 8;
  return new MeshStandardMaterial({ map, bumpMap: surface, bumpScale: 2, roughnessMap: surface, roughness: 1, metalness: 0 });
}

function context(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w * PX_PER_IN;
  canvas.height = h * PX_PER_IN;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PX_PER_IN, PX_PER_IN);
  return ctx;
}

/** Surface-map color for a bump height and roughness, each 0–1. */
function surfaceColor(height: number, roughness: number) {
  return `rgb(${Math.round(height * 255)}, ${Math.round(roughness * 255)}, 0)`;
}

/** Deterministic noise, so cached and regenerated textures are identical. */
function prng(seed: string) {
  let state = [...seed].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintCardboard({ w, h, color, surface, random }: Face, kind: FaceKind) {
  color.fillStyle = '#c89f65';
  color.fillRect(0, 0, w, h);
  surface.fillStyle = surfaceColor(0.5, 0.9);
  surface.fillRect(0, 0, w, h);
  // Micro-noise: paper fibre and pulp specks.
  for (let i = 0; i < w * h * 6; i++) {
    const shade = random() < 0.5 ? '60, 35, 10' : '255, 230, 190';
    color.fillStyle = `rgba(${shade}, ${0.04 + random() * 0.08})`;
    color.fillRect(random() * w, random() * h, 0.03 + random() * 0.05, 0.03 + random() * 0.05);
  }
  // C-flute corrugation shows through the liner as 5/16" striations.
  for (let x = 0; x < w; x += 5 / 16) {
    color.fillStyle = 'rgba(90, 55, 20, 0.07)';
    color.fillRect(x, 0, 0.12, h);
    surface.fillStyle = surfaceColor(0.4, 0.92);
    surface.fillRect(x, 0, 0.12, h);
  }
  // Rounded score edges.
  const edge = 0.18;
  for (const [ctx, style] of [[color, 'rgba(70, 40, 10, 0.28)'], [surface, surfaceColor(0.3, 0.95)]] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = edge;
    ctx.strokeRect(edge / 2, edge / 2, w - edge, h - edge);
  }
  if (kind === 'top') {
    // Seam where the two major flaps meet, under the tape.
    color.fillStyle = 'rgba(55, 30, 8, 0.75)';
    color.fillRect(0, h / 2 - 0.04, w, 0.08);
    surface.fillStyle = surfaceColor(0.1, 1);
    surface.fillRect(0, h / 2 - 0.04, w, 0.08);
  }
}

/** Paints a strip of `length` inches at (x, y), running along +X or, if `vertical`, along +Y. */
function paintTape(face: Face, sku: SkuDef, x: number, y: number, length: number, vertical: boolean) {
  const { color, surface, random } = face;
  for (const ctx of [color, surface]) {
    ctx.save();
    // Local frame: the strip spans (0..length) × (0..TAPE_IN).
    if (vertical) { ctx.translate(x + TAPE_IN, y); ctx.rotate(Math.PI / 2); }
    else ctx.translate(x, y);
  }
  const band = (ctx: CanvasRenderingContext2D, style: string, from: number, to: number) => {
    ctx.fillStyle = style;
    ctx.fillRect(0, from, length, to - from);
  };
  const line = (ctx: CanvasRenderingContext2D, style: string, width: number, x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };

  if (sku.tape === 'reinforced') {
    band(color, '#d8b07a', 0, TAPE_IN);
    band(surface, surfaceColor(0.6, 0.62), 0, TAPE_IN);
    // Fiberglass filaments: longitudinal strands plus a diamond cross-weave.
    for (const [ctx, style] of [[color, 'rgba(250, 248, 238, 0.75)'], [surface, surfaceColor(0.85, 0.5)]] as const) {
      for (let s = 0.2; s < TAPE_IN; s += 0.3) line(ctx, style, 0.035, 0, s, length, s);
      for (let s = -TAPE_IN; s < length + TAPE_IN; s += 0.45) {
        line(ctx, style, 0.03, s, 0, s + TAPE_IN * 0.8, TAPE_IN);
        line(ctx, style, 0.03, s + TAPE_IN * 0.8, 0, s, TAPE_IN);
      }
    }
  } else if (sku.tape === 'paper') {
    band(color, '#a8733f', 0, TAPE_IN);
    band(surface, surfaceColor(0.58, 0.82), 0, TAPE_IN);
    // Uneven gum and the wrinkles water-activated tape dries with.
    for (let s = random() * 2; s < length; s += 1.2 + random() * 2.2) {
      const skew = (random() - 0.5) * 0.8;
      line(color, 'rgba(70, 38, 10, 0.35)', 0.04, s, 0, s + skew, TAPE_IN);
      line(surface, surfaceColor(0.35, 0.9), 0.06, s, 0, s + skew, TAPE_IN);
    }
    // Pronounced boundary creases.
    for (const edge of [0.07, TAPE_IN - 0.07]) {
      line(color, 'rgba(55, 28, 5, 0.65)', 0.06, 0, edge, length, edge);
      line(surface, surfaceColor(0.25, 0.95), 0.08, 0, edge, length, edge);
    }
    for (const edge of [0.14, TAPE_IN - 0.14]) line(color, 'rgba(255, 220, 170, 0.25)', 0.04, 0, edge, length, edge);
    if (sku.handling === 'fragile') {
      for (let s = 0.3; s + 2.8 < length; s += 3.6) text(color, 'FRAGILE', s, TAPE_IN * 0.68, TAPE_IN * 0.42, { color: RED, maxWidth: 2.8 });
    }
  } else {
    // Pressure-sensitive poly: translucent film with a glossy specular sheen.
    band(color, sku.tape === 'pressure_sensitive_tan' ? 'rgba(186, 128, 66, 0.82)' : 'rgba(252, 244, 228, 0.3)', 0, TAPE_IN);
    band(surface, surfaceColor(0.56, 0.15), 0, TAPE_IN);
    band(color, 'rgba(255, 255, 255, 0.22)', TAPE_IN * 0.18, TAPE_IN * 0.34);
    band(color, 'rgba(255, 255, 255, 0.1)', TAPE_IN * 0.62, TAPE_IN * 0.68);
    for (const edge of [0.02, TAPE_IN - 0.02]) line(color, 'rgba(255, 255, 255, 0.45)', 0.04, 0, edge, length, edge);
  }
  color.restore();
  surface.restore();
}

function paintMarkings(face: Face, sku: SkuDef, kind: FaceKind) {
  const { w, h, color } = face;
  const scale = Math.min(1, Math.max(0.55, Math.min(w / 12, h / 10)));
  const margin = 0.4 * scale;

  // Gross weight badge, top right.
  const [badgeWidth, badgeHeight] = [3.2 * scale, 1.15 * scale];
  color.strokeStyle = INK;
  color.lineWidth = 0.07 * scale;
  color.strokeRect(w - margin - badgeWidth, margin, badgeWidth, badgeHeight);
  text(color, 'GROSS WT', w - margin - badgeWidth / 2, margin + 0.3 * scale, 0.2 * scale, { align: 'center' });
  text(color, `[ ${sku.weight_lbs} LBS ]`, w - margin - badgeWidth / 2, margin + 0.96 * scale, 0.6 * scale, { align: 'center', font: 'monospace', maxWidth: badgeWidth - 0.2 * scale });

  // Tall cartons get tall arrows.
  if (kind !== 'top') paintUpArrows(color, margin, margin, (sku.height_in > sku.width_in ? 1.6 : 1.1) * scale, scale);
  paintShippingLabel(face, sku, margin, h - margin - 2.4 * scale, scale);

  if (sku.handling === 'heavy') {
    const y = h - margin - 0.8 * scale;
    color.fillStyle = RED;
    color.fillRect(w - margin - badgeWidth, y, badgeWidth, 0.8 * scale);
    text(color, 'HEAVY DUTY', w - margin - badgeWidth / 2, y + 0.55 * scale, 0.4 * scale, { align: 'center', color: '#fff', maxWidth: badgeWidth - 0.2 * scale });
    if (kind === 'side') {
      // Box maker's certificate stamp.
      const radius = 0.75 * scale;
      const [stampX, stampY] = [w - margin - badgeWidth - 0.3 * scale - radius, h - margin - radius];
      color.lineWidth = 0.05 * scale;
      color.beginPath();
      color.arc(stampX, stampY, radius, 0, Math.PI * 2);
      color.stroke();
      text(color, `${sku.top_load_capacity_lbs}#`, stampX, stampY + 0.08 * scale, 0.4 * scale, { align: 'center' });
      text(color, 'BURST', stampX, stampY + 0.38 * scale, 0.17 * scale, { align: 'center' });
    }
  } else if (sku.handling === 'light') {
    const y = h - margin - 0.7 * scale;
    color.lineWidth = 0.05 * scale;
    color.strokeRect(w - margin - badgeWidth, y, badgeWidth, 0.7 * scale);
    text(color, 'LIGHTWEIGHT', w - margin - badgeWidth / 2, y + 0.48 * scale, 0.34 * scale, { align: 'center', maxWidth: badgeWidth - 0.2 * scale });
    text(color, 'FRAGILE · HANDLE WITH CARE', w - margin - badgeWidth / 2, y - 0.15 * scale, 0.2 * scale, { align: 'center', color: RED, maxWidth: badgeWidth });
  } else if (sku.handling === 'fragile') {
    // Red corner banner.
    const leg = 3 * scale;
    color.fillStyle = RED;
    color.beginPath();
    color.moveTo(w, h - leg);
    color.lineTo(w, h);
    color.lineTo(w - leg, h);
    color.closePath();
    color.fill();
    color.save();
    color.translate(w - leg * 0.36, h - leg * 0.36);
    color.rotate(-Math.PI / 4);
    text(color, 'FRAGILE', 0, -0.02 * scale, 0.36 * scale, { align: 'center', color: '#fff' });
    text(color, 'HANDLE WITH CARE', 0, 0.24 * scale, 0.15 * scale, { align: 'center', color: '#fff' });
    color.restore();
  }
}

function paintUpArrows(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, scale: number) {
  const width = 0.5 * scale;
  ctx.fillStyle = INK;
  for (const left of [x, x + width * 1.35]) {
    const shaft = width * 0.34;
    ctx.beginPath();
    ctx.moveTo(left + width / 2, y);
    ctx.lineTo(left + width, y + width * 0.8);
    ctx.lineTo(left + width / 2 + shaft / 2, y + width * 0.8);
    ctx.lineTo(left + width / 2 + shaft / 2, y + height);
    ctx.lineTo(left + width / 2 - shaft / 2, y + height);
    ctx.lineTo(left + width / 2 - shaft / 2, y + width * 0.8);
    ctx.lineTo(left, y + width * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(x, y + height + 0.08 * scale, width * 2.35, 0.06 * scale);
  text(ctx, 'THIS SIDE UP', x, y + height + 0.38 * scale, 0.2 * scale, { maxWidth: width * 2.35 });
}

function paintShippingLabel({ color, surface }: Face, sku: SkuDef, x: number, y: number, scale: number) {
  const [labelWidth, labelHeight] = [4 * scale, 2.4 * scale];
  color.fillStyle = '#f7f4ec';
  color.fillRect(x, y, labelWidth, labelHeight);
  color.strokeStyle = 'rgba(30, 30, 30, 0.6)';
  color.lineWidth = 0.03 * scale;
  color.strokeRect(x, y, labelWidth, labelHeight);
  surface.fillStyle = surfaceColor(0.62, 0.55);
  surface.fillRect(x, y, labelWidth, labelHeight);

  const pad = 0.2 * scale;
  text(color, sku.name.toUpperCase(), x + pad, y + 0.42 * scale, 0.28 * scale, { maxWidth: labelWidth - 2 * pad });
  text(color, `${sku.length_in} × ${sku.width_in} × ${sku.height_in} IN`, x + pad, y + 0.72 * scale, 0.2 * scale, { font: 'monospace', maxWidth: labelWidth - 2 * pad });
  const top = y + 0.88 * scale;
  const barcode = code39(sku.id);
  const module = (labelWidth - 2 * pad) / barcode.width;
  color.fillStyle = '#111';
  for (const bar of barcode.bars) color.fillRect(x + pad + bar.x * module, top, bar.width * module, 1 * scale);
  text(color, `*${sku.id}*`, x + labelWidth / 2, top + 1.3 * scale, 0.22 * scale, { align: 'center', font: 'monospace' });
}

/** Code 39 patterns, bar/space alternating, 1 = wide. */
const CODE39: Record<string, string> = {
  0: '000110100', 1: '100100001', 2: '001100001', 3: '101100000', 4: '000110001', 5: '100110000',
  6: '001110000', 7: '000100101', 8: '100100100', 9: '001100100', A: '100001001', B: '001001001',
  C: '101001000', D: '000011001', E: '100011000', F: '001011000', G: '000001101', H: '100001100',
  I: '001001100', J: '000011100', K: '100000011', L: '001000011', M: '101000010', N: '000010011',
  O: '100010010', P: '001010010', Q: '000000111', R: '100000110', S: '001000110', T: '000010110',
  U: '110000001', V: '011000001', W: '111000000', X: '010010001', Y: '110010000', Z: '011010000',
  '-': '010000101', '*': '010010100',
};

/** Bar positions in narrow-module units for a scannable Code 39 symbol (wide = 2.5 narrow). */
function code39(value: string) {
  const bars: { x: number; width: number }[] = [];
  let cursor = 0;
  for (const char of `*${value}*`) {
    [...CODE39[char]].forEach((wide, i) => {
      const width = wide === '1' ? 2.5 : 1;
      if (i % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    });
    cursor += 1; // inter-character gap
  }
  return { bars, width: cursor - 1 };
}

interface TextOptions { align?: CanvasTextAlign; color?: string; font?: string; maxWidth?: number }

/** Text sized in inches, rasterized at texel scale so glyphs stay crisp. */
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, options: TextOptions = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / PX_PER_IN, 1 / PX_PER_IN);
  ctx.font = `bold ${size * PX_PER_IN}px ${options.font ?? 'Helvetica, Arial, sans-serif'}`;
  ctx.textAlign = options.align ?? 'left';
  ctx.fillStyle = options.color ?? INK;
  if (options.maxWidth === undefined) ctx.fillText(value, 0, 0);
  else ctx.fillText(value, 0, 0, options.maxWidth * PX_PER_IN);
  ctx.restore();
}
