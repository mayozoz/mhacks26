import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn(async () => {}) } }));
vi.mock('../src/net/room-link', () => ({ roomJoinUrl: vi.fn(async (c: string) => `https://doodleffa.tech/play?room=${c}`) }));
import { lacksTouch, phoneGate } from '../src/routes/play/phone-gate';

function env(coarse: boolean, touchPoints: number, search = '?room=abcd') {
  const store = new Map<string, string>();
  vi.stubGlobal('window', { matchMedia: () => ({ matches: coarse }) });
  vi.stubGlobal('navigator', { maxTouchPoints: touchPoints });
  vi.stubGlobal('location', { search });
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
}
function fakeEl() {
  const skip: any = {}; const canvas = { remove: vi.fn() };
  return { skip, el: { innerHTML: '', querySelector: (s: string) => (s === '.phone-gate-skip' ? skip : canvas) } as unknown as HTMLElement };
}
afterEach(() => vi.unstubAllGlobals());

describe('phone gate', () => {
  it('lets phones, tablets and touch laptops straight through', async () => {
    env(true, 5); expect(lacksTouch()).toBe(false);
    env(false, 10); expect(lacksTouch()).toBe(false); // touchscreen laptop
    const { el } = fakeEl(); await phoneGate(el); expect(el.innerHTML).toBe('');
  });
  it('asks a mouse-only computer to use a phone, with the room code, until it continues anyway', async () => {
    env(false, 0); expect(lacksTouch()).toBe(true);
    const { el, skip } = fakeEl();
    let done = false; const gate = phoneGate(el).then(() => { done = true; });
    expect(el.innerHTML).toContain('Grab your phone');
    expect(el.innerHTML).toContain('<b>ABCD</b>');
    await Promise.resolve(); expect(done).toBe(false);
    skip.onclick(); await gate; expect(done).toBe(true);
    const again = fakeEl(); await phoneGate(again.el); expect(again.el.innerHTML).toBe(''); // remembered for this tab
  });
  it('can be skipped with ?desktop for testing', async () => {
    env(false, 0, '?room=ABCD&desktop');
    const { el } = fakeEl(); await phoneGate(el); expect(el.innerHTML).toBe('');
  });
});
