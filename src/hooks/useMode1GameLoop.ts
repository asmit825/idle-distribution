import { useCallback, useEffect, useMemo, useState } from 'react';
import { COMPACT_QUERY } from '../components/hud/useCompact';
import { stageFloor, type FloorLayout } from '../game/FloorStaging';
import type { StagingBay } from '../scene/staging';
import { WAVE_CASES, type EngineSnapshot, type FloorCase, type ShiftEngine, type ShiftStatus } from '../types/engine';

const PORTRAIT_QUERY = '(orientation: portrait)';

export interface Mode1Game {
  /** Increments with every new shift; key the viewport on it. */
  shiftCount: number;
  shift: ShiftStatus;
  /** The pallet as it was evaluated, once the shift is complete. */
  result?: EngineSnapshot;
  /**
   * This wave's floor cases where the current layout puts them, including those already placed,
   * plus any earlier case taken back off the pallet during the wave.
   */
  floor: readonly StagingBay[];
  /** Lifts a floor case, starting the clock on the first pick; false once the shift is over. */
  pick(bay: StagingBay): boolean;
  /** Brings the clock up to the moment of a drop; false if the shift ended first. */
  canDrop(): boolean;
  /** Reports a placement, move, or removal; clearing the floor brings the next wave or ends the shift. */
  placed(snapshot: EngineSnapshot): void;
  ship(): void;
  /** Starts a fresh shift with a new random seed. */
  restart(): void;
}

/**
 * Mode 1's shift loop (SPEC-01 §5.1): starts a shift, stages each wave of its floor for the
 * current layout, and runs the countdown against the engine every animation frame once the first case is
 * picked. The engine owns the rules and the clock; this keeps React in step with it. The HUD
 * re-renders when the clock's tenths or the phase change, not every frame. A sandbox shift
 * counts up instead, with no end but shipping. Undefined until the first shift starts.
 */
export function useMode1GameLoop(engine: ShiftEngine, { seed, layout, sandbox = false }: { seed?: bigint; layout: FloorLayout; sandbox?: boolean }): Mode1Game | undefined {
  const [state, setState] = useState<{ shiftCount: number; cases: FloorCase[]; shift: ShiftStatus }>();

  const start = useCallback((shiftSeed: bigint) => {
    const shift = engine.start_mode1(shiftSeed, sandbox).mode1!;
    const cases = engine.floor_cases();
    setState(previous => ({ shiftCount: (previous?.shiftCount ?? 0) + 1, cases, shift }));
  }, [engine, sandbox]);

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

  const placed = useCallback((snapshot: EngineSnapshot) => {
    update(snapshot.mode1!);
    const arrived = engine.floor_cases();
    setState(previous => {
      if (!previous) return previous;
      const cases = stagedCases(previous.cases, arrived, snapshot.mode1!.wave);
      return cases === previous.cases ? previous : { ...previous, cases };
    });
  }, [engine, update]);
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

/**
 * The cases to lay out: the current wave's, in a stable order so each keeps its spot, then any
 * earlier case that has come back to the floor. Unchanged (the same array) if nothing is new.
 */
export function stagedCases(previous: FloorCase[], arrived: FloorCase[], wave: number) {
  const first = WAVE_CASES * (wave - 1);
  const current = previous.some(floorCase => floorCase.id >= first) ? previous : arrived.filter(floorCase => floorCase.id >= first);
  const returned = arrived.filter(floorCase => floorCase.on_floor && !current.some(({ id }) => id === floorCase.id));
  return returned.length ? [...current, ...returned] : current;
}

function changed(previous: ShiftStatus, next: ShiftStatus) {
  return previous.phase !== next.phase
    || previous.wave !== next.wave
    || previous.cases_on_floor !== next.cases_on_floor
    || Math.ceil(previous.time_remaining_ms / 100) !== Math.ceil(next.time_remaining_ms / 100)
    || Math.floor(previous.elapsed_ms / 100) !== Math.floor(next.elapsed_ms / 100);
}
