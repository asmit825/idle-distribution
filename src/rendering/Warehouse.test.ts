import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { FLOOR_Y } from '../scene/coordinates';
import { CONVEYOR_BOUNDS } from './ConveyorBelt';
import { YARD_BOUNDS } from './HaulerYard';
import { warehouseLayout, type Piece } from './Warehouse';

/** The world-space box a piece occupies. */
const bounds = (piece: Piece) => new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))
  .applyMatrix4(new Matrix4().compose(piece.position, piece.quaternion ?? new Quaternion(), piece.size));
/** Markings flat on the floor and fixtures up at the ceiling never get in the way. */
const solid = (piece: Piece) => {
  const box = bounds(piece);
  return box.max.y > FLOOR_Y + 1 && box.min.y < FLOOR_Y + 200;
};

const KEEP_CLEAR = {
  pallet: new Box3(new Vector3(-40, FLOOR_Y, -36), new Vector3(40, 80, 36)),
  conveyor: CONVEYOR_BOUNDS,
  yard: YARD_BOUNDS.clone().expandByScalar(4),
  // The hauler swings between its spot and the lane, then drives out through the rack aisle.
  turn: new Box3(new Vector3(-176, FLOOR_Y, -90), new Vector3(40, 90, 26)),
  lane: new Box3(new Vector3(-700, FLOOR_Y, -26), new Vector3(0, 90, 26)),
};

describe('warehouse layout', () => {
  for (const options of [{ detail: 'high', yard: true }, { detail: 'low', yard: false }] as const) {
    it(`keeps the play area, conveyor and hauler routes clear (${options.detail} detail)`, () => {
      const pieces = warehouseLayout(options).filter(solid);
      expect(pieces.length).toBeGreaterThan(100);
      for (const [zone, box] of Object.entries(KEEP_CLEAR)) {
        const blocking = pieces.filter(piece => bounds(piece).intersectsBox(box));
        expect(blocking.map(piece => `${piece.kind} @ ${piece.position.toArray().map(Math.round)}`), zone).toEqual([]);
      }
    });
  }

  it('lays out the same warehouse every time', () => {
    expect(warehouseLayout()).toEqual(warehouseLayout());
  });

  it('trims the back rack row and a row of lamps for phones', () => {
    const high = warehouseLayout({ detail: 'high' });
    const low = warehouseLayout({ detail: 'low' });
    expect(low.length).toBeLessThan(high.length * 0.7);
  });

  it('marks the hauler lane and parking spot only where there is a hauler', () => {
    const tape = (yard: boolean) => warehouseLayout({ yard }).filter(piece => piece.kind === 'tape').length;
    expect(tape(true)).toBe(tape(false) + 6);
  });
});
