import { useEffect, useRef } from 'react';
import { ArrowRight, CircleAlert, Layers } from 'lucide-react';
import { PalletReconstructionCanvas } from './PalletReconstructionCanvas';
import { TelemetryAuditTable } from './TelemetryAuditTable';
import { gradeLabel, type ResultModalProps } from './types';
import type { EngineSnapshot } from '../../types/engine';
import '../../styles/result-modal.css';

/** S and A pass, B and C are marginal, F fails: the grade pill, eyebrow, and deck badge share it. */
const tier = (grade: EngineSnapshot['grade']) => grade === 'S' || grade === 'A' ? 'pass' : grade === 'F' ? 'fail' : 'warn';

/** Formation 3: the rebuilt pallet in 3D beside the score and its itemized audit. */
export function ResultModal({ snapshot: s, title, restart, smokeBreak, exportReplay, save, storageControls }: ResultModalProps) {
  const dialog = useRef<HTMLDialogElement>(null), primary = useRef<HTMLButtonElement>(null);
  // showModal() would focus the 3D view, the first focusable element; start on the primary action instead.
  useEffect(() => { const element = dialog.current!; element.showModal(); primary.current!.focus(); return () => element.close(); }, []);
  const shift = s.mode1, conveyor = s.mode2;
  const sandbox = (shift ?? conveyor)?.sandbox;
  const estop = conveyor?.end_reason === 'estop';
  const grade = tier(s.grade);
  const finalScore = shift?.final_score ?? s.composite_score;
  return <dialog ref={dialog} className="result-modal" aria-modal="true" aria-labelledby="result-title" onCancel={event => event.preventDefault()}>
    <div className="f3-card">
      <section className="f3-left-deck" aria-label="3D pallet reconstruction">
        <header className="f3-deck-header">
          <span className="f3-deck-title"><Layers size={14} aria-hidden="true" />3D pallet reconstruction</span>
          <span className={`f3-deck-badge ${s.crushed_count > 0 ? 'badge-danger' : grade === 'pass' ? 'badge-pass' : 'badge-normal'}`}>
            {s.crushed_count > 0 ? 'Crush breach detected' : grade === 'pass' ? 'Carrier spec verified' : 'Stack verified'}
          </span>
        </header>
        <div className="f3-viewport-container">
          <PalletReconstructionCanvas snapshot={s} />
          <div className={`f3-radar-overlay ${s.drift_penalty > 0 ? 'text-hazard' : 'text-pass'}`}>
            <CircleAlert size={12} aria-hidden="true" />
            {s.drift_penalty > 0
              ? `COG drift ${s.cog_drift_inches.toFixed(1)}″ · −${s.drift_penalty.toFixed(1)}%`
              : `COG balanced · ${s.cog_drift_inches.toFixed(1)}″ drift`}
          </div>
          <div className="f3-radar-height">Stack height: {Number.isInteger(s.max_height_inches) ? s.max_height_inches : s.max_height_inches.toFixed(1)}″ / 60″ max</div>
          <div className="f3-viewport-hint" aria-hidden="true">Drag to rotate 3D view</div>
        </div>
      </section>

      <section className="f3-right-deck" aria-label="Round results">
        <header className="f3-hero-row">
          <div>
            <span className={`f3-eyebrow eyebrow-${estop ? 'fail' : grade}`}>
              {estop ? 'FACILITY SHUTDOWN · FAILED' : sandbox ? 'SANDBOX REPORT · UNRANKED' : 'SHIFT COMPLETE · CERTIFIED'}
            </span>
            <h2 id="result-title" className="f3-main-title">{title}</h2>
          </div>
          <strong className={`f3-grade-pill grade-${grade}`} aria-label={`Grade ${gradeLabel(s.grade)}`}>{gradeLabel(s.grade)}</strong>
        </header>

        <div className="f3-score-strip">
          <div className="f3-metric-tile"><span className="f3-tile-lbl">Final score</span>
            <span className="f3-tile-val final-score">{finalScore.toLocaleString('en-US')}</span></div>
          <div className="f3-metric-tile"><span className="f3-tile-lbl">Quality rate</span>
            <span className="f3-tile-val">{s.quality_pct.toFixed(1)}%</span></div>
          <div className="f3-metric-tile"><span className="f3-tile-lbl">Volume fill</span>
            <span className="f3-tile-val">{s.volume_utilization_pct.toFixed(1)}%</span></div>
        </div>

        <TelemetryAuditTable snapshot={s} />

        <div className="f3-save-status">
          <p role="status" aria-label="Round save status">{save.status === 'saved'
            ? sandbox ? 'Saved to the gallery. Sandbox pallets do not count toward bests.' : 'Round saved on this device.'
            : save.status === 'saving' ? 'Saving round…' : 'Could not save this round. Your browser storage may be unavailable or full.'}</p>
          {save.status === 'error' && <button type="button" className="f3-btn-retry" onClick={save.retry}>Retry saving</button>}
        </div>

        <footer className="f3-actions-dock">
          <div className="f3-actions-primary">
            <button type="button" ref={primary} className="f3-btn f3-btn-primary" onClick={restart}>
              <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />{shift ? 'New shift' : 'New conveyor run'}
            </button>
            <button type="button" className="f3-btn f3-btn-secondary" onClick={smokeBreak}>Smoke break?</button>
          </div>
          <div className="f3-actions-utilities">
            <button type="button" className="f3-btn f3-btn-ghost" onClick={exportReplay}>Export replay</button>
            {storageControls}
          </div>
        </footer>
      </section>
    </div>
  </dialog>;
}
