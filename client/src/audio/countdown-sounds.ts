import type { Timestamp } from 'spacetimedb';
import { secondsLeft } from '../net/clock';
import { countdownCue } from './sfx';

/**
 * Plays a tick as each of the last `from` seconds begins ("5, 4, 3, 2" → tick, "1" → last).
 * Joining mid-countdown doesn't fire a catch-up tick for the second already in progress.
 */
export function countdownTicks(getEnd: () => Timestamp | undefined, from: number): () => void {
  let end: bigint | undefined, last = 0;
  const check = () => {
    const e = getEnd();
    if (!e) return;
    const n = Math.ceil(secondsLeft(e));
    if (e.microsSinceUnixEpoch !== end) { end = e.microsSinceUnixEpoch; last = n; return; } // new deadline
    if (n !== last && n >= 1 && n <= from) countdownCue(n === 1 ? 'last' : 'tick');
    last = n;
  };
  check();
  const timer = setInterval(check, 50);
  return () => clearInterval(timer);
}
