import { useEffect, useState } from 'react';
import { roundService } from '../../storage/roundService';

export interface CareerStats {
  shipped: number;
  saved: number;
  topQuality?: number;
  sprintQuality?: number;
  status: 'loading' | 'ready' | 'unavailable';
}

/** Reload on arrival at the terminal so completed shifts are reflected immediately. */
export function useCareerStats(refreshKey: boolean): CareerStats {
  const [stats, setStats] = useState<CareerStats>({ shipped: 0, saved: 0, status: 'loading' });
  useEffect(() => {
    let active = true;
    void roundService.list().then(rounds => {
      if (!active) return;
      // Sandbox pallets stay in the gallery but are play, not a career record.
      const builds = rounds.filter(round => round.cases_placed > 0 && !round.sandbox);
      const sprints = builds.filter(round => round.mode === 'free_staging_100');
      setStats({
        shipped: builds.filter(round => round.end_reason === 'shipped' || round.end_reason === 'all_placed').length,
        saved: rounds.length,
        topQuality: builds.length ? Math.max(...builds.map(round => round.quality_pct)) : undefined,
        sprintQuality: sprints.length ? Math.max(...sprints.map(round => round.quality_pct)) : undefined,
        status: 'ready',
      });
    }).catch(() => { if (active) setStats({ shipped: 0, saved: 0, status: 'unavailable' }); });
    return () => { active = false; };
  }, [refreshKey]);
  return stats;
}

export function CareerStatsRow({ stats }: { stats: CareerStats }) {
  return <dl className="v3-stats-row" aria-label="Career statistics" aria-busy={stats.status === 'loading'}>
    <div className="v3-stat-card"><dt>Pallets Shipped</dt><dd>{stats.status === 'ready' ? stats.shipped.toLocaleString() : '—'}</dd></div>
    <div className="v3-stat-card"><dt>Top Load Quality</dt><dd>{stats.topQuality === undefined ? '—' : `${Math.round(stats.topQuality)}%`}</dd></div>
    <div className="v3-stat-card"><dt>Max Build Ceiling</dt><dd>60<span>″</span></dd></div>
  </dl>;
}
