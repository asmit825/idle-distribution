import type { ReactNode } from 'react';
import { Boxes, RotateCcw, Truck } from 'lucide-react';
import { PalletCanvas } from './PalletCanvas';
import { useConveyorAudio } from '../hooks/useConveyorAudio';
import { useMode2GameLoop } from '../hooks/useMode2GameLoop';
import type { ConveyorEngine } from '../types/engine';

const SIGNALS = { green: 'Normal', yellow: 'Bottleneck', red: 'Saturated' };

export function Mode2App({ handshake, engine, seed, modeSwitch }: {
  handshake: string; engine: ConveyorEngine; seed?: bigint; modeSwitch: ReactNode;
}) {
  const game = useMode2GameLoop(engine, seed);
  const status = game?.status;
  const sound = useConveyorAudio(status);
  const stopped = status?.end_reason;
  const title = stopped === 'estop' ? 'Warehouse Estop' : 'Pallet shipped';
  return <main className="workstation mode2">
    <header className="header">
      <div className="brand"><Boxes size={28} /><div><span className="eyebrow">IDLE DISTRIBUTION</span><h1>Dock survival</h1></div></div>
      {modeSwitch}
      <div className="shift-controls">
        <div className={`shift-clock ${stopped ? 'complete' : 'running'}`} role="timer" aria-label="Conveyor elapsed time">{elapsed(status?.elapsed_ms ?? 0)}</div>
        <button type="button" className="ship" disabled={!status?.can_ship} onClick={game?.ship}><Truck size={16} />Ship pallet</button>
      </div>
      <button type="button" className="sound-toggle" aria-pressed={sound.enabled} disabled={!sound.supported}
        onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        aria-label={sound.enabled ? 'Mute conveyor sound' : 'Enable conveyor sound'} onClick={sound.toggle}>
        Sound {sound.enabled ? 'on' : 'off'}
      </button>
      <span role="status" className="engine-status"><i />{handshake}</span>
    </header>
    <section className="viewport" aria-label="Pallet inspection viewport">
      {game && <PalletCanvas key={game.run} engine={engine} bays={game.bays} pick={game.pick} canDrop={game.canDrop}
        onPlaced={game.placed} locked={game.complete} conveyor={game.readConveyor} />}
      <div className="viewport-label" data-chrome>
        <span className="eyebrow">MODE 2 · CONVEYOR FLOW</span>
        <h2>{stopped ? title : status?.can_ship ? '60 inches. Ship your pallet!' : 'Keep the line moving.'}</h2>
        <p>Pick the oldest carton beside the signal tower.</p>
        {status && <div className={`conveyor-telemetry ${status.signal} ${stopped ? 'stopped' : ''}`}>
          <span className="signal" aria-label="Line status">{stopped === 'estop' ? 'Estop' : SIGNALS[status.signal]}</span>
          <dl>
            <div><dt>Buffer</dt><dd aria-label="Conveyor queue">{status.queue.length} / 10</dd></div>
            <div><dt>Diversions</dt><dd aria-label="Diversions">{status.diversions_count} / 5</dd></div>
            <div><dt>Arrival</dt><dd aria-label="Arrival interval">{(status.arrival_interval_ms / 1000).toFixed(1)}s / case</dd></div>
            <div><dt>Height</dt><dd>{game!.snapshot.max_height_inches}″ / 60″</dd></div>
          </dl>
        </div>}
      </div>
      {stopped && game && <div className="shift-result" role="dialog" aria-labelledby="conveyor-result-title">
        <span className="eyebrow">{stopped === 'estop' ? 'FACILITY SHUTDOWN · FAILED' : 'DOCK SURVIVAL · COMPLETE'}</span>
        <h2 id="conveyor-result-title">{title}</h2>
        <dl>
          <dt>Throughput time</dt><dd>{(status!.elapsed_ms / 1000).toFixed(2)}s</dd>
          <dt>Cases placed</dt><dd>{game.snapshot.cases_placed}</dd>
          <dt>Load quality</dt><dd>{game.snapshot.quality_pct.toFixed(1)}%</dd>
          <dt>Grade</dt><dd>{game.snapshot.grade}</dd>
          <dt>Final score</dt><dd className="final-score">{game.snapshot.composite_score}</dd>
          <dt>Diversions</dt><dd>{status!.diversions_count} / 5</dd>
        </dl>
        <button type="button" onClick={game.restart}><RotateCcw size={16} />New conveyor run</button>
      </div>}
    </section>
    <footer><span>Pick from the spur · R to rotate · F to flip · Build to 60″ and ship · Five diversions stop the warehouse</span><span>Run seed {status?.seed ?? '…'}</span></footer>
  </main>;
}

function elapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
