import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import { BREAK_MS, PRESSES_PER_CIGARETTE, freshBreak, press, remainingMs, type SmokeBreak } from './smokeBreak';
import { SmokeBreakScene } from './SmokeBreakScene';

/** Smoke Break Simulator: mash space to smoke as many cigarettes as possible before the break ends. */
export function SmokeBreakGame({ finish }: { finish(): void }) {
  const [state, dispatch] = useReducer((s: SmokeBreak, now: number) => press(s, now), undefined, freshBreak);
  const [now, setNow] = useState(() => performance.now());
  const [error, setError] = useState(false);
  const done = state.startedAt !== undefined && remainingMs(state, now) === 0;
  const doneRef = useRef(done);
  doneRef.current = done;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SmokeBreakScene>();
  const drag = () => { if (!doneRef.current) dispatch(performance.now()); };
  /** Touch devices tap anywhere on the screen; every finger that lands is a drag. */
  const [touch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const tap = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    if (event.pointerType === 'touch' && !doneRef.current) navigator.vibrate?.(8);
    drag();
  };
  // A finger still mashing when time runs out must not land on Start new shift.
  const [armed, setArmed] = useState(false);
  const newShift = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (armed) newShift.current?.focus(); }, [armed]);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setArmed(true), 800);
    return () => clearTimeout(id);
  }, [done]);

  useEffect(() => {
    try { scene.current = new SmokeBreakScene(host.current!); }
    catch { setError(true); }
    return () => { scene.current?.dispose(); scene.current = undefined; };
  }, []);

  // Every press is a drag; the press that finishes a cigarette stubs it out and lights the next.
  const last = useRef(state);
  useEffect(() => {
    const previous = last.current;
    last.current = state;
    if (state === previous) return;
    if (state.smoked > previous.smoked) scene.current?.finish();
    else scene.current?.inhale(state.progress / PRESSES_PER_CIGARETTE);
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (!event.repeat) drag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (state.startedAt === undefined || done) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [state.startedAt, done]);

  const remaining = remainingMs(state, now);
  const seconds = Math.ceil(remaining / 1000);
  const plural = (n: number) => `${n} ${n === 1 ? 'cigarette' : 'cigarettes'}`;
  return <main className="smoke-break" aria-label="Smoke break" onPointerDown={tap}>
    <header className="hud-command hud-panel">
      <div className="hud-brand"><span className="eyebrow">idleDistribution · BREAK AREA</span><strong>Smoke break simulator</strong></div>
      <div className={`shift-clock ${done ? 'complete' : 'running'}`} role="timer" aria-label="Smoke break time remaining">0:{String(seconds).padStart(2, '0')}</div>
    </header>
    <section className="smoke-viewport" aria-label="Break area">
      <div className="smoke-stage" ref={host} />
      {error && <p className="smoke-fallback">3D view unavailable. You can still smoke: press space or tap the screen.</p>}
      <section className="hud-panel smoke-brief">
        <span className="eyebrow">ON BREAK · {BREAK_MS / 1000} SECONDS</span>
        <h2>{done ? 'Break over. Back to the floor.' : state.startedAt === undefined ? 'Light up.' : 'Keep dragging.'}</h2>
        <p>{state.startedAt === undefined
          ? touch
            ? <>Tap anywhere on the screen to take a drag. The clock starts on your first tap.</>
            : <>Mash <kbd>Space</kbd> or click to take a drag. The clock starts on your first drag.</>
          : <>{touch ? 'Keep tapping. ' : ''}Each cigarette takes {PRESSES_PER_CIGARETTE} drags. The next one lights as soon as you stub one out.</>}</p>
      </section>
      <section className="hud-panel smoke-tally" aria-label="Smoke break tally">
        <span className="eyebrow">BUTTS IN THE TRAY</span>
        <strong>{state.smoked}</strong>
        <span className="eyebrow">CURRENT CIGARETTE</span>
        <meter aria-label="Current cigarette smoked" value={state.progress} max={PRESSES_PER_CIGARETTE} />
        <span className="eyebrow">BREAK LEFT</span>
        <meter aria-label="Break time left" value={remaining} max={BREAK_MS} />
      </section>
      {done && <section className="hud-panel smoke-result" role="dialog" aria-labelledby="smoke-result-title">
        <span className="eyebrow">BREAK REPORT</span>
        <h2 id="smoke-result-title">{plural(state.smoked)} in {BREAK_MS / 1000} seconds</h2>
        <p>Supervisor's waving you back in.</p>
        <button type="button" className="ship" ref={newShift} disabled={!armed} onClick={finish}>Start new shift</button>
      </section>}
    </section>
  </main>;
}
