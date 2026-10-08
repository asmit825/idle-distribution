import { expect, it } from 'vitest';
import type { FloorCase } from '../types/engine';
import { stagedCases } from './useMode1GameLoop';

/** Arrived cases `0..count`, with `placed` ids on the pallet. */
function arrived(count: number, placed: number[] = []): FloorCase[] {
  return Array.from({ length: count }, (_, id) => ({ id, sku_id: 'SKU-MQ', yaw: 0, on_floor: !placed.includes(id) }));
}
const ids = (cases: FloorCase[]) => cases.map(({ id }) => id);

it('keeps a wave in place as its cases are placed, then lays out the next wave alone', () => {
  const wave1 = arrived(25);
  const placing = arrived(25, [0, 1, 2]);
  expect(stagedCases(wave1, placing, 1)).toBe(wave1); // unchanged: nothing re-stages
  const wave2 = stagedCases(wave1, arrived(50, [...Array(25).keys()]), 2);
  expect(ids(wave2)).toEqual([...Array(25).keys()].map(id => id + 25));
});

it('adds an earlier case to the end of the floor when it comes back off the pallet, and keeps it there', () => {
  const wave2 = stagedCases(arrived(25), arrived(50, [...Array(25).keys()]), 2);
  const back = stagedCases(wave2, arrived(50, [...Array(25).keys()].filter(id => id !== 7)), 2);
  expect(ids(back)).toEqual([...ids(wave2), 7]);
  // Placed again, it keeps its spot until the wave clears, so nothing shuffles.
  expect(stagedCases(back, arrived(50, [...Array(25).keys()]), 2)).toBe(back);
});
