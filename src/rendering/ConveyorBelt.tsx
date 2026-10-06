import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  Box3, BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  RepeatWrapping, SphereGeometry, SRGBColorSpace, Vector3, type Object3D,
} from 'three';
import { createBoxMesh, type Carton } from './BoxMesh';
import { stagingBay } from '../scene/staging';
import { skuById } from '../types/catalog';
import type { ConveyorCase, ConveyorStatus } from '../types/engine';

const BELT_Y = 8;
/** Two accumulating roller lanes, with the oldest carton beside the pallet at the pick spur. */
const SLOTS = [
  [52, 40], [52, 14], [52, -12], [52, -38], [52, -64],
  [80, -64], [80, -38], [80, -12], [80, 14], [80, 40],
].map(([x, z]) => new Vector3(x, BELT_Y, z));
const INTAKE = new Vector3(80, BELT_Y, 112);
const DIVERSION_GATE = new Vector3(80, BELT_Y, 72);
const OVERFLOW_END = new Vector3(140, BELT_Y, 72);
export const CONVEYOR_BOUNDS = new Box3(new Vector3(37, -2.4, -79), new Vector3(154, 34, 126));

export function conveyorPickBay(item: ConveyorCase) {
  const bay = stagingBay(item.id, skuById(item.sku_id), 0, SLOTS[0].x, SLOTS[0].z);
  const lift = BELT_Y - bay.position.y;
  bay.position.y += lift;
  bay.bounds.translate(new Vector3(0, lift, 0));
  return bay;
}

/** Mounts roller lanes, a diversion spur, and cartons driven only by Rust's conveyor snapshot. */
export function ConveyorBelt({ parent, readStatus, movePick, heldCase, revision }: {
  parent: Object3D;
  readStatus: () => ConveyorStatus | undefined;
  movePick: (id: number, position: Vector3) => void;
  heldCase: () => number | undefined;
  revision?: ConveyorStatus;
}) {
  const flush = useRef<() => void>();
  useLayoutEffect(() => flush.current?.(), [revision]);
  useEffect(() => {
    const group = new Group();
    group.name = 'conveyor';
    parent.add(group);
    const steel = new MeshStandardMaterial({ color: 0x526372, roughness: 0.45, metalness: 0.7 });
    const safetyMap = stripedTexture('#e7b741', '#252c32');
    const rollerMap = stripedTexture('#8997a0', '#55626c');
    const safety = new MeshStandardMaterial({ map: safetyMap, roughness: 0.7 });
    const rollerMaterial = new MeshStandardMaterial({ map: rollerMap, roughness: 0.5, metalness: 0.65 });
    const rollers: { mesh: Mesh; axis: 'x' | 'z' }[] = [];
    const rollerGeometry = new CylinderGeometry(1, 1, 24, 12).rotateZ(Math.PI / 2);
    const spurRollerGeometry = rollerGeometry.clone().rotateY(Math.PI / 2);
    const addBeam = (width: number, height: number, depth: number, x: number, y: number, z: number, material = steel) => {
      const beam = new Mesh(new BoxGeometry(width, height, depth), material);
      beam.position.set(x, y, z);
      beam.castShadow = beam.receiveShadow = true;
      group.add(beam);
    };
    const lane = (x: number, start: number, end: number) => {
      addBeam(27, 2, end - start + 4, x, BELT_Y - 3, (start + end) / 2);
      for (const side of [-1, 1]) addBeam(1, 2, end - start + 4, x + side * 13, BELT_Y - 1, (start + end) / 2, safety);
      for (let z = start; z <= end; z += 4) {
        const roller = new Mesh(rollerGeometry, rollerMaterial);
        roller.position.set(x, BELT_Y - 1, z);
        group.add(roller); rollers.push({ mesh: roller, axis: 'x' });
      }
      for (const z of [start + 5, end - 5]) addBeam(22, 7, 2, x, 1.1, z);
    };
    lane(52, -76, 52);
    lane(80, -76, 122);
    // The transfer between the two accumulation lanes and the outbound diversion spur.
    addBeam(28, 2, 24, 66, BELT_Y - 2, -64);
    addBeam(60, 2, 26, 110, BELT_Y - 2, 72);
    for (const z of [58.5, 85.5]) addBeam(60, 2, 1, 110, BELT_Y - 1, z, safety);
    for (let x = 96; x <= 140; x += 4) {
      const roller = new Mesh(spurRollerGeometry, rollerMaterial);
      roller.position.set(x, BELT_Y - 1, 72);
      group.add(roller); rollers.push({ mesh: roller, axis: 'z' });
    }
    const lamps = (['green', 'yellow', 'red'] as const).map((signal, index) => {
      const color = { green: 0x39d884, yellow: 0xffc42b, red: 0xff4646 }[signal];
      const material = new MeshStandardMaterial({ color, emissive: color });
      const lamp = new Mesh(new SphereGeometry(1.8, 12, 8), material);
      lamp.position.set(36, 14 + index * 5, 40);
      group.add(lamp);
      return { signal, material };
    });
    addBeam(1, 26, 1, 36, 10, 40);

    const cartons = new Map<number, Carton>();
    const cartonAt = (item: ConveyorCase, position: Vector3, keep: Set<number>, seconds: number) => {
      keep.add(item.id);
      let carton = cartons.get(item.id);
      if (!carton) {
        carton = createBoxMesh(skuById(item.sku_id));
        carton.name = `conveyor-carton-${item.id}`;
        cartons.set(item.id, carton); group.add(carton);
        carton.position.copy(position);
      } else {
        // Keep the current position when a drop changes the route or advances the FIFO.
        // Travel toward the new destination rather than remapping progress to a new path.
        const distance = carton.position.distanceTo(position);
        if (distance > 0) carton.position.lerp(position, Math.min(1, seconds * 180 / distance));
      }
      carton.visible = heldCase() !== item.id;
      return carton;
    };
    let previousElapsed: number | undefined;
    const update = () => {
      const status = readStatus();
      if (status) {
        const seconds = previousElapsed === undefined || status.end_reason ? 0 : Math.max(0, status.elapsed_ms - previousElapsed) / 1000;
        previousElapsed = status.elapsed_ms;
        // Elapsed time freezes at shipping or Estop, so rollers and diverted cartons freeze too.
        const turns = status.incoming.id + (status.end_reason === 'estop' ? 1 : status.arrival_progress);
        for (const { mesh, axis } of rollers) mesh.rotation[axis] = turns * 22;
        for (const { signal, material } of lamps) {
          const active = signal === status.signal;
          const blink = signal !== 'green' && !status.end_reason && Math.floor(status.elapsed_ms / 450) % 2 === 0;
          material.emissiveIntensity = active ? (blink ? 0.6 : 2) : 0.04;
        }
        const keep = new Set<number>();
        status.queue.forEach((item, index) => {
          const carton = cartonAt(item, SLOTS[index], keep, seconds);
          if (index === 0) movePick(item.id, carton.position);
        });
        // Shipping freezes the in-flight carton. At Estop it becomes the fifth diversion.
        if (status.end_reason !== 'estop') {
          const route = status.queue.length < 10
            ? [INTAKE, ...SLOTS.slice(status.queue.length).reverse()]
            : [INTAKE, DIVERSION_GATE];
          cartonAt(status.incoming, alongRoute(route, status.arrival_progress), keep, seconds);
        }
        for (const diversion of status.diversions) {
          const progress = (status.elapsed_ms - diversion.elapsed_ms) / 2_000;
          if (progress <= 1) cartonAt(diversion.case, DIVERSION_GATE.clone().lerp(OVERFLOW_END, Math.max(0, progress)), keep, seconds);
        }
        for (const [id, carton] of cartons) if (!keep.has(id)) {
          group.remove(carton); carton.dispose(); cartons.delete(id);
        }
      }
    };
    flush.current = update;
    let frame = requestAnimationFrame(function animate() { update(); frame = requestAnimationFrame(animate); });
    return () => {
      flush.current = undefined;
      cancelAnimationFrame(frame);
      for (const carton of cartons.values()) { group.remove(carton); carton.dispose(); }
      const geometries = new Set<import('three').BufferGeometry>();
      group.traverse(object => { if (object instanceof Mesh) geometries.add(object.geometry); });
      geometries.forEach(geometry => geometry.dispose());
      for (const material of [steel, safety, rollerMaterial, ...lamps.map(lamp => lamp.material)]) material.dispose();
      safetyMap.dispose(); rollerMap.dispose();
      parent.remove(group);
    };
  }, [parent, readStatus, movePick, heldCase]);
  return null;
}

function alongRoute(points: Vector3[], progress: number) {
  const lengths = points.slice(1).map((point, i) => point.distanceTo(points[i]));
  let distance = Math.min(1, progress) * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i]) return points[i].clone().lerp(points[i + 1], distance / lengths[i]);
    distance -= lengths[i];
  }
  return points.at(-1)!.clone();
}

function stripedTexture(light: string, dark: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = light; context.fillRect(0, 0, 64, 64);
  context.strokeStyle = dark; context.lineWidth = 16;
  for (let x = -64; x <= 128; x += 32) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x + 64, 64); context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(1, 8);
  return texture;
}
