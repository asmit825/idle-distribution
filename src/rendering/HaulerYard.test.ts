import { describe, expect, it, vi } from 'vitest';
import {
  AnimationClip, Bone, BoxGeometry, BufferAttribute, Group, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack,
  Scene, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack,
} from 'three';
import { HaulerYard, PARK, calmClip } from './HaulerYard';

/** A stand-in GLB rig: forks and an operator whose skeleton has the bones the yard drives. */
function fakeModel() {
  const root = new Group();
  const forks = new Group();
  forks.name = 'forks';
  const operator = new Group();
  operator.name = 'operator';
  operator.position.set(-35, 10, 5);
  root.add(forks, operator);
  const bone = (name: string, parent: Bone | Group, y: number) => {
    const b = new Bone();
    b.name = name;
    b.position.y = y;
    parent.add(b);
    return b;
  };
  const hips = bone('Hips', operator, 36);
  const spine = bone('Spine02', hips, 6);
  const bones = [hips, spine];
  for (const side of ['Right', 'Left']) {
    const arm = bone(`${side}Arm`, spine, 16);
    arm.position.x = side === 'Right' ? -7 : 7;
    const fore = bone(`${side}ForeArm`, arm, -11);
    const hand = bone(`${side}Hand`, fore, -10);
    bones.push(arm, fore, hand);
  }
  const geometry = new BoxGeometry(1, 1, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  operator.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return root;
}

const clips = () => ({ idle: new AnimationClip('idle', 1, []), walk: new AnimationClip('walk', 1, []), ride: new AnimationClip('ride', 1, []) });
const run = (yard: HaulerYard, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) yard.step(0.05); };

describe('HaulerYard', () => {
  it('parks the truck with Austin standing beside it, off the truck', () => {
    const scene = new Scene();
    const yard = new HaulerYard(scene, fakeModel(), clips());
    yard.park();
    expect(yard.hauler.position.x).toBeCloseTo(PARK.x);
    expect(yard.hauler.position.z).toBeCloseTo(PARK.z);
    expect(yard.hauler.getObjectByName('operator')).toBeUndefined();
    expect(yard.root.getObjectByName('operator')).toBeDefined();
  });

  it('boards, collects the shipped pallet and leaves the scene, then reports done', () => {
    const scene = new Scene();
    const yard = new HaulerYard(scene, fakeModel(), clips());
    yard.park();
    const rig = new Group();
    const onDone = vi.fn();
    yard.depart(rig, onDone);
    run(yard, 3);
    expect(yard.hauler.getObjectByName('operator')).toBeDefined(); // on board
    expect(onDone).not.toHaveBeenCalled();
    run(yard, 6);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(rig.position.y).toBeGreaterThan(0); // carried on raised forks
    expect(rig.position.x).toBeLessThan(-150); // out of the scene with the truck
  });

  it('delivers a new pallet, sets it down, then reparks and Austin steps off', () => {
    const scene = new Scene();
    const yard = new HaulerYard(scene, fakeModel(), clips());
    const rig = new Group();
    const onDown = vi.fn();
    yard.arrive(rig, onDown);
    run(yard, 2.5);
    expect(onDown).toHaveBeenCalledTimes(1);
    expect(rig.position.x).toBeCloseTo(0);
    expect(rig.position.y).toBeCloseTo(0);
    run(yard, 8);
    expect(yard.hauler.position.x).toBeCloseTo(PARK.x);
    expect(yard.hauler.position.z).toBeCloseTo(PARK.z);
    expect(yard.hauler.getObjectByName('operator')).toBeUndefined();
  });

  it('starts the haul from wherever the truck is if a pallet ships while it is still reparking', () => {
    const scene = new Scene();
    const yard = new HaulerYard(scene, fakeModel(), clips());
    yard.arrive(new Group(), () => {});
    run(yard, 3.2); // set down and driving back toward the parking spot, Austin still aboard
    const onDone = vi.fn();
    yard.depart(new Group(), onDone);
    run(yard, 9);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calms a fidgety idle clip toward its average pose', () => {
    const swing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1);
    const clip = new AnimationClip('idle', 2, [
      new QuaternionKeyframeTrack('Head.quaternion', [0, 1, 2], [0, 0, 0, 1, ...swing.toArray(), 0, 0, 0, 1]),
      new VectorKeyframeTrack('Hips.position', [0, 1], [0, 30, 0, 4, 30, 0]),
    ]);
    const calm = calmClip(clip, 0.2);
    const [head, hips] = calm.tracks;
    const angle = (i: number) => new Quaternion().fromArray(head.values, i * 4).angleTo(new Quaternion().fromArray(head.values, 4));
    expect(angle(0)).toBeCloseTo(0.2, 2); // 1 rad of swing, a fifth kept
    expect(hips.values[3] - hips.values[0]).toBeCloseTo(0.8);
    expect(clip.tracks[1].values[3]).toBe(4); // source untouched
  });

  it('removes itself from the scene on dispose', () => {
    const scene = new Scene();
    const yard = new HaulerYard(scene, fakeModel(), clips());
    yard.dispose();
    expect(scene.getObjectByName('hauler-yard')).toBeUndefined();
  });
});
