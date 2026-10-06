import { afterEach, beforeEach, expect, it } from 'vitest';
import { PointerManager, type PointerHandlers, type ScreenPoint } from './PointerManager';

type Target = 'staged-carton' | 'placed-case';

/** A stand-in for the canvas host: positioned at (100, 50) on the page. */
function fakeElement() {
  return Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  });
}

let element: ReturnType<typeof fakeElement>;
let keys: EventTarget;
let log: string[];
let manager: PointerManager<Target>;
let underPointer: { target: Target; draggable: boolean } | undefined;
let clock = 0;

const handlers: PointerHandlers<Target> = {
  hitTest: () => underPointer,
  tap: target => log.push(`tap ${target ?? 'nothing'}`),
  dragStart: target => log.push(`dragStart ${target}`),
  dragMove: ({ x, y }: ScreenPoint) => log.push(`move ${x},${y}`),
  drop: () => log.push('drop'),
  cancel: () => log.push('cancel'),
  rotate: () => log.push('rotate'),
  flip: () => log.push('flip'),
};

beforeEach(() => {
  element = fakeElement();
  keys = new EventTarget();
  log = [];
  underPointer = { target: 'staged-carton', draggable: true };
  clock += 10_000;
  manager = new PointerManager(element as unknown as HTMLElement, handlers, { keys });
});
afterEach(() => manager.dispose());

/** Dispatches an event with read-only DOM fields (clientX, timeStamp, …) defined on it. */
function fire(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ timeStamp: clock, ...fields })) {
    Object.defineProperty(event, key, { value });
  }
  target.dispatchEvent(event);
  return event;
}

/** Page coordinates; the element's origin is (100, 50). */
const pointer = (type: string, x: number, y: number, more: Record<string, unknown> = {}) =>
  fire(element, `pointer${type}`, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...more });

it('treats a press that moves under 6px as a tap, without moving the case', () => {
  pointer('down', 200, 150);
  pointer('move', 204, 153); // 5px
  pointer('up', 204, 153);
  expect(log).toEqual(['tap staged-carton']);
});

it('starts a drag once the pointer has moved 6px, then tracks it to the drop', () => {
  pointer('down', 200, 150);
  pointer('move', 203, 152);
  pointer('move', 206, 150); // 6px from the press
  pointer('move', 240, 170);
  pointer('up', 240, 170);
  expect(log).toEqual(['dragStart staged-carton', 'move 106,100', 'move 140,120', 'drop']);
});

it('claims presses on draggable cases so the camera does not orbit', () => {
  expect(pointer('down', 200, 150).cancelBubble).toBe(true);
});

it('leaves presses elsewhere to the camera: a short one taps, a long one orbits', () => {
  underPointer = undefined;
  expect(pointer('down', 200, 150).cancelBubble).toBe(false);
  pointer('up', 202, 151);
  underPointer = { target: 'placed-case', draggable: false };
  pointer('down', 200, 150);
  pointer('up', 200, 150);
  pointer('down', 200, 150);
  pointer('move', 260, 150);
  pointer('up', 260, 150);
  expect(log).toEqual(['tap nothing', 'tap placed-case']);
});

it('ignores a second finger landing before the first starts dragging, and a pinch is never a tap', () => {
  underPointer = undefined;
  fire(element, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 150 });
  fire(element, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 150 });
  fire(element, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 150 });
  fire(element, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 150 });
  expect(log).toEqual([]);
});

const touch = (type: string, pointerId: number, x: number, y: number) =>
  fire(element, `pointer${type}`, { pointerId, pointerType: 'touch', button: 0, clientX: x, clientY: y });

it('lifts the dragged case 64px above a touching finger, but not above a mouse or pen', () => {
  touch('down', 1, 200, 150);
  touch('move', 1, 200, 170);
  touch('up', 1, 200, 170);
  fire(element, 'pointerdown', { pointerId: 2, pointerType: 'pen', button: 0, clientX: 200, clientY: 150 });
  fire(element, 'pointermove', { pointerId: 2, pointerType: 'pen', button: 0, clientX: 200, clientY: 170 });
  expect(log).toEqual(['dragStart staged-carton', 'move 100,56', 'drop', 'dragStart staged-carton', 'move 100,120']);
});

it('rotates when a second finger taps during a drag, keeping it from the camera', () => {
  touch('down', 1, 200, 150);
  touch('move', 1, 200, 170);
  const second = touch('down', 2, 400, 300);
  expect(second.cancelBubble).toBe(true);
  touch('up', 2, 400, 300);
  touch('move', 1, 210, 170);
  touch('up', 1, 210, 170);
  expect(log).toEqual(['dragStart staged-carton', 'move 100,56', 'rotate', 'move 110,56', 'drop']);
});

it('cancels the drag when the browser cancels the pointer', () => {
  pointer('down', 200, 150);
  pointer('move', 220, 150);
  pointer('cancel', 220, 150);
  pointer('up', 220, 150);
  expect(log).toEqual(['dragStart staged-carton', 'move 120,100', 'cancel']);
});

it('rotates on R and flips on F while dragging, ignoring repeats, shortcuts, and idle presses', () => {
  fire(keys, 'keydown', { key: 'r' });
  pointer('down', 200, 150);
  pointer('move', 220, 150);
  const rotate = fire(keys, 'keydown', { key: 'R' });
  expect(rotate.defaultPrevented).toBe(true);
  fire(keys, 'keydown', { key: 'r', repeat: true });
  fire(keys, 'keydown', { key: 'r', metaKey: true });
  fire(keys, 'keydown', { key: 'f' });
  expect(log).toEqual(['dragStart staged-carton', 'move 120,100', 'rotate', 'flip']);
});

it('rotates on the wheel while dragging, once per burst of trackpad events; otherwise the wheel zooms', () => {
  expect(fire(element, 'wheel', { deltaY: 100 }).cancelBubble).toBe(false);
  pointer('down', 200, 150);
  pointer('move', 220, 150);
  const wheel = fire(element, 'wheel', { deltaY: 100 });
  expect(wheel.cancelBubble && wheel.defaultPrevented).toBe(true);
  clock += 50;
  fire(element, 'wheel', { deltaY: 4 });
  clock += 300;
  fire(element, 'wheel', { deltaY: -100 });
  expect(log).toEqual(['dragStart staged-carton', 'move 120,100', 'rotate', 'rotate']);
});

it('rotates on a right-click during a mouse drag', () => {
  pointer('down', 200, 150);
  pointer('move', 220, 150);
  expect(fire(element, 'contextmenu').defaultPrevented).toBe(true);
  pointer('up', 220, 150);
  expect(fire(element, 'contextmenu').defaultPrevented).toBe(false);
  expect(log).toEqual(['dragStart staged-carton', 'move 120,100', 'rotate', 'drop']);
});

it('cancels an active drag and stops listening when disposed', () => {
  pointer('down', 200, 150);
  pointer('move', 220, 150);
  manager.dispose();
  pointer('move', 230, 150);
  fire(keys, 'keydown', { key: 'r' });
  expect(log).toEqual(['dragStart staged-carton', 'move 120,100', 'cancel']);
});

it('calls handlers as methods, so a class instance keeps `this`', () => {
  class Recorder implements PointerHandlers<Target> {
    calls: string[] = [];
    hitTest() { return { target: 'staged-carton' as const, draggable: true }; }
    tap() { this.calls.push('tap'); }
    dragStart() { this.calls.push('dragStart'); }
    dragMove() { this.calls.push('move'); }
    drop() { this.calls.push('drop'); }
    cancel() { this.calls.push('cancel'); }
    rotate() { this.calls.push('rotate'); }
    flip() { this.calls.push('flip'); }
  }
  manager.dispose();
  const recorder = new Recorder();
  manager = new PointerManager(element as unknown as HTMLElement, recorder, { keys });
  pointer('down', 200, 150);
  pointer('move', 220, 150);
  fire(keys, 'keydown', { key: 'r' });
  fire(keys, 'keydown', { key: 'f' });
  pointer('up', 220, 150);
  expect(recorder.calls).toEqual(['dragStart', 'move', 'rotate', 'flip', 'drop']);
});

it('leaves right- and middle-button presses on a case to the camera (pan)', () => {
  for (const button of [1, 2]) {
    expect(pointer('down', 200, 150, { button }).cancelBubble).toBe(false);
    pointer('move', 260, 150, { button });
    pointer('up', 260, 150, { button });
  }
  expect(log).toEqual([]);
});
