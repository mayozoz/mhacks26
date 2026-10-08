import { beforeEach, expect, it, vi } from 'vitest';
import { spinAbilityReel } from '../src/routes/play/ability-roll';

let frames: Map<number, FrameRequestCallback>, next: number;
let doc: EventTarget & { hidden: boolean };
let vibrate: ReturnType<typeof vi.fn>;
let reduced: boolean;
beforeEach(() => {
  frames = new Map(); next = 0; reduced = false;
  doc = Object.assign(new EventTarget(), { hidden: false });
  vibrate = vi.fn(() => true);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { vibrate });
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
function advance(now: number) {
  const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));
}
function setup() {
  const selected = { offsetLeft: 7440, classList: { add: vi.fn() }, animate: vi.fn() };
  const track = { children: [{ offsetLeft: 0 }, { offsetLeft: 124 }], style: { transform: '' } };
  const pointer = { animate: vi.fn() };
  const done = vi.fn();
  const stop = spinAbilityReel(track as unknown as HTMLElement, selected as unknown as HTMLElement, pointer as unknown as HTMLElement, done);
  return { selected, track, pointer, done, stop };
}
it('lands exactly on the assigned ticket and completes only once', () => {
  const s = setup();
  expect(vibrate).toHaveBeenCalledWith(18);
  advance(0); advance(1000); advance(3000);
  expect(s.done).not.toHaveBeenCalled();
  expect(s.pointer.animate).toHaveBeenCalled();
  advance(4200); advance(4500);
  expect(s.track.style.transform).toBe('translate3d(-7440px, 0, 0)');
  expect(s.selected.classList.add).toHaveBeenCalledWith('is-selected');
  expect(vibrate).toHaveBeenLastCalledWith([35, 45, 65]);
  expect(s.done).toHaveBeenCalledOnce();
  s.stop();
});
it('cancels pending movement and vibration when the preparation screen closes', () => {
  const s = setup(); advance(0); s.stop(); advance(5000);
  expect(vibrate).toHaveBeenLastCalledWith(0);
  expect(s.done).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
it('stops vibration while hidden and does not buzz on a hidden landing', () => {
  const s = setup(); advance(0);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  const count = vibrate.mock.calls.length;
  advance(4200);
  expect(vibrate).toHaveBeenCalledTimes(count);
  expect(s.done).toHaveBeenCalledOnce();
  s.stop();
});
it('respects reduced motion while keeping the assigned result and completion feedback', () => {
  reduced = true;
  const s = setup(); advance(0); advance(250);
  expect(s.track.style.transform).toBe('translate3d(-7440px, 0, 0)');
  expect(s.pointer.animate).not.toHaveBeenCalled();
  expect(s.selected.animate).not.toHaveBeenCalled();
  expect(s.done).toHaveBeenCalledOnce();
  s.stop();
});
it('still completes when the device has no vibration API', () => {
  vi.stubGlobal('navigator', {});
  const s = setup(); advance(0); advance(4200);
  expect(s.done).toHaveBeenCalledOnce();
  s.stop();
});
