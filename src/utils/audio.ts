const SOUND_KEY = 'idle-distribution:portal-sound';

class SoundEffects {
  private ctx: AudioContext | null = null;
  enabled = this.readPreference();

  get supported() { return typeof window !== 'undefined' && !!this.audioConstructor(); }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    try { localStorage.setItem(SOUND_KEY, String(enabled)); } catch { /* Sound works without persistent storage. */ }
  }

  playClick(freq = 600, duration = 0.04) { this.play('sine', freq, 180, duration, 0.12); }
  playLaunch() { this.play('triangle', 140, 45, 0.12, 0.2); }

  dispose() {
    const context = this.ctx;
    this.ctx = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  private readPreference() {
    try { return localStorage.getItem(SOUND_KEY) !== 'false'; } catch { return true; }
  }

  private audioConstructor() {
    return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  }

  private play(type: OscillatorType, start: number, end: number, duration: number, volume: number) {
    if (!this.enabled || !this.supported) return;
    try {
      const Audio = this.audioConstructor()!;
      const context = this.ctx ??= new Audio();
      const emit = () => {
        if (!this.enabled || this.ctx !== context || context.state !== 'running') return;
        const oscillator = context.createOscillator(), gain = context.createGain();
        const now = context.currentTime;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(start, now);
        oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(now); oscillator.stop(now + duration);
      };
      if (context.state === 'suspended') void context.resume().then(emit).catch(() => {});
      else emit();
    } catch { /* Audio is optional, including in browsers that block its creation. */ }
  }
}

export const sfx = new SoundEffects();
if (import.meta.hot) import.meta.hot.dispose(() => sfx.dispose());
