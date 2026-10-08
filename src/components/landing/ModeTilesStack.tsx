import { ArrowRight, Box, Check, Timer, type LucideProps } from 'lucide-react';
import type { CareerStats } from './CareerStatsRow';

export type LandingMode = 1 | 2 | 'gallery';

function ConveyorIcon({ size, strokeWidth }: LucideProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="10" width="20" height="7" rx="3.5" /><path d="M5 17v4m14-4v4M8 10V3h8v7M12 3v3" />
    <circle cx="6" cy="13.5" r=".75" /><circle cx="12" cy="13.5" r=".75" /><circle cx="18" cy="13.5" r=".75" />
  </svg>;
}

function qualityLabel(quality: number) {
  const grade = quality >= 90 ? 'S' : quality >= 80 ? 'A' : quality >= 70 ? 'B' : quality >= 60 ? 'C' : 'F';
  return `${grade} (${Math.round(quality)}%)`;
}

export function ModeTilesStack({ selected, stats, select, launch }: {
  selected: LandingMode; stats: CareerStats; select(mode: LandingMode): void; launch(mode: LandingMode): void;
}) {
  const modes = [
    { id: 1, title: 'Mode 01: 100-Case Floor Rush', description: '60-second speed-stacking sprint from floor clusters', icon: Timer,
      telemetry: <><span>Limit: <strong>60.00s</strong></span><span>Supply: <strong>100 Cartons</strong></span><span>Rule: <strong>Heavy-on-Light Ban</strong></span>
        <span>{stats.sprintQuality === undefined ? 'Target' : 'Best'}: <strong className="landing-amber">{stats.sprintQuality === undefined ? 'S (≥90%)' : qualityLabel(stats.sprintQuality)}</strong></span></> },
    { id: 2, title: 'Mode 02: Conveyor Line Sorter', description: 'Inflow pacing, 10-box buffer, 60″ win target, 5-estop limit', icon: ConveyorIcon,
      telemetry: <><span title="Medium difficulty">Arrivals: <strong>3.5s → 2.0s</strong></span><span>Buffer: <strong>10 Max</strong></span><span>Goal: <strong>60″ Height</strong></span>
        <span>Estop: <strong className="landing-crimson">5 Diversions</strong></span></> },
    { id: 'gallery', title: 'Mode 03: 3D Pallet Inspection Bay', description: 'Saved pallet snapshots with load-quality telemetry', icon: Box,
      telemetry: <><span>Saved Builds: <strong>{stats.status === 'ready' ? `${stats.saved} ${stats.saved === 1 ? 'Pallet' : 'Pallets'}` : '—'}</strong></span>
        <span>Inspection: <strong>360° Orbit</strong></span><span>Telemetry: <strong>Crush Creases</strong></span></> },
  ] as const;
  return <section className="v3-cards-stack" aria-label="Select a protocol">
    <div className="landing-stack-label"><span>SELECT YOUR PROTOCOL</span><span>01 — 03</span></div>
    {modes.map(({ id, title, description, icon: Icon, telemetry }) => <button key={id} type="button"
      className={`v3-mode-tile${selected === id ? ' active' : ''}`} aria-label={title} aria-pressed={selected === id}
      onClick={() => select(id)} onDoubleClick={() => launch(id)}>
      <span className="v3-tile-top"><span className="v3-tile-title-group"><span className="v3-tile-icon"><Icon size={21} strokeWidth={1.6} aria-hidden="true" /></span>
        <span className="v3-tile-copy"><span className="v3-tile-title">{title}</span><span className="v3-tile-description">{description}</span></span></span>
        <span className="v3-launch-link">{selected === id ? <Check size={13} aria-hidden="true" /> : <ArrowRight size={13} aria-hidden="true" />}<span>{selected === id ? 'Selected' : 'Select'}</span></span>
      </span><span className="v3-tile-meta">{telemetry}</span>
    </button>)}
    <p className="landing-selection-hint">Select a protocol, then launch your shift.</p>
  </section>;
}
