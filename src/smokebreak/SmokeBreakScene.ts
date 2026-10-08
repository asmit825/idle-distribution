import {
  ACESFilmicToneMapping, AdditiveBlending, CircleGeometry, Clock, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog,
  GridHelper, Group, HemisphereLight, LatheGeometry, type Material, Mesh, MeshStandardMaterial, Object3D, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Quaternion, Scene, Sprite, SpriteMaterial, type Texture,
  Vector2, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buttSlot } from './smokeBreak';
import { Smoke } from './Smoke';
import {
  ashBedTexture, ashTexture, brushedTexture, charTexture, emberTexture, filterEndTexture, filterTexture, glowTexture,
  paperTexture, smokeAtlas,
} from './textures';

/** Real king-size proportions, in cm. */
const RADIUS = 0.39, FILTER = 2.7, ROD = 5.7;
/** Paper left above the filter when it is finished. */
const STUB = 0.8;
const BURNABLE = ROD - STUB;
const CHAR = 0.14, EMBER = 0.16;
/** The ash bed's height and the bowl's inner radius at it. */
const BED_Y = 0.61, BED_RADIUS = 4.6;
const UP = new Vector3(0, 1, 0);
/** Where the lit end starts, over the ashtray so its ash falls in, and the way the cigarette points at it. */
const TIP = new Vector3(-0.8, 10.2, -1.6);
const AXIS = new Vector3(-0.42, 0.3, -0.86).normalize();

interface Materials {
  filter: Material[];
  paper: MeshStandardMaterial;
  char: MeshStandardMaterial;
  ember: MeshStandardMaterial;
  ash: MeshStandardMaterial;
  /** The blackened, crushed-out end of a butt. */
  stubbed: MeshStandardMaterial;
}

interface Pose { position: Vector3; quaternion: Quaternion }
const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/**
 * The break area: a lit cigarette angled toward the smoker over a steel ashtray on the warehouse's
 * blue-grey floor. Each drag burns it down, brightens the ember and pulls smoke that is exhaled a beat
 * later; ash breaks off into the tray, and finished cigarettes are stubbed out onto a growing pile.
 */
export class SmokeBreakScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 0.5, 400);
  private readonly smoke: Smoke;
  private readonly tray = new Group();
  private readonly materials: Materials;
  private readonly cigarette: Cigarette;
  private readonly rest: Pose;
  /** Per-frame animations; each returns false once finished. */
  private readonly steps = new Set<(dt: number) => boolean>();
  private readonly observer: ResizeObserver;
  private readonly textures: Texture[] = [];
  /** cm burned on the current cigarette, shown and wanted. */
  private burned = 0;
  private target = 0;
  /** cm burned when the ash last fell off. */
  private ashFrom = 0;
  private ashBreak = 1.1;
  /** Ember brightness boost from the last drag, decaying to 0. */
  private glow = 1;
  private sincePuff = Infinity;
  private drawn = 0;
  private exhaling = 0;
  private emitDebt = 0;
  private butts = 0;
  private debris: Object3D[] = [];
  private readonly reflections: Texture;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'A lit cigarette over a steel ashtray');
    host.appendChild(this.renderer.domElement);

    const { scene } = this;
    // The warehouse's industrial palette (PalletCanvas): the floor fades into the backdrop.
    scene.background = new Color('#131c26');
    scene.fog = new Fog('#131c26', 40, 130);
    // Reflections for the steel only, so nothing else is lit brighter than the warehouse floor.
    const pmrem = new PMREMGenerator(this.renderer);
    this.reflections = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.lights();
    this.floor();

    const t = <T extends Texture>(texture: T) => { this.textures.push(texture); return texture; };
    const filterEnd = new MeshStandardMaterial({ map: t(filterEndTexture()), roughness: 0.95 });
    const ashMap = t(ashTexture());
    this.materials = {
      filter: [new MeshStandardMaterial({ map: t(filterTexture()), roughness: 0.55 }), filterEnd, filterEnd],
      paper: new MeshStandardMaterial({ map: t(paperTexture()), roughness: 0.78 }),
      char: new MeshStandardMaterial({ map: t(charTexture()), roughness: 0.95 }),
      ember: new MeshStandardMaterial({ color: 0x3a0e04, emissive: 0xff5a14, emissiveMap: t(emberTexture()), emissiveIntensity: 2, roughness: 1 }),
      ash: new MeshStandardMaterial({ map: ashMap, roughness: 1 }),
      stubbed: new MeshStandardMaterial({ map: ashMap, color: 0x4a443e, roughness: 1 }),
    };
    this.ashtray();
    this.cigarette = new Cigarette(this.materials, t(glowTexture()));
    this.rest = { position: TIP.clone().addScaledVector(AXIS, -(FILTER + ROD)), quaternion: new Quaternion().setFromUnitVectors(UP, AXIS) };
    this.cigarette.group.position.copy(this.rest.position);
    this.cigarette.group.quaternion.copy(this.rest.quaternion);
    scene.add(this.cigarette.group);
    this.smoke = new Smoke(t(smokeAtlas()));
    scene.add(this.smoke.points);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    const clock = new Clock();
    this.renderer.setAnimationLoop(() => this.frame(Math.min(clock.getDelta(), 0.1)));
  }

  /** One drag: burns to `fraction` of the way down and brightens the ember. */
  inhale(fraction: number) {
    this.target = fraction * BURNABLE;
    this.glow = 1;
    this.sincePuff = 0;
    this.drawn++;
  }

  /** The cigarette is done: stub it out in the ashtray and light the next one. */
  finish() {
    this.inhale(1);
    this.burned = BURNABLE;
    this.cigarette.set(this.burned, 0);
    this.dropButt();
    this.burned = this.target = this.ashFrom = 0;
    this.lightNext();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.smoke.dispose();
    const materials = new Set<Material>();
    this.scene.traverse(object => {
      if (object instanceof Mesh || object instanceof Sprite) {
        object.geometry.dispose();
        for (const material of [object.material].flat()) materials.add(material);
      }
    });
    for (const material of materials) { (material as MeshStandardMaterial).map?.dispose(); material.dispose(); }
    for (const texture of this.textures) texture.dispose();
    this.reflections.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private lights() {
    // The pallet scene's sky, bounce and sun.
    this.scene.add(new HemisphereLight(0xcce4ff, 0x6b5037, 2.5));
    const sun = new DirectionalLight(0xffe5bc, 3.5);
    sun.position.set(10, 30, 12);
    sun.target.position.set(0, 3, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
    sun.shadow.normalBias = 0.02;
    const rim = new DirectionalLight(0x9fc4ff, 0.8);
    rim.position.set(-14, 10, -18);
    this.scene.add(sun, sun.target, rim);
  }

  private floor() {
    const floor = new Mesh(new PlaneGeometry(600, 600), new MeshStandardMaterial({ color: 0x202d38, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const grid = new GridHelper(200, 40, 0x354857, 0x293946);
    grid.position.y = 0.01;
    this.scene.add(floor, grid);
  }

  private ashtray() {
    const grain = brushedTexture();
    this.textures.push(grain);
    grain.repeat.set(1, 3);
    const steel = new MeshStandardMaterial({ color: 0xc3c8ce, metalness: 1, roughness: 0.34, envMap: this.reflections, envMapIntensity: 0.55, roughnessMap: grain, bumpMap: grain, bumpScale: 0.4, side: DoubleSide });
    // Profile from the base's center, up the outside, over the rolled rim, down to the bed.
    const profile = [[0, 0], [5.5, 0], [5.9, 0.15], [6.05, 0.5], [6.15, 1.9], [6.05, 2.15], [5.75, 2.22], [5.45, 2.1],
      [5.2, 1.6], [4.85, 0.75], [4.6, 0.6], [0, 0.6]].map(([x, y]) => new Vector2(x, y));
    const bowl = new Mesh(new LatheGeometry(profile, 72), steel);
    bowl.castShadow = bowl.receiveShadow = true;
    const bedMap = ashBedTexture();
    this.textures.push(bedMap);
    const bed = new Mesh(new CircleGeometry(BED_RADIUS + 0.02, 48), new MeshStandardMaterial({ map: bedMap, roughness: 1 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = BED_Y;
    bed.receiveShadow = true;
    this.tray.add(bowl, bed);
    this.scene.add(this.tray);
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    // Pull back on narrow screens so the cigarette and the tray both stay in frame.
    const distance = Math.min(2, Math.max(1, 1 / this.camera.aspect));
    const look = new Vector3(0.4, 7.3, 0.5);
    this.camera.position.copy(look).add(new Vector3(4.5, 4.8, 19.5).multiplyScalar(distance));
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    this.smoke.setScale(this.renderer.getDrawingBufferSize(new Vector2()).y, this.camera.fov);
  }

  private frame(dt: number) {
    this.burned += (this.target - this.burned) * Math.min(1, dt * 14);
    let ash = (this.burned - this.ashFrom) * 0.92;
    if (ash > this.ashBreak) { this.dropAsh(ash); ash = 0; }
    this.glow *= Math.exp(-dt * 2.6);
    this.cigarette.set(this.burned, ash);
    this.cigarette.setGlow(this.glow);
    this.breathe(dt);
    for (const step of [...this.steps]) if (!step(dt)) this.steps.delete(step);
    this.smoke.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** The sidestream from the tip, thicker during a drag, and the exhale a beat after the drags stop. */
  private breathe(dt: number) {
    const tip = this.cigarette.tip();
    this.emitDebt += dt * (70 + this.glow * 80);
    const n = Math.floor(this.emitDebt);
    this.emitDebt -= n;
    this.smoke.emit({ at: tip, velocity: new Vector3(0, 1.4, 0), spread: 0.06, life: [3.4, 5], size: [0.12, 1.8, 3.2], alpha: [0.13, 0.22], tone: 0 }, n);

    this.sincePuff += dt;
    if (this.drawn && this.sincePuff > 0.5) { this.exhaling += Math.min(70, 10 + this.drawn * 7); this.drawn = 0; }
    if (this.exhaling > 0) {
      const forward = this.camera.getWorldDirection(new Vector3());
      const mouth = this.camera.position.clone().addScaledVector(forward, 9).add(new Vector3(0, -3.5, 0));
      const count = Math.min(this.exhaling, Math.ceil(dt * 110));
      this.exhaling -= count;
      this.smoke.emit({ at: mouth, velocity: forward.multiplyScalar(8).add(new Vector3(0, 1.4, 0)), spread: 2.2, life: [2, 3.2], size: [1.2, 6, 10], alpha: [0.05, 0.11], tone: 1 }, count);
    }
  }

  /** The ash breaks off and drops straight down into the tray, where it settles flat. */
  private dropAsh(length: number) {
    this.ashFrom = this.burned;
    this.ashBreak = 0.9 + Math.random() * 0.7;
    const chunk = new Mesh(new CylinderGeometry(RADIUS * 0.82, RADIUS * 0.95, length, 16), this.materials.ash);
    chunk.castShadow = true;
    const local = this.cigarette.ashCenter(length);
    this.cigarette.group.localToWorld(chunk.position.copy(local));
    chunk.quaternion.copy(this.cigarette.group.quaternion);
    this.scene.add(chunk);
    const floorY = BED_Y + 0.12 + Math.random() * 0.1;
    // Keep it in the bowl even when the tip has drifted toward the rim.
    const flat = new Vector2(chunk.position.x, chunk.position.z);
    if (flat.length() > BED_RADIUS - 0.8) flat.setLength(BED_RADIUS - 0.8);
    let velocity = 0;
    this.steps.add(dt => {
      velocity += 980 * dt;
      chunk.position.y -= velocity * dt;
      chunk.position.x += (flat.x - chunk.position.x) * Math.min(1, dt * 10);
      chunk.position.z += (flat.y - chunk.position.z) * Math.min(1, dt * 10);
      if (chunk.position.y > floorY) return true;
      chunk.position.y = floorY;
      chunk.quaternion.setFromAxisAngle(new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), Math.PI / 2);
      chunk.scale.set(1.2, 0.85, 0.5);
      chunk.material = this.materials.stubbed;
      this.smoke.emit({ at: chunk.position, velocity: new Vector3(0, 0.6, 0), spread: 0.8, life: [0.6, 1.2], size: [0.6, 1.6, 2.4], alpha: [0.08, 0.14], tone: 1 }, 6);
      this.debris.push(chunk);
      if (this.debris.length > 40) { const old = this.debris.shift()!; old.removeFromParent(); (old as Mesh).geometry.dispose(); }
      return false;
    });
  }

  /** Lifts the finished stub off the cigarette and stubs it out on the pile in the tray. */
  private dropButt() {
    const butt = makeButt(this.materials);
    butt.position.copy(this.cigarette.group.position);
    butt.quaternion.copy(this.cigarette.group.quaternion);
    this.scene.add(butt);
    const slot = buttSlot(this.butts++);
    // Stubbed out where it lands: roughly filter-out, stubbed end in, but never in a neat ring.
    const jitter = 0.7 + Math.random() * 0.6;
    slot.x *= jitter; slot.z *= jitter;
    const inward = new Vector3(-slot.x, 0, -slot.z).normalize().applyAxisAngle(UP, (Math.random() - 0.5) * 2.2);
    const lift = 0.1 + Math.min(slot.layer, 3) * 0.06;
    const direction = inward.clone().setY(lift).normalize();
    const length = FILTER + STUB;
    const center = new Vector3(slot.x, BED_Y + RADIUS * 0.9 + slot.layer * RADIUS * 1.6, slot.z);
    const end: Pose = { position: center.addScaledVector(direction, -length / 2), quaternion: new Quaternion().setFromUnitVectors(UP, direction) };
    const start: Pose = { position: butt.position.clone(), quaternion: butt.quaternion.clone() };
    let t = 0;
    this.steps.add(dt => {
      t = Math.min(1, t + dt / 0.55);
      const k = ease(t);
      butt.position.lerpVectors(start.position, end.position, k).y += Math.sin(Math.PI * t) * 2.2;
      butt.quaternion.slerpQuaternions(start.quaternion, end.quaternion, k);
      if (t < 1) return true;
      this.smoke.emit({ at: end.position.clone().addScaledVector(direction, length), velocity: new Vector3(0, 0.8, 0), spread: 0.5, life: [1.2, 2.2], size: [0.4, 2.5, 3.5], alpha: [0.1, 0.18], tone: 0 }, 10);
      return false;
    });
  }

  /** The next cigarette comes up from the pack and catches. */
  private lightNext() {
    const group = this.cigarette.group;
    const from = this.rest.position.clone().add(new Vector3(2.5, -4, 3));
    let t = 0;
    group.position.copy(from);
    this.steps.add(dt => {
      t = Math.min(1, t + dt / 0.35);
      group.position.lerpVectors(from, this.rest.position, ease(t));
      if (t < 1) return true;
      this.glow = 1.4;
      return false;
    });
  }
}

class Cigarette {
  readonly group = new Group();
  private readonly paper: Mesh;
  private readonly char: Mesh;
  private readonly ember: Mesh;
  private readonly ash: Mesh;
  private readonly halo: Sprite;
  private readonly light = new PointLight(0xff6a20, 0, 0, 2);
  private readonly embers: MeshStandardMaterial;

  constructor(materials: Materials, glow: Texture) {
    const filter = new Mesh(new CylinderGeometry(RADIUS, RADIUS, FILTER, 40).translate(0, FILTER / 2, 0), materials.filter);
    this.paper = new Mesh(new CylinderGeometry(RADIUS, RADIUS, 1, 40, 1, true).translate(0, 0.5, 0), materials.paper);
    this.paper.position.y = FILTER;
    this.char = new Mesh(new CylinderGeometry(RADIUS * 1.004, RADIUS * 1.004, CHAR, 40, 1, true).translate(0, CHAR / 2, 0), materials.char);
    this.ember = new Mesh(new CylinderGeometry(RADIUS * 0.9, RADIUS * 0.99, EMBER, 40).translate(0, EMBER / 2, 0), materials.ember);
    this.ash = new Mesh(new CylinderGeometry(RADIUS * 0.8, RADIUS * 0.96, 1, 40).translate(0, 0.5, 0), materials.ash);
    for (const mesh of [filter, this.paper, this.char, this.ember, this.ash]) mesh.castShadow = true;
    this.embers = materials.ember;
    this.halo = new Sprite(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    this.halo.renderOrder = 11;
    this.group.add(filter, this.paper, this.char, this.ember, this.ash, this.halo, this.light);
  }

  /** Shortens the rod by `burned` cm and grows `ash` cm of ash past the ember. */
  set(burned: number, ash: number) {
    const rod = ROD - burned;
    this.paper.scale.y = rod;
    (this.paper.material as MeshStandardMaterial).map!.repeat.y = rod / ROD;
    const end = FILTER + rod;
    this.char.position.y = end - 0.02;
    this.ember.position.y = end + CHAR - 0.06;
    this.ash.position.y = end + CHAR + EMBER - 0.08;
    this.ash.scale.y = Math.max(0.02, ash);
    this.ash.visible = ash > 0.01;
    const embers = this.ember.position.y + EMBER * 0.6;
    this.halo.position.set(0, embers, 0);
    this.light.position.set(0, embers + 0.3, 0);
  }

  setGlow(glow: number) {
    const flicker = 0.92 + Math.random() * 0.08;
    this.embers.emissiveIntensity = (1.4 + glow * 4) * flicker;
    this.halo.scale.setScalar((1.1 + glow * 1.6) * flicker);
    (this.halo.material as SpriteMaterial).opacity = 0.45 + glow * 0.5;
    this.light.intensity = (3 + glow * 14) * flicker;
  }

  /** The burning end in world space, where the sidestream leaves. */
  tip() {
    const top = this.ash.visible ? this.ash.position.y + Math.min(this.ash.scale.y, 0.4) : this.ember.position.y + EMBER;
    return this.group.localToWorld(new Vector3(0, top, 0));
  }

  ashCenter(length: number) {
    return new Vector3(0, this.ash.position.y + length / 2, 0);
  }
}

/** A stubbed-out butt: the filter and a crumpled, charred stub, in the cigarette's own frame. */
function makeButt(materials: Materials) {
  const butt = new Group();
  const filter = new Mesh(new CylinderGeometry(RADIUS, RADIUS, FILTER, 32).translate(0, FILTER / 2, 0), materials.filter);
  const paper = materials.paper.clone();
  paper.map = materials.paper.map!.clone();
  paper.map.repeat.y = STUB / ROD;
  // Smoke-stained and scorched toward the burnt end.
  paper.color.set(0xd2c3a2);
  const stub = new Mesh(new CylinderGeometry(RADIUS * 0.93, RADIUS, STUB, 32, 1, true).translate(0, STUB / 2, 0), paper);
  stub.position.y = FILTER;
  stub.scale.set(1, 1, 0.82);
  // Crushed out: a squashed, blackened end bent a little off the axis.
  const crushed = new Mesh(new CylinderGeometry(RADIUS * 0.5, RADIUS * 0.93, 0.22, 24).translate(0, 0.11, 0), materials.stubbed);
  crushed.position.y = FILTER + STUB - 0.02;
  crushed.rotation.z = (Math.random() - 0.5) * 0.7;
  crushed.scale.set(1.15, 1, 0.6);
  for (const mesh of [filter, stub, crushed]) mesh.castShadow = mesh.receiveShadow = true;
  butt.add(filter, stub, crushed);
  return butt;
}
