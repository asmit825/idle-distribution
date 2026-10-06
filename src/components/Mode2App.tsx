import type { ReactNode } from 'react';
import { PalletCanvas } from './PalletCanvas';
import { useConveyorAudio } from '../hooks/useConveyorAudio';
import { useMode2GameLoop } from '../hooks/useMode2GameLoop';
import type { ConveyorEngine } from '../types/engine';


export function Mode2App({ handshake, engine, seed, modeSwitch }: {
  handshake: string; engine: ConveyorEngine; seed?: bigint; modeSwitch: ReactNode;
}) {
  const game = useMode2GameLoop(engine, seed);
  const status = game?.status;
  const sound = useConveyorAudio(status);
  const stopped = status?.end_reason;
  const title = stopped === 'estop' ? 'Warehouse Estop' : 'Pallet shipped';
  const soundButton = <button type="button" className="sound-toggle" aria-pressed={sound.enabled} disabled={!sound.supported}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    aria-label={sound.enabled ? 'Mute conveyor sound' : 'Enable conveyor sound'} onClick={sound.toggle}>Sound {sound.enabled ? 'on' : 'off'}</button>;
  return <main className="workstation mode2"><section className="viewport" aria-label="Pallet inspection viewport">
    {game && <PalletCanvas key={game.run} engine={engine} bays={game.bays} pick={game.pick} canDrop={game.canDrop}
      onPlaced={game.placed} locked={game.complete} conveyor={game.readConveyor}
      hud={{ mode: 2, modeSwitch, handshake, clock: elapsed(status?.elapsed_ms ?? 0), timerLabel: 'Conveyor elapsed time',
        result: game.complete ? game.snapshot : undefined, resultTitle: title, heading: stopped ? title : status?.can_ship ? '60 inches. Ship your pallet!' : 'Keep the line moving.',
        description: 'Pick the oldest carton beside the signal tower.', complete: game.complete, canShip: !!status?.can_ship,
        ship: game.ship, restart: game.restart, conveyor: status, sound: soundButton }} />}

  </section></main>;
}

function elapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
