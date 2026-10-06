import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StagingBay } from '../../scene/staging';
import type { EngineSnapshot } from '../../types/engine';
import { ActionButtons, CaseInspector, QualityPanel, ShipButton, WarehouseFeed } from './DesktopDashboard';
import type { ActiveCase, CaseActions, RoundHud } from './types';

export type WarehouseTheme = 'industrial' | 'studio' | 'blueprint';

function RepeatButton({ label, children, disabled, step }: { label: string; children: ReactNode; disabled: boolean; step(): void }) {
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const interval = useRef<ReturnType<typeof setInterval>>();
  const latest = useRef(step); latest.current = step;
  const stop = () => { clearTimeout(timeout.current); clearInterval(interval.current); };
  useEffect(() => {
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', stop);
    return () => { stop(); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); };
  }, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  return <button type="button" aria-label={label} disabled={disabled}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); stop(); event.currentTarget.setPointerCapture(event.pointerId); latest.current();
      timeout.current = setTimeout(() => { interval.current = setInterval(() => latest.current(), 100); }, 350);
    }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onClick={event => { if (event.detail === 0) latest.current(); }}>{children}</button>;
}

export function MobileHud({ round, snapshot, bays, active, actions, cameras, message, menuOpen, closeMenu, theme, setTheme, storageControls }: {
  round: RoundHud; snapshot: EngineSnapshot; bays: readonly StagingBay[]; active?: ActiveCase; actions: CaseActions;
  storageControls: ReactNode; cameras: ReactNode; message: string; menuOpen: boolean; closeMenu(): void; theme: WarehouseTheme; setTheme(theme: WarehouseTheme): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (menuOpen) dialog.current?.showModal(); else dialog.current?.close();
  }, [menuOpen]);
  return <>
    <section className="mobile-deck hud-panel" aria-label="Active case inspector">
      {active ? <CaseInspector active={active} /> : <div className="case-inspector"><p>Tap a carton to pick. Use arrows to aim, then Done to place.</p></div>}
      <div className="dpad" aria-label="Camera-relative 2 inch movement">
        {(['up', 'left', 'right', 'down'] as const).map((direction, i) => <div className={`dpad-${direction}`} key={direction}>
          <RepeatButton label={`Nudge ${direction}`} disabled={!active?.holding || round.complete} step={() => actions.nudge(direction)}>{['↑', '←', '→', '↓'][i]}</RepeatButton>
        </div>)}<span>2″</span>
      </div>
      <ActionButtons active={active} actions={actions} locked={round.complete} /><ShipButton round={round} />
      <p className="placement-status" aria-live="polite">{message}</p>
    </section>
    <dialog ref={dialog} className="warehouse-drawer hud-panel" aria-label="Warehouse menu" onCancel={closeMenu} onClose={closeMenu}>
      <div className="drawer-heading"><h2>Warehouse menu</h2><button type="button" onClick={closeMenu} aria-label="Close warehouse menu">Close</button></div>
      {cameras}
      <label className="theme-picker">Warehouse theme<select value={theme} onChange={event => setTheme(event.target.value as WarehouseTheme)}>
        <option value="industrial">Industrial Dock</option><option value="studio">Modern Studio</option><option value="blueprint">CAD Blueprint</option>
      </select></label>
      {storageControls}
      {round.sound}
      <details><summary>Instructions</summary><p>Tap a waiting carton to pick it. Use the arrows to move in 2-inch steps relative to your camera; hold to repeat. Rotate or flip, then Done to place. Remove returns a held carton or removes an exposed placed carton. You can also drag directly.</p></details>
      <div className="drawer-metrics"><WarehouseFeed round={round} bays={bays} /><QualityPanel snapshot={snapshot} /></div>
      {confirmReset ? <div className="reset-confirmation"><p>Clear this run and reset the warehouse theme?</p>
        <button type="button" onClick={() => { setTheme('industrial'); closeMenu(); round.restart(); }}>Confirm reset</button>
        <button type="button" onClick={() => setConfirmReset(false)}>Keep playing</button></div>
        : <button type="button" onClick={() => setConfirmReset(true)}>Reset game data</button>}
    </dialog>
  </>;
}
