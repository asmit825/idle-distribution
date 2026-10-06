import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConveyorStatus } from '../types/engine';

/** Short, quiet warehouse klaxons. Audio unlocks only after a user gesture and can be muted. */
export function useConveyorAudio(status: ConveyorStatus | undefined) {
  const context = useRef<AudioContext>();
  const wanted = useRef(true);
  const mounted = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const supported = typeof AudioContext !== 'undefined';
  const activate = useCallback(() => {
    if (!wanted.current || !mounted.current || !supported) return;
    const audio = context.current ??= new AudioContext();
    void audio.resume().then(() => {
      if (mounted.current && wanted.current && context.current === audio) setEnabled(audio.state === 'running');
    }).catch(() => { /* Browsers may require a later explicit gesture; the sound button retries. */ });
  }, [supported]);

  useEffect(() => {
    mounted.current = true;
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    if (navigator.userActivation?.hasBeenActive) activate();
    return () => {
      mounted.current = false;
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
      const audio = context.current;
      context.current = undefined;
      if (audio && audio.state !== 'closed') void audio.close();
    };
  }, [activate]);

  const cue = status?.end_reason === 'estop' ? 'estop'
    : !status?.end_reason && status?.signal === 'red' ? 'saturation' : undefined;
  useEffect(() => {
    const audio = context.current;
    if (!enabled || !cue || !audio || audio.state !== 'running') return;
    const voices: { oscillator: OscillatorNode; gain: GainNode }[] = [];
    // Alternating notes make the warning distinct from the longer shutdown alarm.
    const notes = cue === 'estop' ? 6 : 2;
    for (let note = 0; note < notes; note++) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + note * 0.22;
      oscillator.type = 'triangle';
      oscillator.frequency.value = note % 2 === 0 ? 660 : 440;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.015);
      gain.gain.linearRampToValueAtTime(0, start + 0.18);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(start); oscillator.stop(start + 0.2);
      voices.push({ oscillator, gain });
    }
    return () => {
      for (const { oscillator, gain } of voices) {
        oscillator.stop(); oscillator.disconnect(); gain.disconnect();
      }
    };
  }, [cue, enabled]);

  const toggle = useCallback(() => {
    wanted.current = !enabled;
    if (enabled) setEnabled(false);
    else activate();
  }, [enabled, activate]);
  return { enabled, toggle, supported };
}
