import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMPACT_QUERY } from '../components/PalletCanvas';
import { stageFloor, type FloorLayout } from '../game/FloorStaging';
import type { StagingBay } from '../scene/staging';
import type { EngineSnapshot, FloorCase, ShiftEngine, ShiftStatus } from '../types/engine';

const PORTRAIT_QUERY = '(orientation: portrait)';

export interface Mode1Game {
  /** Increments with every new shift; key the viewport on it. */
  shiftCount: number;
  shift: ShiftStatus;
  /** The pallet as it was evaluated, once the shift is complete. */
  result?: EngineSnapshot;
  /** Every floor case where the current layout puts it, including those already placed. */
  floor: readonly StagingBay[];
  /** Lifts a floor case, starting the clock on the first pick; false once the shift is over. */
  pick(bay: StagingBay): boolean;
  /** Brings the clock up to the moment of a drop; false if the shift ended first. */
  canDrop(): boolean;
  /** Reports a committed placement; placing the last floor case ends the shift. */
  placed(snapshot: EngineSnapshot): void;
  ship(): void;
  /** Starts a fresh shift with a new random seed. */
  restart(): void;
}

/**
 * Mode 1's shift loop (SPEC-01 §5.1): starts a shift, stages its floor for the current layout,
 * and runs the countdown against the engine every animation frame once the first case is
 * picked. The engine owns the rules and the clock; this keeps React in step with it. The HUD
 * re-renders when the clock's tenths or the phase change, not every frame.
 * Undefined until the first shift starts.
 */
export function useMode1GameLoop(engine: ShiftEngine, { seed, layout }: { seed?: bigint; layout: FloorLayout }): Mode1Game | undefined {
  const [state, setState] = useState<{ shiftCount: number; cases: FloorCase[]; shift: ShiftStatus }>();

  const start = useCallback((shiftSeed: bigint) => {
    const shift = engine.start_mode1(shiftSeed).mode1!;
    const cases = engine.floor_cases();
    setState(previous => ({ shiftCount: (previous?.shiftCount ?? 0) + 1, cases, shift }));
  }, [engine]);

  const update = useCallback((shift: ShiftStatus) => {
    setState(previous => previous && changed(previous.shift, shift) ? { ...previous, shift } : previous);
  }, []);

  useEffect(() => start(seed ?? randomSeed()), [start, seed]);

  const phase = state?.shift.phase;
  useEffect(() => {
    if (phase !== 'running') return;
    let frame = requestAnimationFrame(function loop() {
      update(engine.tick(performance.now())!);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [engine, phase, update]);

  /** Ticks to now; whether the shift is still open. */
  const open = useCallback(() => {
    const shift = engine.tick(performance.now())!;
    update(shift);
    return shift.phase !== 'complete';
  }, [engine, update]);

  const pick = useCallback((bay: StagingBay) => {
    if (!open()) return false;
    engine.pick_case(bay.id, performance.now());
    update(engine.tick(performance.now())!);
    return true;
  }, [engine, open, update]);

  const placed = useCallback((snapshot: EngineSnapshot) => update(snapshot.mode1!), [update]);
  const ship = useCallback(() => update(engine.ship(performance.now()).mode1!), [engine, update]);
  const restart = useCallback(() => start(randomSeed()), [start]);

  const cases = state?.cases;
  const floor = useMemo(() => stageFloor(cases ?? [], layout), [cases, layout]);
  const shiftCount = state?.shiftCount;
  const result = useMemo(() => phase === 'complete' && shiftCount ? engine.get_snapshot() : undefined, [engine, phase, shiftCount]);

  return state && { shiftCount: state.shiftCount, shift: state.shift, result, floor, pick, canDrop: open, placed, ship, restart };
}

/** Desktop clusters; on phones, bay slots shaped for the current orientation. Re-stages on change. */
export function useFloorLayout(): FloorLayout {
  const [layout, setLayout] = useState(currentLayout);
  useEffect(() => {
    const queries = [COMPACT_QUERY, PORTRAIT_QUERY].map(query => window.matchMedia(query));
    const change = () => setLayout(currentLayout());
    for (const query of queries) query.addEventListener('change', change);
    change();
    return () => { for (const query of queries) query.removeEventListener('change', change); };
  }, []);
  return layout;
}

/** A `?seed=` in the page URL replays that shift; otherwise each shift is random. */
export function seedFromUrl(search = window.location.search): bigint | undefined {
  const param = new URLSearchParams(search).get('seed');
  if (!param || !/^\d{1,20}$/.test(param)) return undefined;
  const seed = BigInt(param);
  return seed < 2n ** 64n ? seed : undefined;
}

function currentLayout(): FloorLayout {
  if (!window.matchMedia(COMPACT_QUERY).matches) return 'radial';
  return window.matchMedia(PORTRAIT_QUERY).matches ? 'portrait' : 'landscape';
}

function randomSeed() {
  return crypto.getRandomValues(new BigUint64Array(1))[0];
}

function changed(previous: ShiftStatus, next: ShiftStatus) {
  return previous.phase !== next.phase
    || previous.cases_on_floor !== next.cases_on_floor
    || Math.ceil(previous.time_remaining_ms / 100) !== Math.ceil(next.time_remaining_ms / 100);
}
