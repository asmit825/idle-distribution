import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** Procedural canvas textures for the smoke break, painted like the cartons' (no image assets). */

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const element = document.createElement('canvas');
  element.width = w;
  element.height = h;
  return element.getContext('2d')!;
}

function texture(ctx: CanvasRenderingContext2D, color = true) {
  const map = new CanvasTexture(ctx.canvas);
  if (color) map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function speckle(ctx: CanvasRenderingContext2D, random: () => number, count: number, colors: string[], size: [number, number]) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const r = size[0] + random() * (size[1] - size[0]);
    ctx.beginPath();
    ctx.ellipse(random() * ctx.canvas.width, random() * ctx.canvas.height, r, r * (0.5 + random()), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Rolling paper: U wraps the rod, V runs filter (bottom) to tip (top). */
export function paperTexture() {
  const random = mulberry32(7);
  const ctx = canvas(256, 1024);
  ctx.fillStyle = '#f3efe5';
  ctx.fillRect(0, 0, 256, 1024);
  speckle(ctx, random, 2600, ['rgba(120,100,70,.05)', 'rgba(255,255,255,.35)', 'rgba(150,130,90,.04)'], [0.4, 1.4]);
  // Laid lines from the paper mould, and faint burn-rate bands.
  for (let y = 0; y < 1024; y += 3) { ctx.fillStyle = `rgba(110,95,70,${0.015 + random() * 0.02})`; ctx.fillRect(0, y, 256, 1); }
  for (let y = 120; y < 1024; y += 190) { ctx.fillStyle = 'rgba(120,105,80,.05)'; ctx.fillRect(0, y, 256, 26); }
  // The glued seam.
  ctx.fillStyle = 'rgba(120,105,80,.13)';
  ctx.fillRect(126, 0, 3, 1024);
  // A small printed band just above the filter.
  ctx.fillStyle = '#b8964e';
  ctx.fillRect(0, 1024 - 64, 256, 2);
  ctx.font = '600 15px Georgia, serif';
  ctx.fillStyle = 'rgba(150,118,58,.85)';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(64, 1024 - 38);
  ctx.scale(0.55, 1);
  ctx.fillText('IDLE · DIST.', 0, 0);
  ctx.restore();
  const map = texture(ctx);
  map.wrapT = RepeatWrapping;
  return map;
}

/** Cork-print tipping paper wrapped around the filter, with the gold rim at the tipping line. */
export function filterTexture() {
  const random = mulberry32(11);
  const ctx = canvas(256, 256);
  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#c98a42');
  base.addColorStop(1, '#bd7b36');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, random, 2200, ['rgba(110,55,18,.55)', 'rgba(140,70,25,.45)', 'rgba(235,190,120,.5)', 'rgba(90,45,15,.4)'], [0.6, 2.4]);
  ctx.fillStyle = '#e9d9a8';
  ctx.fillRect(0, 0, 256, 6);
  ctx.fillStyle = '#c9a24c';
  ctx.fillRect(0, 6, 256, 4);
  return texture(ctx);
}

/** The exposed cellulose acetate at the mouth end: off-white fibres. */
export function filterEndTexture() {
  const random = mulberry32(13);
  const ctx = canvas(128, 128);
  ctx.fillStyle = '#ece5d3';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, random, 900, ['rgba(160,145,115,.25)', 'rgba(255,255,255,.6)'], [0.4, 1.6]);
  ctx.strokeStyle = 'rgba(150,135,105,.18)';
  for (let r = 6; r < 64; r += 4 + random() * 4) { ctx.beginPath(); ctx.arc(64, 64, r, 0, Math.PI * 2); ctx.stroke(); }
  return texture(ctx);
}

/** Grey ash with growth rings and fine cracks. Also the butts' charred ends. */
export function ashTexture() {
  const random = mulberry32(17);
  const ctx = canvas(128, 256);
  ctx.fillStyle = '#86837e';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 4 + random() * 6) { ctx.fillStyle = random() > 0.5 ? 'rgba(40,38,36,.35)' : 'rgba(220,218,212,.35)'; ctx.fillRect(0, y, 128, 1 + random() * 2); }
  speckle(ctx, random, 700, ['rgba(30,28,26,.45)', 'rgba(235,232,226,.55)', 'rgba(110,105,98,.6)'], [0.5, 2]);
  ctx.strokeStyle = 'rgba(25,24,22,.5)';
  for (let i = 0; i < 40; i++) {
    let x = random() * 128, y = random() * 256;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 4; j++) { x += (random() - 0.5) * 16; y += (random() - 0.5) * 10; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const map = texture(ctx);
  map.wrapT = RepeatWrapping;
  return map;
}

/** Mottled coal for the ember's emissive map. */
export function emberTexture() {
  const random = mulberry32(19);
  const ctx = canvas(128, 64);
  ctx.fillStyle = '#5a1504';
  ctx.fillRect(0, 0, 128, 64);
  speckle(ctx, random, 220, ['#ff6a1a', '#ff8c2a', '#ffc25a', '#c2300a', '#1a0602'], [1, 5]);
  return texture(ctx);
}

/** The charred paper just behind the ember: paper brown at the bottom to black at the top. */
export function charTexture() {
  const ctx = canvas(8, 64);
  const g = ctx.createLinearGradient(0, 64, 0, 0);
  g.addColorStop(0, '#d9c8a8');
  g.addColorStop(0.35, '#8a5a2c');
  g.addColorStop(0.7, '#2b1a10');
  g.addColorStop(1, '#0d0907');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 64);
  return texture(ctx);
}

/** The ash bed at the bottom of the ashtray. */
export function ashBedTexture() {
  const random = mulberry32(23);
  const ctx = canvas(256, 256);
  ctx.fillStyle = '#4f4c48';
  ctx.fillRect(0, 0, 256, 256);
  // Soft drifts of fine ash, then dust, then a few flakes and burnt tobacco crumbs.
  for (let i = 0; i < 40; i++) {
    const x = random() * 256, y = random() * 256, r = 10 + random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, random() > 0.5 ? 'rgba(150,146,140,.35)' : 'rgba(35,33,31,.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(ctx, random, 9000, ['rgba(25,23,21,.35)', 'rgba(160,156,148,.3)', 'rgba(95,90,84,.4)'], [0.2, 0.7]);
  speckle(ctx, random, 260, ['rgba(185,180,172,.55)', 'rgba(20,18,16,.6)', 'rgba(70,45,25,.6)'], [0.6, 1.8]);
  return texture(ctx);
}

/** Concentric brushed-steel grain (rows run around a lathe) for the ashtray's bump and roughness. */
export function brushedTexture() {
  const random = mulberry32(29);
  const ctx = canvas(32, 512);
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, 32, 512);
  for (let i = 0; i < 900; i++) {
    const v = Math.round(90 + random() * 80);
    ctx.fillStyle = `rgba(${v},${v},${v},.5)`;
    ctx.fillRect(0, random() * 512, 32, 1);
  }
  const map = texture(ctx, false);
  map.wrapS = map.wrapT = RepeatWrapping;
  return map;
}

/** Four soft, wispy smoke puffs in a 2×2 atlas. */
export function smokeAtlas() {
  const random = mulberry32(31);
  const ctx = canvas(256, 256);
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * 128, oy = Math.floor(tile / 2) * 128;
    const layer = canvas(128, 128);
    for (let i = 0; i < 70; i++) {
      const angle = random() * Math.PI * 2, reach = Math.abs(random() + random() - 1) * 34;
      const x = 64 + Math.cos(angle) * reach, y = 64 + Math.sin(angle) * reach * (0.6 + random() * 0.6);
      const r = 6 + random() * 24;
      const g = layer.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.05 + random() * 0.09})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      layer.fillStyle = g;
      layer.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Fade every puff to nothing well inside its tile, so no square edges show.
    layer.globalCompositeOperation = 'destination-in';
    const mask = layer.createRadialGradient(64, 64, 10, 64, 64, 62);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    layer.fillStyle = mask;
    layer.fillRect(0, 0, 128, 128);
    ctx.drawImage(layer.canvas, ox, oy);
  }
  return texture(ctx, false);
}

/** Soft additive halo around the ember, standing in for bloom. */
export function glowTexture() {
  const ctx = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,214,150,1)');
  g.addColorStop(0.2, 'rgba(255,130,40,.55)');
  g.addColorStop(0.55, 'rgba(255,70,10,.12)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return texture(ctx);
}
