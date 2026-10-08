import {
  AnimationClip, AnimationMixer, Box3, Group, MathUtils, Matrix4, Quaternion, SkinnedMesh, Vector3,
  type AnimationAction, type Bone, type Object3D,
} from 'three';
import { FLOOR_Y } from '../scene/coordinates';
import { instantiateHaulerModel, type HaulerClips } from './PalletHauler';

/**
 * The GLB hauler's life between pallets (Mode 2): it waits parked behind the pallet with Austin standing
 * beside it. When a pallet ships he walks over and steps onto the rear platform, backs the truck out of
 * its spot onto the haul lane, drives under the pallet, lifts it and backs out of the scene. The next run
 * starts with the truck driving back in carrying a fresh empty pallet; it sets it down, returns to its
 * spot and Austin steps off and walks back to where he waits.
 *
 * Austin's motion is a hybrid: Meshy clips (idle and walk on foot; an upper-body breathe-and-look clip
 * while riding) plus code (stepping on and off, leaning with the truck's acceleration, and two-bone IK
 * that keeps his hands on the tiller grip and steering knob while his torso moves).
 */

/** Hauler origin (fork heels) poses on the floor, scene inches; yaw 0 points the forks along +X. */
interface FloorPose { x: number; z: number; yaw: number }
/** Forks fully under a pallet centred on the scene origin. */
const PICK: FloorPose = { x: -22, z: 0, yaw: 0 };
/** On the haul lane, clear of the pallet, where the truck turns into or out of its parking spot. */
const STAGE: FloorPose = { x: -110, z: 0, yaw: 0 };
const OFFSCENE: FloorPose = { x: -250, z: 0, yaw: 0 };
/** Parked behind the pallet (away from the iso camera), clear of the pallet and the conveyor. */
export const PARK: FloorPose = { x: -14, z: -64, yaw: 0 };
/** Where Austin waits, beside the parked truck's rear, facing the pallet (and so the camera). */
const STAND = { x: -40, z: -34, yaw: Math.atan2(40, 34) };
/** What he watches while waiting: the load on the pallet. */
const LOOK_TARGET = new Vector3(0, FLOOR_Y + 22, 0);
/** Share of the idle clip's motion kept while he waits: enough to breathe and shift, not to fidget. */
const IDLE_MOTION = 0.2;
/** How far his head will turn toward the look target. */
const MAX_LOOK = MathUtils.degToRad(55);
/** Just behind the truck's open rear step, in hauler-local inches. */
const ENTRY_LOCAL = new Vector3(-51, 0, 5);
/** Fork travel when lifting a pallet. The model's forks already sit at the pallet's opening top. */
const LIFT = 3;
const WALK_SPEED = 50; // inches per second, a brisk walk
/** Keep the parking spot and Austin in the camera's framing. */
export const YARD_BOUNDS = new Box3(new Vector3(-68, FLOOR_Y, -86), new Vector3(36, 75, -26));

/** S-curve between the parking spot and the haul lane (cubic Bezier through the origin positions). */
const PARK_TO_STAGE: [Vector3, Vector3, Vector3, Vector3] = [
  new Vector3(PARK.x, 0, PARK.z), new Vector3(PARK.x - 46, 0, PARK.z), new Vector3(STAGE.x + 40, 0, STAGE.z), new Vector3(STAGE.x, 0, STAGE.z),
];
const STAGE_TO_PARK = [...PARK_TO_STAGE].reverse() as typeof PARK_TO_STAGE;

const UPPER_BODY = ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'];
/** Bones straightened toward the bind pose while standing, and by how much. */
const UPRIGHT = ['Spine', 'Spine01', 'Spine02', 'neck'];
const STRAIGHTEN = 0.7;
const ARM_SIDES = ['Right', 'Left'] as const;
const ease = (t: number) => t * t * (3 - 2 * t);
const Y_AXIS = new Vector3(0, 1, 0);
const yawQuat = (yaw: number) => new Quaternion().setFromAxisAngle(Y_AXIS, yaw);

function bezier(p: readonly Vector3[], t: number) {
  const u = 1 - t;
  return p[0].clone().multiplyScalar(u * u * u).addScaledVector(p[1], 3 * u * u * t).addScaledVector(p[2], 3 * u * t * t).addScaledVector(p[3], t * t * t);
}
function bezierTangent(p: readonly Vector3[], t: number) {
  const u = 1 - t;
  return p[1].clone().sub(p[0]).multiplyScalar(3 * u * u)
    .addScaledVector(p[2].clone().sub(p[1]), 6 * u * t)
    .addScaledVector(p[3].clone().sub(p[2]), 3 * t * t);
}
/** Yaw that points the forks (+X) along `forward`. */
const yawOf = (forward: Vector3) => Math.atan2(-forward.z, forward.x);

/**
 * A quieter copy of a clip: every keyframe is pulled toward that track's average pose, keeping only
 * `amount` of its motion (0 = frozen in the average pose, 1 = unchanged).
 */
export function calmClip(clip: AnimationClip, amount: number) {
  const tracks = clip.tracks.map(source => {
    const track = source.clone();
    const values = track.values;
    const size = track.getValueSize();
    const frames = values.length / size;
    if (frames < 2 || (size !== 3 && size !== 4)) return track;
    const mean = new Array<number>(size).fill(0);
    for (let i = 0; i < values.length; i += size) {
      // Quaternions q and -q are the same rotation; average them on one hemisphere.
      const sign = size === 4 && values[i] * values[0] + values[i + 1] * values[1] + values[i + 2] * values[2] + values[i + 3] * values[3] < 0 ? -1 : 1;
      for (let k = 0; k < size; k++) mean[k] += sign * values[i + k] / frames;
    }
    if (size === 4) {
      const average = new Quaternion().fromArray(mean).normalize();
      const frame = new Quaternion();
      for (let i = 0; i < values.length; i += 4) {
        frame.fromArray(values, i);
        average.clone().slerp(frame, amount).toArray(values, i);
      }
    } else {
      for (let i = 0; i < values.length; i += 3) for (let k = 0; k < 3; k++) values[i + k] = MathUtils.lerp(mean[k], values[i + k], amount);
    }
    return track;
  });
  return new AnimationClip(`${clip.name}-calm`, clip.duration, tracks);
}

interface Segment { duration: number; start?: () => void; update?: (t: number) => void; end?: () => void }

/** Runs segments back to back; a segment's start() may queue follow-ups with `next`. */
class Timeline {
  private queue: Segment[] = [];
  private current?: Segment;
  private elapsed = 0;
  get busy() { return !!this.current || this.queue.length > 0; }
  push(...segments: Segment[]) { this.queue.push(...segments); }
  /** Queue segments to run right after the current one, ahead of anything already queued. */
  next(...segments: Segment[]) { this.queue.unshift(...segments); }
  clearPending() { this.queue = []; }
  step(dt: number) {
    let remaining = dt;
    while (remaining >= 0) {
      if (!this.current) {
        const segment = this.queue.shift();
        if (!segment) return;
        this.current = segment;
        this.elapsed = 0;
        segment.start?.();
      }
      const segment = this.current;
      this.elapsed += remaining;
      if (this.elapsed < segment.duration) { segment.update?.(this.elapsed / segment.duration); return; }
      segment.update?.(1);
      remaining = this.elapsed - segment.duration;
      this.current = undefined;
      segment.end?.();
      if (remaining === 0 && !this.queue.length) return;
    }
  }
}

interface ArmIk { up: Bone; fore: Bone; hand: Bone; a: number; b: number; wrist: Vector3; elbow: Vector3; handQ: Quaternion }

export class HaulerYard {
  readonly root = new Group();
  readonly hauler: Group;
  private readonly forks?: Object3D;
  private readonly operator: Object3D;
  private readonly seatPosition: Vector3;
  private readonly seatQuaternion: Quaternion;
  private readonly bones: Bone[] = [];
  private readonly holdPose = new Map<Bone, Quaternion>();
  private readonly holdHips: Vector3;
  private readonly relaxedFingers = new Map<Bone, Quaternion>();
  private readonly upright = new Map<Bone, Quaternion>();
  private readonly arms: ArmIk[];
  private readonly mixer: AnimationMixer;
  private readonly actions: { idle: AnimationAction; walk: AnimationAction; ride: AnimationAction };
  private readonly timeline = new Timeline();
  private riding = false;
  private blend?: { from: Map<Bone, Quaternion>; t: number; duration: number };
  private readonly headBones: { neck?: Bone; head?: Bone; headFront?: Object3D };
  private look = 0;
  private lookTime = 0;
  private lean = 0;
  private lastSpeed = 0;
  private lastPosition = new Vector3();

  constructor(parent: Object3D, model: Object3D, clips: HaulerClips) {
    this.hauler = instantiateHaulerModel(model);
    this.root.name = 'hauler-yard';
    this.root.add(this.hauler);
    parent.add(this.root);
    this.forks = this.hauler.getObjectByName('forks');
    const operator = this.hauler.getObjectByName('operator');
    let skinned: SkinnedMesh | undefined;
    operator?.traverse(o => { if (o instanceof SkinnedMesh && !skinned) skinned = o; });
    if (!operator || !skinned) throw new Error('hauler model has no rigged operator');
    this.operator = operator;
    this.seatPosition = operator.position.clone();
    this.seatQuaternion = operator.quaternion.clone();
    operator.traverse(o => { if ((o as Bone).isBone) this.bones.push(o as Bone); });
    for (const bone of this.bones) this.holdPose.set(bone, bone.quaternion.clone());
    const hips = this.bone('Hips');
    this.holdHips = hips.position.clone();
    // Meshy rigs end the head chain with a `headfront` marker in front of the face.
    const find = (name: string) => this.bones.find(b => b.name === name);
    this.headBones = { neck: find('neck'), head: find('Head'), headFront: operator.getObjectByName('headfront') };

    // Fingers are curled round the controls in the authored pose; on foot they relax most of the way
    // back to their bind pose (derived from the skeleton's inverse bind matrices).
    const { skeleton } = skinned;
    const bindWorld = (bone: Bone) => new Matrix4().copy(skeleton.boneInverses[skeleton.bones.indexOf(bone)]).invert();
    const bindLocal = (bone: Bone) => new Quaternion().setFromRotationMatrix(bindWorld(bone.parent as Bone).invert().multiply(bindWorld(bone)));
    for (const bone of this.bones) {
      if (!skeleton.bones.includes(bone) || !skeleton.bones.includes(bone.parent as Bone)) continue;
      if (/Hand(Thumb|Index|Middle|Ring|Pinky)\d$/.test(bone.name)) this.relaxedFingers.set(bone, bindLocal(bone).slerp(this.holdPose.get(bone)!, 0.3));
      // The idle clip slouches; the bind pose stands straight.
      if (UPRIGHT.includes(bone.name)) this.upright.set(bone, bindLocal(bone));
    }

    // Hand targets on the controls, in the hauler's frame (the hauler is at its origin here).
    this.hauler.updateMatrixWorld(true);
    const toLocal = new Matrix4().copy(this.hauler.matrixWorld).invert();
    this.arms = ARM_SIDES.map(side => {
      const up = this.bone(`${side}Arm`), fore = this.bone(`${side}ForeArm`), hand = this.bone(`${side}Hand`);
      const s = up.getWorldPosition(new Vector3()), e = fore.getWorldPosition(new Vector3()), w = hand.getWorldPosition(new Vector3());
      return {
        up, fore, hand, a: s.distanceTo(e), b: e.distanceTo(w),
        wrist: w.applyMatrix4(toLocal), elbow: e.applyMatrix4(toLocal),
        handQ: new Quaternion().setFromRotationMatrix(toLocal).multiply(hand.getWorldQuaternion(new Quaternion())),
      };
    });

    this.mixer = new AnimationMixer(operator);
    const upper = clips.ride.tracks.filter(track => {
      const [node, property] = track.name.split('.');
      return property === 'quaternion' && UPPER_BODY.includes(node);
    });
    this.actions = {
      // Meshy's idle fidgets a lot (hips and head swing ~55°); keep a fifth of it, a little slower.
      idle: this.mixer.clipAction(calmClip(clips.idle, IDLE_MOTION)).setEffectiveTimeScale(0.8),
      walk: this.mixer.clipAction(clips.walk),
      ride: this.mixer.clipAction(new AnimationClip(`${clips.ride.name}-upper`, clips.ride.duration, upper)),
    };
  }

  /** The truck parked in its spot and Austin waiting beside it. */
  park() {
    this.teleport(PARK);
    this.standAt(STAND.x, STAND.z, STAND.yaw);
  }

  /**
   * The truck drives in from off-scene carrying `rig` (the new pallet), sets it down — `onPalletDown`
   * fires then, so play can resume — and goes back to park.
   */
  arrive(rig: Object3D, onPalletDown: () => void) {
    this.teleport(OFFSCENE);
    this.sitOnTruck();
    this.setLift(rig, LIFT);
    this.timeline.push(
      this.carryAlongLane(rig, OFFSCENE.x, PICK.x, 1.8, LIFT),
      { duration: 0.55, update: t => this.setLift(rig, LIFT * (1 - ease(t))), end: onPalletDown },
      this.driveLane(PICK.x, STAGE.x, 1.2),
      this.drivePath(STAGE_TO_PARK, 2.0, false),
      this.stepOff(),
      this.walkTo(STAND.x, STAND.z, STAND.yaw),
    );
  }

  /** Austin boards, the truck collects `rig` (the shipped pallet) and leaves the scene; then `onDone`. */
  depart(rig: Object3D, onDone: () => void) {
    // If the truck hasn't finished parking yet, cut its remaining plan short and go from wherever it is.
    this.timeline.clearPending();
    this.timeline.push({
      duration: 0,
      start: () => {
        // Planned now, from wherever Austin and the truck actually are.
        const plan: Segment[] = [];
        if (!this.riding) {
          this.hauler.updateMatrixWorld(true);
          const entry = this.hauler.localToWorld(ENTRY_LOCAL.clone());
          plan.push(this.walkTo(entry.x, entry.z, this.hauler.rotation.y + Math.PI / 2, 0.15), this.stepOn());
        }
        const onLane = Math.abs(this.hauler.position.z) < 1 && Math.abs(this.hauler.rotation.y) < 0.01;
        // Ship to next run is about 6 s: the conveyor is frozen meanwhile, so keep the wait short.
        if (!onLane) plan.push(this.drivePath(PARK_TO_STAGE, 1.6, true));
        plan.push(
          this.driveLane(onLane ? this.hauler.position.x : STAGE.x, PICK.x, 1.1),
          { duration: 0.5, update: t => this.setLift(rig, LIFT * ease(t)) },
          this.carryAlongLane(rig, PICK.x, OFFSCENE.x, 1.3, LIFT),
          { duration: 0, end: onDone },
        );
        this.timeline.next(...plan);
      },
    });
  }

  step(dt: number) {
    this.timeline.step(dt);
    this.animateOperator(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.operator);
    this.root.removeFromParent();
  }

  // ---------------------------------------------------------------- truck motion

  private placeHauler(pose: FloorPose) {
    this.hauler.position.set(pose.x, FLOOR_Y, pose.z);
    this.hauler.rotation.set(0, pose.yaw, 0);
  }

  /** Place the truck without implying motion (resets the lean's speed tracking). */
  private teleport(pose: FloorPose) {
    this.placeHauler(pose);
    this.lastPosition.copy(this.hauler.position);
    this.lastSpeed = 0;
  }

  private setLift(rig: Object3D, height: number) {
    if (this.forks) this.forks.position.y = height;
    rig.position.y = height;
  }

  private driveLane(fromX: number, toX: number, duration: number): Segment {
    return { duration, update: t => this.placeHauler({ x: MathUtils.lerp(fromX, toX, ease(t)), z: 0, yaw: 0 }) };
  }

  /** Along the lane with the pallet on the forks; the pallet rides with them. */
  private carryAlongLane(rig: Object3D, fromX: number, toX: number, duration: number, height: number): Segment {
    return {
      duration,
      update: t => {
        const x = MathUtils.lerp(fromX, toX, ease(t));
        this.placeHauler({ x, z: 0, yaw: 0 });
        rig.position.set(x - PICK.x, height, 0);
      },
    };
  }

  /** Follow a Bezier path; `reverse` backs along it (the forks keep pointing opposite to travel). */
  private drivePath(path: typeof PARK_TO_STAGE, duration: number, reverse: boolean): Segment {
    return {
      duration,
      update: t => {
        const s = ease(t);
        const p = bezier(path, s);
        const tangent = bezierTangent(path, Math.min(0.999, Math.max(0.001, s)));
        this.placeHauler({ x: p.x, z: p.z, yaw: yawOf(reverse ? tangent.negate() : tangent) });
      },
    };
  }

  // ---------------------------------------------------------------- Austin on foot

  private standAt(x: number, z: number, yaw: number) {
    this.root.attach(this.operator);
    this.operator.position.set(x, FLOOR_Y, z);
    this.operator.quaternion.copy(yawQuat(yaw));
    this.setRiding(false, 0);
    this.actions.walk.stop();
    this.actions.idle.reset().play();
  }

  private sitOnTruck() {
    this.hauler.add(this.operator);
    this.operator.position.copy(this.seatPosition);
    this.operator.quaternion.copy(this.seatQuaternion);
    this.setRiding(true, 0);
  }

  /** Walk to (x, z) and turn to `finalYaw` over `turnSeconds`. */
  private walkTo(x: number, z: number, finalYaw: number, turnSeconds = 0.35): Segment {
    let from = new Vector3(), heading = 0;
    const to = new Vector3(x, FLOOR_Y, z);
    const distance = () => from.distanceTo(to);
    return {
      duration: 0,
      start: () => {
        from = this.operator.getWorldPosition(new Vector3());
        heading = Math.atan2(to.x - from.x, to.z - from.z);
        const walk = this.actions.walk.reset().play();
        this.actions.idle.crossFadeTo(walk, 0.25, false);
        this.timeline.next(
          {
            duration: Math.max(0.3, distance() / WALK_SPEED),
            update: t => {
              this.operator.position.lerpVectors(from, to, t);
              this.operator.quaternion.slerp(yawQuat(heading), Math.min(1, t * 6));
            },
          },
          {
            duration: turnSeconds,
            start: () => {
              const idle = this.actions.idle.reset().play();
              this.actions.walk.crossFadeTo(idle, 0.3, false);
            },
            update: t => this.operator.quaternion.slerpQuaternions(yawQuat(heading), yawQuat(finalYaw), ease(t)),
          },
        );
      },
    };
  }

  /** Up onto the rear platform and into the driving pose. */
  private stepOn(): Segment {
    let fromPosition = new Vector3(), fromQuaternion = new Quaternion();
    return {
      duration: 0.4,
      start: () => {
        this.hauler.attach(this.operator);
        fromPosition = this.operator.position.clone();
        fromQuaternion = this.operator.quaternion.clone();
        this.setRiding(true, 0.45);
      },
      update: t => {
        const s = ease(t);
        this.operator.position.lerpVectors(fromPosition, this.seatPosition, s);
        this.operator.position.y += Math.sin(Math.PI * t) * 4;
        this.operator.quaternion.slerpQuaternions(fromQuaternion, this.seatQuaternion, s);
      },
    };
  }

  /** Down off the rear platform onto the floor behind the truck, facing away from it. */
  private stepOff(): Segment {
    const exitQuaternion = yawQuat(-Math.PI / 2); // facing the truck's -X (out of the rear)
    return {
      duration: 0.5,
      start: () => this.setRiding(false, 0.45),
      update: t => {
        const s = ease(t);
        this.operator.position.lerpVectors(this.seatPosition, ENTRY_LOCAL, s);
        this.operator.position.y += Math.sin(Math.PI * t) * 4;
        this.operator.quaternion.slerpQuaternions(this.seatQuaternion, exitQuaternion, s);
      },
      end: () => this.root.attach(this.operator),
    };
  }

  // ---------------------------------------------------------------- Austin's pose each frame

  private bone(name: string) {
    const bone = this.bones.find(b => b.name === name);
    if (!bone) throw new Error(`operator rig has no ${name} bone`);
    return bone;
  }

  /** Switch between riding (grip pose + upper-body clip) and on foot (idle/walk clips), blending over `seconds`. */
  private setRiding(riding: boolean, seconds: number) {
    const from = new Map(this.bones.map(b => [b, b.quaternion.clone()] as const));
    this.riding = riding;
    if (riding) {
      this.actions.idle.stop();
      this.actions.walk.stop();
      this.actions.ride.reset().play();
    } else {
      this.actions.ride.stop();
      if (!this.actions.walk.isRunning()) this.actions.idle.reset().play();
    }
    this.blend = seconds > 0 ? { from, t: 0, duration: seconds } : undefined;
  }

  private animateOperator(dt: number) {
    if (this.riding) {
      for (const [bone, q] of this.holdPose) bone.quaternion.copy(q);
      this.bone('Hips').position.copy(this.holdHips);
    }
    this.mixer.update(dt);
    if (this.riding) {
      this.leanWithTruck(dt);
      this.operator.updateMatrixWorld(true);
      this.arms.forEach(arm => this.solveArm(arm));
    } else {
      for (const [bone, q] of this.relaxedFingers) bone.quaternion.copy(q);
      for (const [bone, q] of this.upright) bone.quaternion.slerp(q, STRAIGHTEN);
    }
    // Watch the pallet while standing; look where he's going while walking or riding.
    const walking = this.actions.walk.isRunning() ? this.actions.walk.getEffectiveWeight() : 0;
    const want = this.riding ? 0 : 1 - walking;
    this.look += (want - this.look) * Math.min(1, dt * 3);
    if (this.look > 0.01) this.watchPallet(dt);
    if (this.blend) {
      this.blend.t += dt;
      const k = ease(Math.min(1, this.blend.t / this.blend.duration));
      const target = new Quaternion();
      for (const bone of this.bones) {
        target.copy(bone.quaternion);
        bone.quaternion.slerpQuaternions(this.blend.from.get(bone)!, target, k);
      }
      if (k >= 1) this.blend = undefined;
    }
  }

  /** Sway the spine with the truck's acceleration: Austin stands sideways, so inertia tips him toward the truck's rear as it speeds up and toward its front as it brakes. */
  private leanWithTruck(dt: number) {
    if (dt <= 0) return;
    const position = this.hauler.position;
    const forward = new Vector3(1, 0, 0).applyQuaternion(this.hauler.quaternion);
    const speed = position.clone().sub(this.lastPosition).dot(forward) / dt;
    const accel = (speed - this.lastSpeed) / dt;
    this.lastPosition.copy(position);
    this.lastSpeed = speed;
    const target = MathUtils.clamp(accel * 0.0005, -0.12, 0.12);
    this.lean += (target - this.lean) * Math.min(1, dt * 6);
    const spine = this.bone('Spine02');
    // Lean about the truck's sideways axis (its local Z).
    const axis = new Vector3(0, 0, 1).applyQuaternion(this.hauler.getWorldQuaternion(new Quaternion()));
    const world = new Quaternion().setFromAxisAngle(axis, this.lean).multiply(spine.getWorldQuaternion(new Quaternion()));
    spine.quaternion.copy(spine.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
  }

  /**
   * Turn the neck and head toward the pallet, his gaze drifting slowly over the load so he doesn't
   * look frozen. Blended by `this.look`.
   */
  private watchPallet(dt: number) {
    const { neck, head, headFront } = this.headBones;
    if (!head || !headFront) return;
    this.lookTime += dt;
    const t = this.lookTime;
    const target = LOOK_TARGET.clone().add(new Vector3(Math.sin(t * 0.37) * 7, Math.sin(t * 0.29) * 2, Math.sin(t * 0.23 + 1) * 5));
    this.operator.updateMatrixWorld(true);
    const turnToward = (bone: Bone, share: number) => {
      const eye = head.getWorldPosition(new Vector3());
      const facing = headFront.getWorldPosition(new Vector3()).sub(eye).normalize();
      const turn = new Quaternion().setFromUnitVectors(facing, target.clone().sub(eye).normalize());
      const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
      const k = share * this.look * (angle > MAX_LOOK ? MAX_LOOK / angle : 1);
      const world = new Quaternion().slerp(turn, k).multiply(bone.getWorldQuaternion(new Quaternion()));
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
      bone.updateMatrixWorld(true);
    };
    if (neck) turnToward(neck, 0.4);
    turnToward(head, 1);
  }

  private solveArm(arm: ArmIk) {
    const m = this.hauler.matrixWorld;
    const wrist = arm.wrist.clone().applyMatrix4(m);
    const hint = arm.elbow.clone().applyMatrix4(m);
    const s = arm.up.getWorldPosition(new Vector3());
    const d = Math.min(s.distanceTo(wrist), arm.a + arm.b - 1e-3);
    const u = wrist.clone().sub(s).normalize();
    const cosA = MathUtils.clamp((arm.a ** 2 + d ** 2 - arm.b ** 2) / (2 * arm.a * d), -1, 1);
    const pole = hint.sub(s);
    const p = pole.sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
    const elbow = s.clone().addScaledVector(u, arm.a * cosA).addScaledVector(p, arm.a * Math.sqrt(1 - cosA * cosA));
    aimBone(arm.up, arm.fore.getWorldPosition(new Vector3()), elbow);
    aimBone(arm.fore, arm.hand.getWorldPosition(new Vector3()), wrist);
    const handWorld = this.hauler.getWorldQuaternion(new Quaternion()).multiply(arm.handQ);
    arm.hand.quaternion.copy(arm.fore.getWorldQuaternion(new Quaternion()).invert().multiply(handWorld));
    arm.hand.updateMatrixWorld(true);
  }
}

/** Rotate `bone` in world space so the direction from it to `childNow` points at `target`. */
function aimBone(bone: Bone, childNow: Vector3, target: Vector3) {
  const p = bone.getWorldPosition(new Vector3());
  const turn = new Quaternion().setFromUnitVectors(childNow.clone().sub(p).normalize(), target.clone().sub(p).normalize());
  const parentWorld = bone.parent!.getWorldQuaternion(new Quaternion()).invert();
  bone.quaternion.copy(parentWorld.multiply(turn).multiply(bone.getWorldQuaternion(new Quaternion())));
  bone.updateMatrixWorld(true);
}
