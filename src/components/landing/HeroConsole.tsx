import { ArrowRight, CircleHelp } from 'lucide-react';
import { CareerStatsRow, type CareerStats } from './CareerStatsRow';
import type { LandingMode } from './ModeTilesStack';

export function HeroConsole({ selected, stats, launch, openRules, sandbox, setSandbox }: {
  selected: LandingMode; stats: CareerStats; launch(): void; openRules(): void; sandbox: boolean; setSandbox(sandbox: boolean): void;
}) {
  const label = selected === 'gallery' ? 'Open 3D Pallet Gallery'
    : sandbox ? `Launch ${selected === 1 ? 'Floor' : 'Conveyor'} Sandbox`
    : selected === 1 ? 'Launch 100-Case Sprint' : 'Launch Conveyor Mode';
  return <section className="v3-hero-left" aria-labelledby="landing-title">
    <div className="v3-eyebrow"><i aria-hidden="true" /> OPERATIONAL DISPATCH // DC-04 · BAY 2B</div>
    <h1 className="v3-headline" id="landing-title">Master Pallet Staging.<br /><span className="highlight">Build Higher. Crush Less.</span></h1>
    <p className="v3-lead">Autonomous material handling simulator. Balance 48″×40″ wooden stringer pallets, manage incoming high-speed conveyor arrivals, and maximize composite load quality.</p>
    <CareerStatsRow stats={stats} />
    {selected !== 'gallery' && <div className="v3-play-style" role="group" aria-label="Play style">
      <button type="button" aria-pressed={!sandbox} onClick={() => setSandbox(false)}><strong>Timed</strong><span>Clock, Estop, ranked</span></button>
      <button type="button" aria-pressed={sandbox} onClick={() => setSandbox(true)}><strong>Sandbox</strong><span>No clock, no Estop, just stacking</span></button>
    </div>}
    <div className="v3-left-actions">
      <button type="button" className="v3-quick-btn" onClick={launch}>{label}<ArrowRight size={17} aria-hidden="true" /></button>
      <button type="button" className="v3-secondary-link" onClick={openRules}><CircleHelp size={15} aria-hidden="true" />View Rule Specifications</button>
    </div>
  </section>;
}
