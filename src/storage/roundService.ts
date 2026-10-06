import { openStorage } from './db';
import { parseBackup, validateRound } from './validation';
import type { Backup, PersonalBestRecord, RoundRecord } from './types';

function updateBest(round: RoundRecord, previous?: PersonalBestRecord): PersonalBestRecord {
  // The engine scores an empty pallet as 100% quality; it must not count as a best build.
  const built = round.cases_placed > 0;
  const completed = built && (round.end_reason === 'shipped' || round.end_reason === 'all_placed');
  const fastest = completed ? Math.min(previous?.fastest_completion_ms ?? Infinity, round.duration_ms) : previous?.fastest_completion_ms;
  const high_score = Math.max(previous?.high_score ?? 0, round.final_score);
  const highest_quality_pct = Math.max(previous?.highest_quality_pct ?? 0, built ? round.quality_pct : 0);
  const max_cases_placed = Math.max(previous?.max_cases_placed ?? 0, round.cases_placed);
  const improved = !previous || high_score > previous.high_score || highest_quality_pct > previous.highest_quality_pct
    || max_cases_placed > previous.max_cases_placed || fastest !== previous.fastest_completion_ms;
  return { mode: round.mode, high_score, highest_quality_pct, max_cases_placed,
    ...(fastest === undefined ? {} : { fastest_completion_ms: fastest }),
    achieved_at: improved ? round.timestamp : previous.achieved_at };
}
/** Atomic round + best writes; a stable round UUID makes Strict Mode and retries idempotent. */
export const roundService = {
  async save(round: RoundRecord) {
    validateRound(round);
    const db = await openStorage();
    const tx = db.transaction(['rounds', 'personal_bests'], 'readwrite');
    if (!await tx.objectStore('rounds').get(round.id)) {
      await tx.objectStore('rounds').add(round);
      const best = await tx.objectStore('personal_bests').get(round.mode);
      await tx.objectStore('personal_bests').put(updateBest(round, best));
    }
    await tx.done;
  },
  async list() {
    const rounds = await (await openStorage()).getAll('rounds');
    return rounds.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  async get(id: string) { return (await openStorage()).get('rounds', id); },
  async bests() { return (await openStorage()).getAll('personal_bests'); },

  async exportData(): Promise<Backup> {
    const tx = (await openStorage()).transaction(['rounds', 'personal_bests']);
    const [rounds, personal_bests] = await Promise.all([tx.objectStore('rounds').getAll(), tx.objectStore('personal_bests').getAll()]);
    await tx.done;
    return { version: 1, rounds, personal_bests };
  },
  async importData(json: string) {
    const backup = parseBackup(json); // Validate the entire file before opening a write transaction.
    const tx = (await openStorage()).transaction(['rounds', 'personal_bests'], 'readwrite');
    let imported = 0;
    for (const round of backup.rounds) {
      if (!await tx.objectStore('rounds').get(round.id)) { await tx.objectStore('rounds').add(round); imported++; }
    }
    const rounds = await tx.objectStore('rounds').getAll();
    const bests = new Map<RoundRecord['mode'], PersonalBestRecord>();
    for (const round of rounds.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
      bests.set(round.mode, updateBest(round, bests.get(round.mode)));
    }
    await tx.objectStore('personal_bests').clear();
    for (const best of bests.values()) await tx.objectStore('personal_bests').put(best);
    await tx.done;
    return imported;
  },
  async clear() {
    const tx = (await openStorage()).transaction(['rounds', 'personal_bests'], 'readwrite');
    await Promise.all([tx.objectStore('rounds').clear(), tx.objectStore('personal_bests').clear()]);
    await tx.done;
  },
};
