import { useEffect, useRef, useState } from 'react';
import { roundService } from '../../storage/roundService';
import type { PersonalBestRecord, RoundMode, RoundRecord } from '../../storage/types';
import { PalletPreview } from './PalletPreview';
import { gradeLabel } from '../hud/types';

export const MODE_LABELS: Record<RoundMode, string> = { free_staging_100: 'Mode 1', conveyor_diversion: 'Mode 2' };
function bestGrade(quality: number): RoundRecord['grade'] { return quality >= 90 ? 'S' : quality >= 80 ? 'A' : quality >= 70 ? 'B' : quality >= 60 ? 'C' : 'F'; }

export function PalletGalleryModal({ close }: { close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<{ rounds: RoundRecord[]; bests: PersonalBestRecord[] }>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    let active = true;
    void Promise.all([roundService.list(), roundService.bests()]).then(([rounds, bests]) => {
      if (active) { setHistory({ rounds, bests }); setSelected(rounds[0]?.id); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; element.close(); };
  }, []);
  const round = history?.rounds.find(item => item.id === selected);
  return <dialog ref={dialog} className="storage-modal gallery-modal hud-panel" aria-label="Pallet gallery" onCancel={close}>
    <div className="storage-heading"><div><span className="eyebrow">YOUR DISPATCH ARCHIVE</span><h2>Pallet gallery</h2></div>
      <button type="button" onClick={close} autoFocus>Close gallery</button></div>
    <div className="personal-bests">{(Object.keys(MODE_LABELS) as RoundMode[]).map(mode => {
      const best = history?.bests.find(item => item.mode === mode);
      return <section key={mode} aria-label={`${MODE_LABELS[mode]} personal bests`}><h3>{MODE_LABELS[mode]} personal bests</h3>
        {best ? <dl className="metric-list"><dt>High score</dt><dd>{best.high_score.toFixed(0)}</dd>
          <dt>Best quality / grade</dt><dd>{best.highest_quality_pct.toFixed(1)}% · {gradeLabel(bestGrade(best.highest_quality_pct))}</dd>
          <dt>Most cases</dt><dd>{best.max_cases_placed}</dd><dt>Fastest completion</dt>
          <dd>{best.fastest_completion_ms === undefined ? '—' : `${(best.fastest_completion_ms / 1000).toFixed(2)}s`}</dd></dl> : <p>No rounds yet</p>}
      </section>;
    })}</div>
    {error ? <p role="alert">Saved rounds could not be loaded. Close the gallery and try again.</p> : !history ? <p role="status">Loading saved rounds…</p>
      : !history.rounds.length ? <p className="gallery-empty">Your first completed round will appear here.</p>
      : <div className="gallery-layout">
        <nav aria-label="Saved rounds" className="round-list">{history.rounds.map(item => <button type="button" key={item.id} aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>
          <strong>{MODE_LABELS[item.mode]} · Grade {gradeLabel(item.grade)} · {item.final_score.toFixed(0)} pts</strong>
          <span>{new Date(item.timestamp).toLocaleString()}</span><span>{item.cases_placed} cases · {item.end_reason.replaceAll('_', ' ')}</span>
        </button>)}</nav>
        {round && <section className="saved-build" aria-label="Selected pallet">
          <PalletPreview cases={round.pallet_snapshot} />
          <p>{round.cases_placed} cases · {round.crush_count} crushed · {round.total_weight_lbs} lbs · {(round.duration_ms / 1000).toFixed(2)}s</p>
          <p>Quality {round.quality_pct.toFixed(1)}% · Volume {round.volume_utilization_pct.toFixed(1)}% · Overhang {round.overhang_inches}″
            {round.mode === 'conveyor_diversion' && ` · ${round.diversions_count} diversions`}</p>
          <div className="coordinate-scroll"><table aria-label="Saved case coordinates"><thead><tr><th>Case / SKU</th><th>Grid</th><th>Height</th><th>Rotation</th><th>State</th></tr></thead>
            <tbody>{round.pallet_snapshot.map(placed => <tr key={placed.id}><td>{placed.id} · {placed.sku_id}</td><td>{placed.grid_x}, {placed.grid_y}</td><td>{placed.elevation_z}″</td>
              <td>{placed.rotation_yaw}°{placed.flipped && ' · flipped'}</td><td>{placed.crushed ? 'Crushed' : 'Intact'}</td></tr>)}</tbody></table></div>
        </section>}
      </div>}
    <p className="storage-note">Saved on this browser. Export a backup before clearing site data. Fastest times exclude timed-out shifts, Estops, and empty pallets.</p>
  </dialog>;
}
