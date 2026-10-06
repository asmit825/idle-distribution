import { useState, type ReactNode } from 'react';
import { Mode2App } from './components/Mode2App';
import { PalletCanvas } from './components/PalletCanvas';
import { useFloorLayout, useMode1GameLoop } from './hooks/useMode1GameLoop';
import type { ConveyorEngine, ShiftEnd, ShiftEngine } from './types/engine';

const ENDINGS: Record<ShiftEnd, string> = {
  time_up: 'Shift over',
  shipped: 'Pallet shipped',
  all_placed: 'Order complete',
};

export function App({ handshake, engine, seed }: { handshake: string; engine: ConveyorEngine; seed?: bigint }) {
  const [mode, setMode] = useState<1 | 2>(() => new URLSearchParams(window.location.search).get('mode') === '2' ? 2 : 1);
  const modeSwitch = <nav className="mode-switch" aria-label="Game mode">
    <button type="button" aria-pressed={mode === 1} onClick={() => setMode(1)}>Mode 1 · Free staging</button>
    <button type="button" aria-pressed={mode === 2} onClick={() => setMode(2)}>Mode 2 · Conveyor</button>
  </nav>;
  return mode === 1
    ? <Mode1App handshake={handshake} engine={engine} seed={seed} modeSwitch={modeSwitch} />
    : <Mode2App handshake={handshake} engine={engine} seed={seed} modeSwitch={modeSwitch} />;
}

function Mode1App({ handshake, engine, seed, modeSwitch }: { handshake: string; engine: ShiftEngine; seed?: bigint; modeSwitch: ReactNode }) {
  const layout = useFloorLayout();
  const game = useMode1GameLoop(engine, { seed, layout });
  const shift = game?.shift;
  const complete = shift?.phase === 'complete';
  return <main className="workstation"><section className="viewport" aria-label="Pallet inspection viewport">
    {game && <PalletCanvas key={game.shiftCount} engine={engine} bays={game.floor} pick={game.pick} canDrop={game.canDrop}
      locked={complete} onPlaced={game.placed} hud={{ mode: 1, modeSwitch, handshake, clock: clock(shift!.time_remaining_ms),
        timerLabel: 'Shift time remaining', heading: headline(shift?.phase), description: `${shift!.cases_on_floor} cases on the floor`,
        result: game.result, resultTitle: ENDINGS[shift!.end_reason ?? 'shipped'], complete, canShip: !complete, ship: game.ship, restart: game.restart }} />}
  </section></main>;
}

function headline(phase: string | undefined) {
  switch (phase) {
    case 'running': return 'Shift running. Build it high, keep it sound.';
    case 'complete': return 'Shift complete.';
    default: return 'Inspect the floor. The clock starts on your first pick.';
  }
}

/** m:ss, rounding up so 0:00 shows only once time is truly out. */
function clock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
