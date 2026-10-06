import { describe, expect, it } from 'vitest';
import { Box3, Raycaster, Vector3 } from 'three';
import { createPallet } from './pallet';

describe('Grade A stringer pallet', () => {
  it('has the specified 48 × 40 × 4.75 inch envelope centered at the origin', () => {
    const pallet = createPallet();
    const bounds = new Box3().setFromObject(pallet);
    expect(bounds.getSize(new Vector3()).toArray()).toEqual([48, 4.75, 40]);
    expect(bounds.getCenter(new Vector3()).toArray()).toEqual([0, 0, 0]);
  });
});

it('provides seven top boards, five bottom boards, and three full-length stringers', () => {
  const pallet = createPallet();
  for (const [name, count] of [['top-deckboard', 7], ['bottom-deckboard', 5], ['stringer', 3]] as const) {
    const members = pallet.children.filter(child => child.name === name);
    expect(members).toHaveLength(count);
    if (name === 'stringer') {
      for (const member of members) {
        expect(new Box3().setFromObject(member).getSize(new Vector3()).toArray()).toEqual([48, 3.5, 1.25]);
      }
    } else {
      const widths = members.map(member => new Box3().setFromObject(member).getSize(new Vector3()).x);
      expect(widths).toEqual(name === 'top-deckboard' ? [5.5, 3.5, 3.5, 3.5, 3.5, 3.5, 5.5] : [5.5, 3.5, 3.5, 3.5, 5.5]);
    }
  }
});

it('leaves two nine-inch fork openings starting six inches from each stringer end', () => {
  const pallet = createPallet();
  pallet.updateMatrixWorld(true);
  const stringers = pallet.children.filter(child => child.name === 'stringer');
  const hits = (x: number, y: number) => new Raycaster(new Vector3(x, y, 30), new Vector3(0, 0, -1)).intersectObjects(stringers, true);
  for (const x of [-17.99, -13.5, -9.01, 9.01, 13.5, 17.99]) {
    expect(hits(x, -1.74)).toHaveLength(0);
    expect(hits(x, -0.51)).toHaveLength(0);
    expect(hits(x, -0.49).length).toBeGreaterThanOrEqual(3);
  }
  for (const x of [-18.01, -8.99, 0, 8.99, 18.01]) {
    expect(hits(x, -1).length).toBeGreaterThanOrEqual(3);
  }
});
