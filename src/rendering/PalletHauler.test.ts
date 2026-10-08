import { describe, expect, it, vi } from 'vitest';
import { Bone, BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Scene, Skeleton, SkinnedMesh } from 'three';
import {
  createHauler,
  createProceduralHauler,
  createSpriteHauler,
  getHaulerRenderMode,
  instantiateHaulerModel,
  setHaulerRenderMode,
  startHaul,
} from './PalletHauler';

/** A minimal stand-in for the loaded GLB: forks carrying a display pallet, and a skinned operator. */
function fakeGlbScene() {
  const root = new Group();
  const forks = new Group();
  forks.name = 'forks';
  const payload = new Group();
  payload.name = 'pallet-payload';
  forks.add(payload);
  const bone = new Bone();
  bone.name = 'Hips';
  const geometry = new BoxGeometry(1, 1, 1);
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const operator = new SkinnedMesh(geometry, new MeshStandardMaterial());
  operator.name = 'operator';
  operator.add(bone);
  operator.bind(new Skeleton([bone]));
  root.add(forks, operator, new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
  return root;
}

describe('PalletHauler', () => {
  it('defaults to model mode and allows toggling', () => {
    setHaulerRenderMode('model');
    expect(getHaulerRenderMode()).toBe('model');
    const hauler = createHauler();
    expect(hauler).toBeInstanceOf(Group);
    setHaulerRenderMode('sprite');
    expect(getHaulerRenderMode()).toBe('sprite');
    setHaulerRenderMode('procedural');
    expect(getHaulerRenderMode()).toBe('procedural');
  });

  it('creates procedural hauler with forks group and operator', () => {
    const hauler = createProceduralHauler();
    expect(hauler).toBeInstanceOf(Group);
    expect(hauler.name).toBe('pallet-hauler');
    const forks = hauler.getObjectByName('forks');
    expect(forks).toBeDefined();
    expect(forks).toBeInstanceOf(Group);
    const operator = hauler.getObjectByName('operator');
    expect(operator).toBeDefined();
  });

  it('instantiates the GLB rig with its own skeleton and without the display pallet', () => {
    const source = fakeGlbScene();
    const hauler = instantiateHaulerModel(source);
    expect(hauler.name).toBe('pallet-hauler');
    expect(hauler.userData.sharedResources).toBe(true);
    expect(hauler.getObjectByName('pallet-payload')).toBeUndefined();
    expect(source.getObjectByName('pallet-payload')).toBeDefined();
    const operator = hauler.getObjectByName('operator') as SkinnedMesh;
    const original = source.getObjectByName('operator') as SkinnedMesh;
    expect(operator.skeleton.bones[0]).not.toBe(original.skeleton.bones[0]);
    expect(hauler.getObjectById(operator.skeleton.bones[0].id)).toBeDefined();
    expect(operator.geometry).toBe(original.geometry);
  });

  it('creates sprite hauler with forks group', () => {
    const hauler = createSpriteHauler();
    expect(hauler).toBeInstanceOf(Group);
    expect(hauler.name).toBe('pallet-hauler');
    const forks = hauler.getObjectByName('forks');
    expect(forks).toBeDefined();
  });

  it('runs depart haul stepper through completion', () => {
    const scene = new Scene();
    const rig = new Group();
    scene.add(rig);
    const onDone = vi.fn();

    const step = startHaul('depart', rig, scene, onDone, 'procedural');
    expect(typeof step).toBe('function');

    // Simulate animation timeline: total is ~5.2s
    step(1.0); // time = 1.0 (driving in)
    expect(onDone).not.toHaveBeenCalled();

    step(1.5); // time = 2.5 (lifting)
    expect(onDone).not.toHaveBeenCalled();

    step(2.0); // time = 4.5 (driving away)
    expect(onDone).not.toHaveBeenCalled();

    step(1.0); // time = 5.5 (finished, total is 5.2s)
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('runs arrive haul stepper through completion', () => {
    const scene = new Scene();
    const rig = new Group();
    scene.add(rig);
    const onDone = vi.fn();

    const step = startHaul('arrive', rig, scene, onDone, 'procedural');
    step(5.5);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
