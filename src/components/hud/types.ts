import type { ReactNode } from 'react';
import type { NudgeDirection } from '../../controls/PointerManager';
import type { Orientation } from '../../scene/coordinates';
import type { SkuDef } from '../../types/catalog';
import type { ConveyorStatus, Difficulty, EngineSnapshot } from '../../types/engine';

export interface RoundHud {
  mode: 1 | 2;
  /** Played for fun: Mode 1 has no clock and endless waves; Mode 2 pauses arrivals instead of diverting. */
  sandbox: boolean;
  modeSwitch: ReactNode;
  handshake: string;
  clock: string;
  timerLabel: string;
  heading: string;
  description: string;
  complete: boolean;
  result?: EngineSnapshot;
  resultTitle: string;
  canShip: boolean;
  ship(): void;
  restart(): void;
  /** Leave the finished round for the Smoke Break mini game; it ends in a new round. */
  smokeBreak(): void;
  conveyor?: ConveyorStatus;
  difficulty?: { value: Difficulty; set(value: Difficulty): void };
  /** The shipped pallet has been hauled away; start the next pallet. */
  onHauled?(): void;
  /** The shipped pallet is saved silently and the hauler takes over, so no result modal. */
  silentResult?: boolean;
  /** A new pallet is delivered by the hauler before play starts. */
  arrival?: boolean;
  sound?: ReactNode;
}
export interface ActiveCase {
  sku: SkuDef;
  orientation: Orientation;
  holding: boolean;
  /** Held, or placed and selected: the nudges, Rotate, Flip, Remove, and Done apply to it. */
  adjustable: boolean;
  grid?: [number, number];
  verdict?: string;
}
export interface CaseActions {
  rotate(): void;
  flip(): void;
  remove(): void;
  done(): void;
  nudge(direction: NudgeDirection): void;
}
export interface ResultModalProps {
  snapshot: EngineSnapshot;
  title: string;
  restart(): void;
  smokeBreak(): void;
  exportReplay(): void;
  save: { status: 'saving' | 'saved' | 'error'; retry(): void };
  /** The Pallet gallery and Saved data buttons. */
  storageControls: ReactNode;
}
/** Ticket 07's display label for the engine's S tier; scoring stays authoritative in Rust. */
export const gradeLabel = (grade: EngineSnapshot['grade']) => grade === 'S' ? 'A+' : grade;
export const displayGrade = (snapshot: EngineSnapshot) => gradeLabel(snapshot.grade);
