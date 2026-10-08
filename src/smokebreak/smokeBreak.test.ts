import { expect, it } from 'vitest';
import { BREAK_MS, PRESSES_PER_CIGARETTE, buttSlot, freshBreak, press, remainingMs } from './smokeBreak';

it('lasts 15 seconds', () => expect(BREAK_MS).toBe(15_000));

it('does not start the clock until the first press', () => {
  expect(remainingMs(freshBreak(), 5_000)).toBe(BREAK_MS);
  const started = press(freshBreak(), 1_000);
  expect(remainingMs(started, 6_000)).toBe(BREAK_MS - 5_000);
});

it('lights the next cigarette once one is finished', () => {
  let state = freshBreak();
  for (let i = 0; i < PRESSES_PER_CIGARETTE; i++) state = press(state, 0);
  expect(state).toMatchObject({ smoked: 1, progress: 0 });
  expect(press(state, 0).progress).toBe(1);
});

it('ignores presses after time is up', () => {
  const state = press(freshBreak(), 0);
  expect(press(state, BREAK_MS)).toBe(state);
});

it('stacks butts in rings, each layer on the last and inside the bowl', () => {
  const slots = Array.from({ length: 20 }, (_, n) => buttSlot(n));
  expect(slots.map(s => s.layer)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3]);
  for (const { x, z } of slots) expect(Math.hypot(x, z)).toBeLessThan(2);
  // A new layer sits between the butts below it, not on top of one.
  expect(buttSlot(6).angle).not.toBeCloseTo(buttSlot(0).angle);
});
