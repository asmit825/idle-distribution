import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { conveyorPickBays } from '../rendering/ConveyorBelt';
import type { StagingBay } from '../scene/staging';
import type { ConveyorEngine, ConveyorStatus, Difficulty, EngineSnapshot } from '../types/engine';

/** Rust owns arrival timing; React samples telemetry at 10 Hz, while the scene reads every tick. */
export function useMode2GameLoop(engine: ConveyorEngine, seed?: bigint, difficulty: Difficulty = 'medium', sandbox = false) {
  const live = useRef<ConveyorStatus>();
  const [state, setState] = useState<{ run: number; status: ConveyorStatus; snapshot: EngineSnapshot }>();
  const lastPublished = useRef(0);

  const start = useCallback((runSeed: bigint) => {
    const snapshot = engine.start_mode2(runSeed, performance.now(), difficulty, sandbox);
    live.current = snapshot.mode2!;
    lastPublished.current = 0;
    setState(previous => ({ run: (previous?.run ?? 0) + 1, status: snapshot.mode2!, snapshot }));
  }, [engine, difficulty, sandbox]);
  useEffect(() => start(seed ?? randomSeed()), [start, seed]);

  const publish = useCallback((status: ConveyorStatus, snapshot?: EngineSnapshot) => {
    const previous = live.current;
    live.current = status;
    if (snapshot || status.end_reason !== previous?.end_reason || status.queue.length !== previous?.queue.length
      || status.final_run !== previous?.final_run || status.recirculating !== previous?.recirculating || status.can_ship !== previous?.can_ship
      || status.diversions_count !== previous?.diversions_count || status.elapsed_ms - lastPublished.current >= 100) {
      lastPublished.current = status.elapsed_ms;
      setState(state => state && ({ ...state, status, snapshot: snapshot ?? (status.end_reason ? engine.get_snapshot() : state.snapshot) }));
    }
  }, [engine]);

  const complete = !!state?.status.end_reason;
  const run = state?.run;
  useEffect(() => {
    if (!run || complete) return;
    let frame = requestAnimationFrame(function loop() {
      const status = engine.tick_mode2(performance.now());
      if (!status) return;
      publish(status);
      if (!status.end_reason) frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [engine, run, complete, publish]);

  const pick = useCallback((bay: StagingBay) => {
    const now = performance.now();
    const status = engine.tick_mode2(now)!;
    publish(status);
    if (status.end_reason || !status.queue.slice(0, status.final_run).some(item => item.id === bay.id)) return false;
    engine.pick_case(bay.id, now);
    return true;
  }, [engine, publish]);
  const canDrop = useCallback(() => {
    const status = engine.tick_mode2(performance.now())!;
    publish(status);
    return !status.end_reason;
  }, [engine, publish]);
  const placed = useCallback((snapshot: EngineSnapshot) => publish(snapshot.mode2!, snapshot), [publish]);
  const ship = useCallback(() => {
    const now = performance.now();
    const status = engine.tick_mode2(now)!;
    publish(status);
    if (status.can_ship) placed(engine.ship(now));
  }, [engine, publish, placed]);
  const restart = useCallback(() => start(randomSeed()), [start]);
  const readConveyor = useCallback(() => live.current, []);
  // The pickable cartons: re-created only when one joins or leaves the final run. Arrivals
  // further back change nothing, and the held carton's drag survives either way.
  const onRun = state?.status.queue.slice(0, state.status.final_run).map(({ id, sku_id }) => `${id}:${sku_id}`).join() ?? '';
  const bays = useMemo(() => state ? conveyorPickBays(state.status) : [], [onRun]);

  return state && { ...state, bays, pick, canDrop, placed, ship, restart, readConveyor, complete };
}

function randomSeed() { return crypto.getRandomValues(new BigUint64Array(1))[0]; }
