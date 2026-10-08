import { useEffect, useState, type ReactNode } from 'react';
import { SmokeBreakGame } from './smokebreak/SmokeBreakGame';
import { LandingPortal } from './components/landing/LandingPortal';
import type { LandingMode } from './components/landing/ModeTilesStack';
import { Mode2App } from './components/Mode2App';
import { PalletCanvas } from './components/PalletCanvas';
import { useFloorLayout, useMode1GameLoop } from './hooks/useMode1GameLoop';
import { useSandbox } from './hooks/useSandbox';
import type { ConveyorEngine, ShiftEnd, ShiftEngine } from './types/engine';

const ENDINGS: Record<ShiftEnd, string> = {
  time_up: 'Shift over',
  shipped: 'Pallet shipped',
  all_placed: 'Order complete',
};

type AppScreen = 'landing' | 'mode1' | 'mode2' | 'gallery';

function screenFromUrl(): AppScreen {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === '1') return 'mode1';
  if (params.get('mode') === '2') return 'mode2';
  return params.get('gallery') === 'true' ? 'gallery' : 'landing';
}

export function App({ handshake, engine, seed }: { handshake: string; engine: ConveyorEngine; seed?: bigint }) {
  const [screen, setScreen] = useState<AppScreen>(screenFromUrl);
  const [smoking, setSmoking] = useState(false);
  const [sandbox, setSandbox] = useSandbox();
  useEffect(() => {
    const navigate = () => { setSmoking(false); setScreen(screenFromUrl()); };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  const navigate = (next: AppScreen) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    url.searchParams.delete('gallery');
    if (next === 'mode1' || next === 'mode2') url.searchParams.set('mode', next === 'mode1' ? '1' : '2');
    if (next === 'gallery') url.searchParams.set('gallery', 'true');
    if (url.href !== window.location.href) window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setSmoking(false);
    setScreen(next);
  };
  const launchMode = (mode: LandingMode) => navigate(mode === 'gallery' ? 'gallery' : mode === 1 ? 'mode1' : 'mode2');
  const returnToLanding = () => navigate('landing');
  if (screen === 'landing' || screen === 'gallery') return <LandingPortal seed={seed} onSelectMode={launchMode}
    galleryOpen={screen === 'gallery'} closeGallery={returnToLanding} sandbox={sandbox} setSandbox={setSandbox} />;
  const smokeBreak = () => setSmoking(true);
  const modeSwitch = <nav className="mode-switch" aria-label="Game mode">
    <button type="button" className="terminal-return" onClick={returnToLanding}>← Exit to Terminal</button>
    <button type="button" aria-pressed={screen === 'mode1'} onClick={() => launchMode(1)}>Mode 1 · Free staging</button>
    <button type="button" aria-pressed={screen === 'mode2'} onClick={() => launchMode(2)}>Mode 2 · Conveyor</button>
    <button type="button" className="sandbox-toggle" aria-pressed={sandbox} onClick={() => setSandbox(!sandbox)}
      title={sandbox ? 'Switch back to timed play' : 'No clock, no Estop: play for fun'}>Sandbox</button>
  </nav>;
  // Leaving the break remounts the mode, which deals a fresh shift; so does switching to or from the sandbox.
  if (smoking) return <SmokeBreakGame finish={() => setSmoking(false)} />;
  return screen === 'mode1'
    ? <Mode1App key={String(sandbox)} handshake={handshake} engine={engine} seed={seed} sandbox={sandbox} modeSwitch={modeSwitch} smokeBreak={smokeBreak} />
    : <Mode2App key={String(sandbox)} handshake={handshake} engine={engine} seed={seed} sandbox={sandbox} modeSwitch={modeSwitch} smokeBreak={smokeBreak} />;
}

function Mode1App({ handshake, engine, seed, sandbox, modeSwitch, smokeBreak }: {
  handshake: string; engine: ShiftEngine; seed?: bigint; sandbox: boolean; modeSwitch: ReactNode; smokeBreak(): void;
}) {
  const layout = useFloorLayout();
  const game = useMode1GameLoop(engine, { seed, layout, sandbox });
  const shift = game?.shift;
  const complete = shift?.phase === 'complete';
  return <main className="workstation"><section className="viewport" aria-label="Pallet inspection viewport">
    {game && <PalletCanvas key={game.shiftCount} engine={engine} bays={game.floor} pick={game.pick} canDrop={game.canDrop}
      locked={complete} onPlaced={game.placed} hud={{ mode: 1, sandbox, modeSwitch, handshake,
        clock: sandbox ? clockUp(shift!.elapsed_ms) : clock(shift!.time_remaining_ms), timerLabel: sandbox ? 'Shift elapsed time' : 'Shift time remaining',
        heading: headline(shift?.phase, sandbox), description: `Wave ${shift!.wave} · ${shift!.cases_on_floor} cases on the floor`,
        result: game.result, resultTitle: ENDINGS[shift!.end_reason ?? 'shipped'], complete, canShip: !complete, ship: game.ship, restart: game.restart, smokeBreak }} />}
  </section></main>;
}

function headline(phase: string | undefined, sandbox: boolean) {
  if (sandbox) return phase === 'complete' ? 'Pallet shipped.' : 'Sandbox. No clock, and the floor keeps refilling. Ship when you like.';
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

/** m:ss of time played, rounding down. */
function clockUp(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
