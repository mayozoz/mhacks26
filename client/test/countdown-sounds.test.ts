import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'spacetimedb';

const cue = vi.fn();
vi.mock('../src/audio/sfx', () => ({ countdownCue: (k: string) => cue(k) }));
import { countdownTicks } from '../src/audio/countdown-sounds';

const at = (ms: number) => new Timestamp(BigInt(ms) * 1000n);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); cue.mockClear(); });
afterEach(() => vi.useRealTimers());

describe('countdown ticks', () => {
  it('ticks each of the last 5 seconds, with a distinct final second', () => {
    const stop = countdownTicks(() => at(8000), 5);
    vi.advanceTimersByTime(8000);
    expect(cue.mock.calls.map((c) => c[0])).toEqual(['tick', 'tick', 'tick', 'tick', 'last']);
    stop();
  });
  it('does not fire a catch-up tick when mounted mid-countdown', () => {
    vi.setSystemTime(2500); // 2.5 s left of a 5 s countdown
    const stop = countdownTicks(() => at(5000), 5);
    vi.advanceTimersByTime(200);
    expect(cue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500);
    expect(cue.mock.calls.map((c) => c[0])).toEqual(['tick', 'last']);
    stop();
  });
  it('restarts cleanly when the deadline moves (next phase)', () => {
    let end = at(3000);
    const stop = countdownTicks(() => end, 3);
    vi.advanceTimersByTime(3000);
    cue.mockClear();
    end = at(10_000);
    vi.advanceTimersByTime(7000);
    expect(cue.mock.calls.map((c) => c[0])).toEqual(['tick', 'tick', 'last']);
    stop();
  });
});
