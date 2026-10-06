import { useEffect, useRef, useState } from 'react';
import type { EngineSnapshot } from '../types/engine';
import { roundService } from '../storage/roundService';
import type { RoundRecord } from '../storage/types';

/** randomUUID is limited to secure contexts; plain-http LAN play still needs a v4 UUID. */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function capture(snapshot: EngineSnapshot): RoundRecord {
  const shift = snapshot.mode1, conveyor = snapshot.mode2;
  if (!shift?.end_reason && !conveyor?.end_reason) throw new Error('Cannot save an unfinished round.');
  return {
    id: uuid(), timestamp: new Date().toISOString(),
    mode: shift ? 'free_staging_100' : 'conveyor_diversion', seed: shift?.seed ?? conveyor!.seed,
    duration_ms: shift ? 60000 - shift.time_remaining_ms : conveyor!.elapsed_ms,
    cases_placed: snapshot.cases_placed, total_weight_lbs: snapshot.total_weight_lbs,
    volume_utilization_pct: snapshot.volume_utilization_pct, stability_index_pct: snapshot.quality_pct,
    quality_pct: snapshot.quality_pct, composite_score: snapshot.composite_score, grade: snapshot.grade,
    crush_count: snapshot.crushed_count, overhang_inches: snapshot.max_overhang_inches,
    end_reason: shift?.end_reason ?? conveyor!.end_reason!, final_score: shift?.final_score ?? snapshot.composite_score,
    ...(conveyor ? { diversions_count: conveyor.diversions_count, estop_triggered: conveyor.end_reason === 'estop' } : {}),
    pallet_snapshot: snapshot.placed_cases.map(({ load_lbs: _load, ...placed }) => ({ ...placed, id: String(placed.id) })),
  };
}

/** Lives for one keyed game round. Writes continue even if the player immediately starts another run. */
export function useRoundAutoSave(result?: EngineSnapshot) {
  const record = useRef<RoundRecord>();
  const saved = useRef(false);
  const [status, setStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Mode 2 republishes fresh snapshots after the round ends; one successful write is final.
    if (!result || saved.current) return;
    let active = true;
    setStatus('saving');
    void Promise.resolve().then(() => roundService.save(record.current ??= capture(result))).then(() => { saved.current = true; if (active) setStatus('saved'); })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [result, attempt]);
  return { status, retry: () => setAttempt(value => value + 1) };
}
