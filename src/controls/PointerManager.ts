/** Movement that turns a press into a drag (SPEC-01 §6.1). */
export const DRAG_THRESHOLD_PX = 6;
/** A touch drag aims this far above the finger, so the finger never hides the landing spot. */
export const TOUCH_LIFT_PX = 64;
/** Wheel events closer together than this belong to one scroll (trackpads send dozens). */
const WHEEL_BURST_GAP_MS = 200;

/** CSS pixels from the element's top-left corner. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** What a press landed on. Pressing a draggable target claims the gesture from the camera. */
export interface Hit<T> {
  target: T;
  draggable: boolean;
}

export interface PointerHandlers<T> {
  /** What a primary press lands on, if anything. */
  hitTest(point: ScreenPoint): Hit<T> | undefined;
  /** A press released within the drag threshold; `undefined` when it landed on nothing. */
  tap(target: T | undefined): void;
  dragStart(target: T): void;
  dragMove(point: ScreenPoint): void;
  drop(): void;
  /** The drag was interrupted; nothing should be placed. */
  cancel(): void;
  rotate(): void;
  flip(): void;
}

interface Press<T> {
  pointerId: number;
  origin: ScreenPoint;
  lift: number;
  hit?: Hit<T>;
  /** Claimed from the camera: the press can become a case drag. */
  claimed: boolean;
  dragging: boolean;
  /** No longer a tap or drag candidate (it moved off as an orbit, or a second finger landed). */
  abandoned: boolean;
}

/**
 * One Pointer Events pipeline for mouse, pen, and touch. Presses on draggable targets are
 * claimed (stopped before they reach the camera controls on the canvas inside `element`);
 * everything else passes through, and only short presses count as taps.
 */
export class PointerManager<T> {
  private press?: Press<T>;
  private lastWheel = -Infinity;
  private readonly element: HTMLElement;
  private readonly handlers: PointerHandlers<T>;
  private readonly listeners: [EventTarget, string, (event: never) => void, AddEventListenerOptions][];

  constructor(element: HTMLElement, handlers: PointerHandlers<T>, { keys = window as EventTarget } = {}) {
    this.element = element;
    this.handlers = handlers;
    this.listeners = [
      [element, 'pointerdown', this.onPointerDown, { capture: true }],
      [element, 'pointermove', this.onPointerMove, {}],
      [element, 'pointerup', this.onPointerUp, {}],
      [element, 'pointercancel', this.onPointerCancel, {}],
      [element, 'wheel', this.onWheel, { capture: true, passive: false }],
      [element, 'contextmenu', this.onContextMenu, { capture: true }],
      [keys, 'keydown', this.onKeyDown, {}],
    ];
    for (const [target, type, listener, options] of this.listeners) {
      target.addEventListener(type, listener as EventListener, options);
    }
  }

  dispose() {
    if (this.press?.dragging) this.handlers.cancel();
    this.press = undefined;
    for (const [target, type, listener, options] of this.listeners) {
      target.removeEventListener(type, listener as EventListener, options);
    }
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    const press = this.press;
    if (press?.dragging) {
      // In-drag second finger tap (or any extra pointer): rotate the held case.
      event.stopPropagation();
      event.preventDefault();
      this.handlers.rotate();
      return;
    }
    if (press) {
      // A second pointer: the first press can no longer be a tap.
      press.abandoned = true;
      if (press.claimed) event.stopPropagation();
      return;
    }
    // Right- and middle-button presses belong to the camera (pan).
    if (event.button !== 0) return;
    const point = this.local(event);
    const hit = this.handlers.hitTest(point);
    const claimed = hit?.draggable === true;
    const lift = event.pointerType === 'touch' ? TOUCH_LIFT_PX : 0;
    this.press = { pointerId: event.pointerId, origin: point, lift, hit, claimed, dragging: false, abandoned: false };
    if (claimed) {
      event.stopPropagation();
      this.element.setPointerCapture(event.pointerId);
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) return;
    const point = this.local(event);
    if (press.abandoned) return;
    if (!press.dragging) {
      if (Math.hypot(point.x - press.origin.x, point.y - press.origin.y) < DRAG_THRESHOLD_PX) return;
      if (!press.claimed) {
        press.abandoned = true; // the camera is orbiting
        return;
      }
      press.dragging = true;
      this.lastWheel = -Infinity;
      this.handlers.dragStart(press.hit!.target);
    }
    this.handlers.dragMove({ x: point.x, y: point.y - press.lift });
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) return;
    this.press = undefined;
    if (press.dragging) this.handlers.drop();
    else if (!press.abandoned) this.handlers.tap(press.hit?.target);
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    const press = this.press;
    if (!press || event.pointerId !== press.pointerId) return;
    this.press = undefined;
    if (press.dragging) this.handlers.cancel();
  };

  /** While dragging, the wheel rotates instead of zooming. */
  private readonly onWheel = (event: WheelEvent) => {
    if (!this.press?.dragging) return;
    const gap = event.timeStamp - this.lastWheel;
    this.lastWheel = event.timeStamp;
    event.stopPropagation();
    event.preventDefault();
    if (gap > WHEEL_BURST_GAP_MS) this.handlers.rotate();
  };

  /** Right-click during a drag rotates. */
  private readonly onContextMenu = (event: MouseEvent) => {
    if (!this.press?.dragging) return;
    event.stopPropagation();
    event.preventDefault();
    this.handlers.rotate();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.press?.dragging || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditable(event.target)) return;
    const key = event.key.toLowerCase();
    if (key !== 'r' && key !== 'f') return;
    event.preventDefault();
    if (key === 'r') this.handlers.rotate();
    else this.handlers.flip();
  };

  private local(event: PointerEvent): ScreenPoint {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
}

function isEditable(target: EventTarget | null) {
  const element = target as Partial<HTMLElement> | null;
  return !!element && (element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? ''));
}
