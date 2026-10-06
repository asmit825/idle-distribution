import { useState, type ReactNode } from 'react';
import { Mode2App } from './components/Mode2App';
import { Boxes, MousePointer2, RotateCcw, Truck } from 'lucide-react';
import { PalletCanvas } from './components/PalletCanvas';
import { useFloorLayout, useMode1GameLoop, type Mode1Game } from './hooks/useMode1GameLoop';
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
  return (
    <main className="workstation">
      <header className="header">
        <div className="brand"><Boxes size={28} /><div><span className="eyebrow">IDLE DISTRIBUTION</span><h1>Pallet builder</h1></div></div>
        {modeSwitch}
        {shift && (
          <div className="shift-controls">
            <div className={`shift-clock ${shift.phase}`} role="timer" aria-label="Shift time remaining">{clock(shift.time_remaining_ms)}</div>
            <button type="button" className="ship" disabled={complete} onClick={game.ship}><Truck size={16} />Ship pallet</button>
          </div>
        )}
        <span role="status" className="engine-status"><i />{handshake}</span>
      </header>
      <section className="viewport" aria-label="Pallet inspection viewport">
        {game && (
          <PalletCanvas
            key={game.shiftCount} engine={engine} bays={game.floor} pick={game.pick} canDrop={game.canDrop}
            locked={complete} onPlaced={game.placed}
          />
        )}
        <div className="viewport-label" data-chrome>
          <span className="eyebrow">MODE 1 · 100-CASE FREE STAGING</span>
          <h2>{headline(shift?.phase)}</h2>
          <p>{shift ? `${shift.cases_on_floor} cases on the floor` : 'Staging the floor…'}</p>
        </div>
        <div className="dimensions" data-chrome><strong>48 × 40 × 4.75</strong><span>INCHES · LENGTH / WIDTH / HEIGHT</span></div>
        {complete && game && <ShiftResult game={game} />}
      </section>
      <footer><span><MousePointer2 size={16} />Drag a floor carton onto the pallet; the 60-second shift starts with your first pick · No heavy cases on light ones · R, wheel, or second finger to rotate · F to flip</span><span>Shift seed {shift?.seed ?? '…'}</span></footer>
    </main>
  );
}

/** The shift's final evaluation. Ticket 07 replaces it with the full result modal. */
function ShiftResult({ game }: { game: Mode1Game }) {
  const { shift, result: snapshot } = game;
  if (!snapshot) return null;
  return (
    <div className="shift-result" role="dialog" aria-labelledby="shift-result-title">
      <span className="eyebrow">MODE 1 · RESULT</span>
      <h2 id="shift-result-title">{ENDINGS[shift.end_reason!]}</h2>
      <dl>
        <dt>Grade</dt><dd className="grade">{snapshot.grade}</dd>
        <dt>Cases placed</dt><dd>{snapshot.cases_placed}</dd>
        <dt>Load quality</dt><dd>{snapshot.quality_pct.toFixed(1)}%</dd>
        <dt>Pallet score</dt><dd>{snapshot.composite_score}</dd>
        <dt>Early finish bonus</dt><dd>{shift.early_finish_bonus}</dd>
        <dt>Final score</dt><dd className="final-score">{shift.final_score}</dd>
      </dl>
      <button type="button" onClick={game.restart}><RotateCcw size={16} />New shift</button>
    </div>
  );
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
