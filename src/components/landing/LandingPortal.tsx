import { useState } from 'react';
import { Box, Volume2, VolumeX } from 'lucide-react';
import { AmbientPallet } from './AmbientPallet';
import { HeroConsole } from './HeroConsole';
import { ModeTilesStack, type LandingMode } from './ModeTilesStack';
import { RulesModal } from './RulesModal';
import { useCareerStats } from './CareerStatsRow';
import { PalletGalleryModal } from '../gallery/PalletGalleryModal';
import { sfx } from '../../utils/audio';
import '../../styles/landing.css';

export function LandingPortal({ onSelectMode, seed, galleryOpen = false, closeGallery, sandbox, setSandbox }: {
  onSelectMode(mode: LandingMode): void; seed?: bigint; galleryOpen?: boolean; closeGallery(): void;
  sandbox: boolean; setSandbox(sandbox: boolean): void;
}) {
  const [selected, setSelected] = useState<LandingMode>(galleryOpen ? 'gallery' : 1);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sound, setSound] = useState(sfx.enabled);
  const stats = useCareerStats(galleryOpen);
  const select = (mode: LandingMode) => { sfx.playClick(); setSelected(mode); };
  const launch = (mode: LandingMode) => { sfx.playLaunch(); onSelectMode(mode); };
  return <div className="landing-portal">
    <AmbientPallet seed={seed} />
    <div className="landing-ambient-overlay" aria-hidden="true" /><div className="landing-grid-mesh" aria-hidden="true" />
    <header className="landing-top-bar">
      <a className="landing-brand" href={window.location.pathname} aria-label="Idle Distribution home" onClick={event => { event.preventDefault(); closeGallery(); }}>
        <span className="landing-brand-icon"><Box size={22} strokeWidth={1.6} aria-hidden="true" /></span>
        <span className="landing-brand-meta"><strong>IDLE DISTRIBUTION<span className="landing-brand-pill">STAGING TERMINAL</span></strong><span>AUTONOMOUS PALLET STAGING &amp; CONVEYOR LINE SORTER</span></span>
      </a>
      <div className="landing-terminal-status"><span><i />LINE 4B: ONLINE</span><span>PALLET: 48″ × 40″</span></div>
    </header>
    <main className="landing-main">
      <div className="v3-portal-grid">
        <HeroConsole selected={selected} stats={stats} launch={() => launch(selected)} openRules={() => { sfx.playClick(); setRulesOpen(true); }}
          sandbox={sandbox} setSandbox={value => { sfx.playClick(); setSandbox(value); }} />
        <ModeTilesStack selected={selected} stats={stats} select={select} launch={launch} />
      </div>
    </main>
    <footer className="landing-bottom-bar">
      <div className="landing-telemetry"><span><i />Pallet engine ready</span><span>{stats.status === 'ready' ? 'Saved on this device' : stats.status === 'loading' ? 'Loading saved builds…' : 'Saved builds unavailable'}</span><span>Target height: 60″ ceiling</span></div>
      <button type="button" className="landing-sound" aria-pressed={sound} disabled={!sfx.supported} onClick={() => {
        const enabled = !sound; sfx.setEnabled(enabled); setSound(enabled); if (enabled) sfx.playClick();
      }}>{sound ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}Sound {sound ? 'on' : 'off'}</button>
    </footer>
    {rulesOpen && <RulesModal close={() => setRulesOpen(false)} />}
    {galleryOpen && <PalletGalleryModal close={closeGallery} />}
  </div>;
}
