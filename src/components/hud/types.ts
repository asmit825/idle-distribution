import type { ReactNode } from 'react';
import type { Orientation } from '../../scene/coordinates';
import type { SkuDef } from '../../types/catalog';
import type { ConveyorStatus, EngineSnapshot } from '../../types/engine';

export interface RoundHud {
  mode: 1 | 2;
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
  conveyor?: ConveyorStatus;
  sound?: ReactNode;
}
export interface ActiveCase {
  sku: SkuDef;
  orientation: Orientation;
  holding: boolean;
  removable: boolean;
  grid?: [number, number];
  verdict?: string;
}
export interface CaseActions {
  rotate(): void;
  flip(): void;
  remove(): void;
  done(): void;
  nudge(direction: 'up' | 'down' | 'left' | 'right'): void;
}
/** Ticket 07's display label for the engine's S tier; scoring stays authoritative in Rust. */
export const gradeLabel = (grade: EngineSnapshot['grade']) => grade === 'S' ? 'A+' : grade;
export const displayGrade = (snapshot: EngineSnapshot) => gradeLabel(snapshot.grade);
