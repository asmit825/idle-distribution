import type { EngineSnapshot } from '../../types/engine';

/** One line of the audit: a penalty reads red when it bites, a bonus green when it pays. */
function Row({ label, value, tone }: { label: string; value: string; tone?: 'penalty' | 'bonus' | false }) {
  return <div className="f3-table-row"><dt className="f3-tbl-key">{label}</dt><dd className={`f3-tbl-val ${tone || ''}`}>{value}</dd></div>;
}

const inches = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The engine's score breakdown for a finished round, with every deduction and bonus itemized. */
export function TelemetryAuditTable({ snapshot: s }: { snapshot: EngineSnapshot }) {
  const shift = s.mode1, conveyor = s.mode2;
  const seconds = ((conveyor?.elapsed_ms ?? shift?.elapsed_ms ?? 0) / 1000).toFixed(2);
  return <dl className="f3-telemetry-table">
    <Row label="Cases stacked" value={`${plural(s.cases_placed, 'carton')} (${s.total_weight_lbs} lbs)`} />
    <Row label="Stack height" value={`${inches(s.max_height_inches)}″ / 60″ envelope`} />
    <Row label="Crush deductions" tone={s.crush_penalty > 0 && 'penalty'}
      value={s.crush_penalty > 0 ? `−${s.crush_penalty.toFixed(1)}% (${plural(s.crushed_count, 'case')} collapsed)` : '0.0%'} />
    <Row label="Overhang penalty" tone={s.overhang_penalty > 0 && 'penalty'}
      value={s.overhang_penalty > 0 ? `−${s.overhang_penalty.toFixed(1)}% perimeter breach` : '0.0%'} />
    <Row label="Center-of-gravity penalty" tone={s.drift_penalty > 0 && 'penalty'}
      value={s.drift_penalty > 0 ? `−${s.drift_penalty.toFixed(1)}% drift offset` : '0.0%'} />
    <Row label="Interlock bonus" tone={s.interlock_bonus > 0 && 'bonus'}
      value={s.interlock_bonus > 0 ? `+${s.interlock_bonus.toFixed(1)}% interlocking` : '0.0%'} />
    {shift && !shift.sandbox && <Row label="Early finish bonus" tone={!!shift.early_finish_bonus && 'bonus'}
      value={`+${shift.early_finish_bonus ?? 0} pts`} />}
    <Row label={conveyor ? 'Throughput time' : 'Time on shift'}
      value={`${seconds}s${conveyor && !conveyor.sandbox ? ` (${conveyor.diversions_count}/5 diversions)` : ''}`} />
  </dl>;
}
