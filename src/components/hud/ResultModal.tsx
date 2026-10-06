import { useEffect, useRef, type ReactNode } from 'react';
import type { EngineSnapshot } from '../../types/engine';

export function ResultModal({ snapshot: s, title, restart, exportReplay, save, storageControls }: {
  storageControls: ReactNode;
  save: { status: 'saving' | 'saved' | 'error'; retry(): void };
  snapshot: EngineSnapshot; title: string; restart(): void; exportReplay(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const shift = s.mode1, conveyor = s.mode2;
  return <dialog ref={dialog} className="result-modal hud-panel" aria-modal="true" aria-labelledby="result-title" onCancel={event => event.preventDefault()}>
    <span className="eyebrow">{conveyor?.end_reason === 'estop' ? 'FACILITY SHUTDOWN · FAILED' : 'DISPATCH REPORT · COMPLETE'}</span>
    <h2 id="result-title">{title}</h2>
    <dl className="result-breakdown">
      <dt>Grade</dt><dd className="grade">{s.grade}</dd>
      <dt>Cases placed</dt><dd>{s.cases_placed}</dd>
      <dt>Load quality</dt><dd>{s.quality_pct.toFixed(1)}%</dd>
      <dt>Pallet score</dt><dd>{s.composite_score}</dd>
      {shift && <><dt>Early finish bonus</dt><dd>{shift.early_finish_bonus}</dd></>}
      <dt>Final score</dt><dd className="final-score">{shift?.final_score ?? s.composite_score}</dd>
      <dt>Volume utilization</dt><dd>{s.volume_utilization_pct.toFixed(1)}%</dd>
      <dt>Stability / quality</dt><dd>{s.quality_pct.toFixed(1)}%</dd>
      <dt>Total weight</dt><dd>{s.total_weight_lbs} lbs</dd>
      <dt>Height</dt><dd>{s.max_height_inches}″ / 60″</dd>
      <dt>Overhang penalty</dt><dd>−{s.overhang_penalty.toFixed(1)}%</dd>
      <dt>Crush penalties</dt><dd>−{s.crush_penalty.toFixed(1)}% ({s.crushed_count} cases)</dd>
      <dt>COG drift penalty</dt><dd>−{s.drift_penalty.toFixed(1)}%</dd>
      <dt>Interlock bonus</dt><dd>+{s.interlock_bonus.toFixed(1)}%</dd>
      {conveyor && <><dt>Throughput time</dt><dd>{(conveyor.elapsed_ms / 1000).toFixed(2)}s</dd><dt>Diversions</dt><dd>{conveyor.diversions_count} / 5</dd></>}
    </dl>
    <p role="status" aria-label="Round save status">{save.status === 'saved' ? 'Round saved on this device.' : save.status === 'saving' ? 'Saving round…' : 'Could not save this round. Your browser storage may be unavailable or full.'}</p>
    {save.status === 'error' && <button type="button" onClick={save.retry}>Retry saving</button>}
    <div className="result-actions"><button type="button" autoFocus onClick={restart}>{shift ? 'New shift' : 'New conveyor run'}</button>
      <button type="button" onClick={exportReplay}>Export replay</button></div>
    {storageControls}
  </dialog>;
}
