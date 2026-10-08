import { useCallback, useState, type ReactNode } from 'react';
import { PalletCanvas } from './PalletCanvas';
import { useConveyorAudio } from '../hooks/useConveyorAudio';
import { useMode2GameLoop } from '../hooks/useMode2GameLoop';
import { displayGrade } from './hud/types';
import type { ConveyorEngine, Difficulty } from '../types/engine';

const DIFFICULTY_KEY = 'idle-distribution:difficulty';
function storedDifficulty(): Difficulty {
  try {
    const value = localStorage.getItem(DIFFICULTY_KEY);
    if (value === 'easy' || value === 'medium' || value === 'hard') return value;
  } catch { /* storage unavailable */ }
  return 'medium';
}


export function Mode2App({ handshake, engine, seed, sandbox, modeSwitch, smokeBreak }: {
  handshake: string; engine: ConveyorEngine; seed?: bigint; sandbox: boolean; modeSwitch: ReactNode; smokeBreak(): void;
}) {
  const [difficulty, setDifficulty] = useState(storedDifficulty);
  const [arrivalRun, setArrivalRun] = useState<number>();
  const [lastShipped, setLastShipped] = useState<string>();
  const game = useMode2GameLoop(engine, seed, difficulty, sandbox);
  const chooseDifficulty = useCallback((value: Difficulty) => {
    try { localStorage.setItem(DIFFICULTY_KEY, value); } catch { /* storage unavailable */ }
    setLastShipped(undefined);
    setDifficulty(value);
  }, []);
  const status = game?.status;
  const sound = useConveyorAudio(status);
  const stopped = status?.end_reason;
  const hauled = () => {
    if (!game) return;
    const fill = Math.round(game.status.fill_pct);
    setLastShipped(`${displayGrade(game.snapshot)} · ${game.status.final_score ?? game.snapshot.composite_score} pts${fill < 100 ? ` (${fill}% full)` : ''}`);
    setArrivalRun(game.run + 1);
    game.restart();
  };
  const title = stopped === 'estop' ? 'Warehouse Estop' : 'Pallet shipped';
  const soundButton = <button type="button" className="sound-toggle" aria-pressed={sound.enabled} disabled={!sound.supported}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    aria-label={sound.enabled ? 'Mute conveyor sound' : 'Enable conveyor sound'} onClick={sound.toggle}>Sound {sound.enabled ? 'on' : 'off'}</button>;
  return <main className="workstation mode2"><section className="viewport" aria-label="Pallet inspection viewport">
    {game && <PalletCanvas key={game.run} engine={engine} bays={game.bays} pick={game.pick} canDrop={game.canDrop}
      onPlaced={game.placed} locked={game.complete} conveyor={game.readConveyor}
      hud={{ mode: 2, modeSwitch, handshake, clock: elapsed(status?.elapsed_ms ?? 0), timerLabel: 'Conveyor elapsed time',
        sandbox, result: game.complete ? game.snapshot : undefined, resultTitle: title,
        heading: stopped ? title : status?.can_ship ? `${Math.round(status.fill_pct)}% full. Ship when ready.` : sandbox ? 'Sandbox. The line waits for you.' : 'Keep the line moving.',
        description: lastShipped ? `Last pallet shipped: ${lastShipped}. Pick any carton on the final run.` : 'Pick any carton on the final run beside the pallet.',
        difficulty: { value: difficulty, set: chooseDifficulty }, onHauled: hauled, silentResult: stopped === 'shipped', arrival: game.run === arrivalRun, complete: game.complete, canShip: !!status?.can_ship,
        ship: game.ship, restart: game.restart, smokeBreak, conveyor: status, sound: soundButton }} />}

  </section></main>;
}

function elapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
