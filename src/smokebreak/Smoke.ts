import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, type Texture, Vector3 } from 'three';

const MAX = 900;
/** Floats per particle in the simulation buffer. */
const STRIDE = 12;
const [PX, PY, PZ, VX, VY, VZ, AGE, LIFE, SIZE0, SIZE1, ALPHA, SPIN] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export interface Emission {
  at: Vector3;
  velocity: Vector3;
  /** Random velocity added per axis, ±. */
  spread: number;
  life: [number, number];
  /** Diameter in cm at birth and at death. */
  size: [number, number, number];
  alpha: [number, number];
  /** 0 is the thin blue-grey sidestream from the tip; 1 is exhaled, greyer smoke. */
  tone: 0 | 1;
}

const vertexShader = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute float aRot; attribute float aTile; attribute float aTone;
  uniform float uScale;
  varying float vAlpha; varying float vRot; varying float vTile; varying float vTone;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z;
    vAlpha = aAlpha; vRot = aRot; vTile = aTile; vTone = aTone;
  }`;
const fragmentShader = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha; varying float vRot; varying float vTile; varying float vTone;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p * 1.38 + 0.5;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
    vec2 tile = vec2(mod(vTile, 2.0), floor(vTile / 2.0));
    vec4 t = texture2D(uMap, (p + tile) * 0.5);
    float a = t.a * vAlpha;
    if (a < 0.002) discard;
    vec3 side = vec3(0.70, 0.76, 0.86), exhaled = vec3(0.78, 0.78, 0.78);
    gl_FragColor = vec4(mix(side, exhaled, vTone), a);
  }`;

/**
 * Smoke as soft, rotating point sprites advected through a shared, time-varying swirl field: the
 * sidestream leaves the tip as a laminar thread and breaks into curls as it climbs and spreads.
 */
export class Smoke {
  readonly points: Points;
  private readonly sim = new Float32Array(MAX * STRIDE);
  private readonly tile = new Float32Array(MAX);
  private readonly tone = new Float32Array(MAX);
  private readonly position = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly rot = new Float32Array(MAX);
  private count = 0;
  private time = 0;
  private readonly material: ShaderMaterial;
  private readonly geometry = new BufferGeometry();
  /** Height the sidestream starts at; turbulence grows with height above it. */
  private sourceY = 0;

  constructor(map: Texture) {
    this.material = new ShaderMaterial({ vertexShader, fragmentShader, transparent: true, depthWrite: false, uniforms: { uMap: { value: map }, uScale: { value: 600 } } });
    const attrs = { position: [this.position, 3], aSize: [this.size, 1], aAlpha: [this.alpha, 1], aRot: [this.rot, 1], aTile: [this.tile, 1], aTone: [this.tone, 1] } as const;
    for (const [name, [array, width]] of Object.entries(attrs)) this.geometry.setAttribute(name, new BufferAttribute(array, width));
    this.geometry.setDrawRange(0, 0);
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Pixels per cm at 1 cm depth: the drawing buffer height over the view height at that depth. */
  setScale(bufferHeight: number, fovDegrees: number) {
    this.material.uniforms.uScale.value = bufferHeight / (2 * Math.tan(fovDegrees * Math.PI / 360));
  }

  emit(e: Emission, n = 1) {
    if (e.tone === 0) this.sourceY = e.at.y;
    for (let k = 0; k < n && this.count < MAX; k++) {
      const i = this.count++, o = i * STRIDE, r = Math.random;
      this.sim[o + PX] = e.at.x; this.sim[o + PY] = e.at.y; this.sim[o + PZ] = e.at.z;
      this.sim[o + VX] = e.velocity.x + (r() - 0.5) * 2 * e.spread;
      this.sim[o + VY] = e.velocity.y + (r() - 0.5) * 2 * e.spread;
      this.sim[o + VZ] = e.velocity.z + (r() - 0.5) * 2 * e.spread;
      this.sim[o + AGE] = 0;
      this.sim[o + LIFE] = e.life[0] + r() * (e.life[1] - e.life[0]);
      this.sim[o + SIZE0] = e.size[0];
      this.sim[o + SIZE1] = e.size[1] + r() * (e.size[2] - e.size[1]);
      this.sim[o + ALPHA] = e.alpha[0] + r() * (e.alpha[1] - e.alpha[0]);
      this.sim[o + SPIN] = (r() - 0.5) * 0.8;
      this.rot[i] = r() * Math.PI * 2;
      this.tile[i] = Math.floor(r() * 4);
      this.tone[i] = e.tone;
    }
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time, s = this.sim;
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      const age = (s[o + AGE] += dt);
      if (age >= s[o + LIFE]) { this.remove(i--); continue; }
      const x = s[o + PX], y = s[o + PY], z = s[o + PZ];
      const exhaled = this.tone[i] === 1;
      // Laminar near the source, turbulent once it has climbed a few cm.
      const k = exhaled ? 1.1 : Math.min(2.4, 0.05 + Math.max(0, y - this.sourceY) ** 1.4 / 9);
      const fx = Math.sin(y * 0.42 + t * 0.9) * 1.3 + Math.sin(z * 0.55 + t * 1.7 + 1.3) * 0.7 + Math.sin(y * 1.3 - t * 2.3) * 0.35;
      const fz = Math.cos(y * 0.36 - t * 1.1) * 1.1 + Math.sin(x * 0.5 + t * 1.3) * 0.6 + Math.cos(y * 1.1 + t * 2.1) * 0.3;
      const drag = exhaled ? 1.4 : 0.5;
      s[o + VX] *= 1 - drag * dt; s[o + VZ] *= 1 - drag * dt; s[o + VY] *= 1 - drag * 0.6 * dt;
      s[o + VY] += (exhaled ? 0.9 : 1.6) * dt;
      s[o + PX] = x + (s[o + VX] + fx * k) * dt;
      s[o + PY] = y + (s[o + VY] + Math.abs(fx) * 0.15 * k) * dt;
      s[o + PZ] = z + (s[o + VZ] + fz * k) * dt;
      const life = age / s[o + LIFE];
      this.position[i * 3] = s[o + PX]; this.position[i * 3 + 1] = s[o + PY]; this.position[i * 3 + 2] = s[o + PZ];
      this.size[i] = s[o + SIZE0] + (s[o + SIZE1] - s[o + SIZE0]) * Math.pow(life, 0.65);
      const fadeIn = Math.min(1, life / (exhaled ? 0.04 : 0.1));
      this.alpha[i] = s[o + ALPHA] * fadeIn * Math.pow(1 - life, 1.6);
      this.rot[i] += s[o + SPIN] * dt * (1 + k);
    }
    for (const name of ['position', 'aSize', 'aAlpha', 'aRot', 'aTile', 'aTone']) this.geometry.getAttribute(name).needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }

  /** Swap-removes particle `i` with the last live one. */
  private remove(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.sim.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
    this.rot[i] = this.rot[last]; this.tile[i] = this.tile[last]; this.tone[i] = this.tone[last];
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
