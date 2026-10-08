import { useEffect, useRef } from 'react';
import { Box, X } from 'lucide-react';

export function RulesModal({ close }: { close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => { element.close(); if (opener instanceof HTMLElement) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="landing-rules" aria-labelledby="rules-title" onCancel={close}
    onClick={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    } }}>
    <button type="button" className="landing-close" aria-label="Close rules" onClick={close}><X size={18} /></button>
    <span className="v3-eyebrow"><Box size={17} aria-hidden="true" /> WAREHOUSE STAGING STANDARDS</span>
    <h2 id="rules-title">Rules &amp; pallet physics</h2>
    <p className="landing-rules-intro">Build a stable load. Keep the heavy cases low and every carton supported.</p>
    <div className="landing-rules-grid">
      <section><h3>48″ × 40″ stringer pallet</h3><p>Place cartons on a 2″ grid. Rotate in 90° steps or flip a case on its side. The build ceiling is 60″ above the deck.</p></section>
      <section><h3>Top-load capacity &amp; crushing</h3><p>Each carton has a rated load capacity. Exceeding it crushes the carton and costs 15 quality points. Mode 1 also bans heavy cases on light or fragile cases.</p></section>
      <section><h3>Support &amp; balance</h3><p>Keep at least 70% of a carton's base supported. Up to 2″ of overhang is allowed, costing 5 quality points per inch. Center the weight and bridge layers to improve quality.</p></section>
      <section><h3>Load quality &amp; scoring</h3><p>Composite score = placed cases × quality percentage. The top tier starts at 90% (S, shown as A+ in the game), followed by A at 80%, B at 70%, C at 60%, and F below.</p></section>
      <section><h3>Mode 01 · 100-case sprint</h3><p>Your first pick starts the 60-second clock. Ship whenever you are ready, or keep stacking until the timer ends. Place all 100 cases before time runs out to earn a time bonus.</p></section>
      <section><h3>Mode 02 · conveyor line</h3><p>Pick cartons on the final run. The recirculation lane holds 10; overflow diverts a carton, and five diversions stop the line. Build to 60″ for a full pallet; shipping early reduces your score and grade.</p></section>
      <section><h3>Sandbox</h3><p>Just want to stack? Switch either mode to Sandbox. Mode 1 drops the clock and keeps dealing waves until you ship. In Mode 2 nothing diverts: a full recirculation lane pauses the line until you make room. Sandbox pallets are kept in the gallery but never count toward bests.</p></section>
    </div>
    <p className="landing-controls"><strong>Controls</strong> Drag a carton or tap to pick. Arrows / WASD move it 2″, R rotates, F flips, and Enter accepts. On touch screens, use the on-screen arrows and action buttons.</p>
    <button type="button" className="v3-quick-btn" onClick={close}>Got it, ready to stage<span aria-hidden="true">✓</span></button>
  </dialog>;
}
