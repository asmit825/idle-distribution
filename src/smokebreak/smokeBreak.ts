export const BREAK_MS = 15_000;
/** Space presses it takes to finish one cigarette. */
export const PRESSES_PER_CIGARETTE = 12;

export interface SmokeBreak {
  /** Presses into the current cigarette. */
  progress: number;
  smoked: number;
  /** Set on the first press; the clock only runs from then. */
  startedAt?: number;
}

export const freshBreak = (): SmokeBreak => ({ progress: 0, smoked: 0 });

/** One press of the space bar (or tap). Presses after time is up are ignored. */
export function press(state: SmokeBreak, now: number): SmokeBreak {
  const startedAt = state.startedAt ?? now;
  if (now - startedAt >= BREAK_MS) return state;
  const progress = state.progress + 1;
  return progress >= PRESSES_PER_CIGARETTE
    ? { startedAt, progress: 0, smoked: state.smoked + 1 }
    : { startedAt, progress, smoked: state.smoked };
}

export const remainingMs = (state: SmokeBreak, now: number) =>
  state.startedAt === undefined ? BREAK_MS : Math.max(0, BREAK_MS - (now - state.startedAt));

/** Butts per ring in the ashtray before the pile starts a new layer. */
const BUTTS_PER_LAYER = 6;

/**
 * Where the `n`th butt rests in the ashtray, in cm from the bowl's center: a ring of butts lying
 * on the ash bed, each layer rotated half a slot and resting on the one below.
 */
export function buttSlot(n: number) {
  const layer = Math.floor(n / BUTTS_PER_LAYER);
  const angle = (n % BUTTS_PER_LAYER) * (2 * Math.PI / BUTTS_PER_LAYER) + layer * (Math.PI / BUTTS_PER_LAYER);
  const reach = 1.9 - Math.min(layer, 3) * 0.25;
  return { x: Math.cos(angle) * reach, z: Math.sin(angle) * reach, layer, angle };
}
