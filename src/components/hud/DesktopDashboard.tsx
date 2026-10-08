import type { ReactNode } from 'react';
import { orientedSize } from '../../scene/coordinates';
import type { StagingBay } from '../../scene/staging';
import { SKU_CATALOG } from '../../types/catalog';
import type { EngineSnapshot } from '../../types/engine';
import { CogRadar } from './CogRadar';
import { displayGrade, type ActiveCase, type CaseActions, type RoundHud } from './types';

export function QualityPanel({ snapshot: s }: { snapshot: EngineSnapshot }) {
  return <section className="hud-panel load-quality" aria-label="Pallet load quality">
    <span className="eyebrow">PALLET LOAD QUALITY</span>
    <div className="grade-summary"><strong id="gradeVal">{displayGrade(s)}</strong><span><b id="scoreVal">{s.composite_score}</b> pts</span></div>
    <dl className="metric-list">
      <dt>Volume utilization</dt><dd id="volVal">{s.volume_utilization_pct.toFixed(1)}%</dd>
      <dt>Stability / quality</dt><dd id="stabVal">{s.quality_pct.toFixed(1)}%</dd>
      <dt>Height</dt><dd aria-label="Pallet height">{s.max_height_inches}″ / 60″</dd>
    </dl>
    <meter aria-label="Height to target" value={s.max_height_inches} max={60} />
    <dl className="metric-list"><dt>Cases placed</dt><dd>{s.cases_placed}</dd><dt>Total weight</dt><dd>{s.total_weight_lbs} lbs</dd>
      <dt>Crushed boxes</dt><dd>{s.crushed_count}</dd><dt>Max overhang</dt><dd>{s.max_overhang_inches.toFixed(1)}″</dd></dl>
    <span className="eyebrow">COG DRIFT RADAR</span>
    <CogRadar x={s.cog_inches[0]} y={s.cog_inches[1]} drift={s.cog_drift_inches} />
  </section>;
}

export function WarehouseFeed({ round, bays }: { round: RoundHud; bays: readonly StagingBay[] }) {
  const status = round.conveyor;
  return <section className="hud-panel warehouse-feed" aria-label="Warehouse feed">
    <div className="viewport-label"><span className="eyebrow">{round.mode === 1 ? 'MODE 1 · FREE STAGING' : 'MODE 2 · CONVEYOR FLOW'}{round.sandbox && ' · SANDBOX'}</span>
      <h2>{round.heading}</h2><p>{round.description}</p></div>
    {status ? <div className={`conveyor-telemetry ${status.signal} ${round.complete ? 'stopped' : ''}`}>
      <span className="signal" aria-label="Line status">{status.end_reason === 'estop' ? 'Estop' : status.end_reason === 'shipped' ? 'Shipped' : { green: 'Normal', yellow: 'Recirculation filling', red: round.sandbox ? 'Line paused' : 'Recirculation full' }[status.signal]}</span>
      {round.difficulty && <div className="difficulty" role="group" aria-label="Conveyor speed">{(['easy', 'medium', 'hard'] as const).map(level =>
        <button key={level} type="button" aria-pressed={round.difficulty!.value === level} onClick={() => round.difficulty!.value !== level && round.difficulty!.set(level)}>{level}</button>)}</div>}
      {status.signal === 'red' && !status.end_reason && !round.sandbox && <p className="overflow-countdown" role="timer" aria-label="Overflow countdown">Overflow in {(Math.max(0, 1 - status.arrival_progress) * status.arrival_interval_ms / 1000).toFixed(1)}s</p>}
      <meter aria-label="Recirculation saturation" value={status.recirculating} max={10} />
      <dl className="metric-list"><dt>On belt</dt><dd aria-label="Conveyor queue">{status.queue.length}</dd>
        <dt>Recirculation</dt><dd aria-label="Recirculation lane">{status.recirculating} / 10</dd>
        {!round.sandbox && <><dt>Diversions</dt><dd aria-label="Diversions">{status.diversions_count} / 5</dd></>}
        <dt>Arrival</dt><dd aria-label="Arrival interval">{(status.arrival_interval_ms / 1000).toFixed(1)}s / case</dd></dl>
      <p>{round.sandbox
        ? 'Cartons wrap the pick lane first. In the sandbox nothing diverts: when the recirculation lane is full, the line pauses until you make room.'
        : 'Cartons wrap the pick lane first. Yellow at 5 on the recirculation lane, red at 10 starts the overflow countdown. Five diversions trigger an emergency stop.'}</p></div>
      : <dl className="inventory-list">{SKU_CATALOG.map(sku => <div key={sku.id}><dt>{sku.name}<small>{sku.length_in}″ × {sku.width_in}″</small></dt>
        <dd aria-label={`${sku.name} remaining`}>{bays.filter(bay => bay.sku.id === sku.id).length}</dd></div>)}</dl>}
    <p className="hud-hint">{round.mode === 2 ? 'Pick any carton on the final run, in any order. Ship any time, but a partial pallet scores less.'
      : round.sandbox ? 'No clock in the sandbox: a new wave arrives each time the floor is clear. No heavy cases on light ones.'
      : 'The 60-second shift starts with your first pick. No heavy cases on light ones.'} After a drop, arrows or WASD nudge the case 2″; R rotates, F flips, Enter accepts. Drag a placed case to move it.</p>
  </section>;
}

export function CaseInspector({ active }: { active?: ActiveCase }) {
  if (!active) return <div className="case-inspector"><span className="eyebrow">ACTIVE CASE INSPECTOR</span><p>Tap a carton to inspect it. Drag to place.</p></div>;
  const { sku, orientation, grid, verdict } = active;
  const size = orientedSize(sku, orientation);
  return <div className="case-inspector"><span className="eyebrow">{active.holding ? 'HOLDING' : 'SELECTED'} · {sku.id}</span><strong>{sku.name}</strong>
    <p>{sku.length_in}″ × {sku.width_in}″ × {sku.height_in}″ · {sku.weight_lbs} lbs · Capacity {sku.top_load_capacity_lbs} lbs · Tape: {sku.tape.replaceAll('_', ' ')}</p>
    <p>Footprint {size.x}″ × {size.y}″ · {orientation.yaw}° yaw{orientation.flipped ? ' · flipped' : ''}{grid ? ` · Grid ${grid[0]}, ${grid[1]}` : ''}{verdict ? ` · ${verdict}` : ''}</p></div>;
}

export function ActionButtons({ active, actions, locked }: { active?: ActiveCase; actions: CaseActions; locked: boolean }) {
  return <div className="thumb-actions">
    <button type="button" disabled={!active?.adjustable || locked} onClick={actions.rotate}>Rotate</button>
    <button type="button" disabled={!active?.adjustable || locked} onClick={actions.flip}>Flip</button>
    <button type="button" disabled={!active?.adjustable || locked} onClick={actions.remove}>Remove</button>
    <button type="button" disabled={!active?.adjustable || locked} onClick={actions.done}>Done</button>
  </div>;
}

export function ShipButton({ round }: { round: RoundHud }) {
  return <button type="button" className="ship" disabled={!round.canShip} onClick={round.ship}>Ship pallet</button>;
}

export function DesktopDashboard({ round, snapshot, bays, active, actions, cameras, message, compact, mobileMenu, storageControls }: {
  round: RoundHud; snapshot: EngineSnapshot; bays: readonly StagingBay[]; active?: ActiveCase; actions: CaseActions;
  cameras: ReactNode; message: string; compact: boolean; mobileMenu?: ReactNode; storageControls: ReactNode;
}) {
  return <>
    <header className="hud-command hud-panel">
      <div className="hud-brand"><span className="eyebrow">IDLE DISTRIBUTION</span><strong>Warehouse console</strong></div>
      {round.modeSwitch}
      <div className={`shift-clock ${round.complete ? 'complete' : 'running'}`} id="timer" role="timer" aria-label={round.timerLabel}>{round.clock}</div>
      {compact ? <><span className="mobile-grade">{displayGrade(snapshot)} · {snapshot.composite_score} pts</span>{mobileMenu}</> : cameras}
      {!compact && storageControls}{!compact && round.sound}<span role="status" className="engine-status">{round.handshake}</span>
    </header>
    {!compact && <><WarehouseFeed round={round} bays={bays} /><QualityPanel snapshot={snapshot} />
      <section className="hud-panel hud-bottom" aria-label="Active case inspector"><CaseInspector active={active} />
        <ActionButtons active={active} actions={actions} locked={round.complete} /><ShipButton round={round} />
        <p className="placement-status" aria-live="polite">{message}</p></section></>}
  </>;
}
