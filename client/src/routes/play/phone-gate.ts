import QRCode from 'qrcode';
import { roomJoinUrl } from '../../net/room-link';

// The controller needs a touchscreen: you draw with a finger and hold the joystick while tapping
// attack. A computer without touch gets a "use your phone" screen with a QR code back to this
// room, plus a small escape hatch for testing (remembered for the tab; `?desktop` skips it too).

const SKIP_KEY = 'doodle.play-on-computer';

/** True on a device with no touch input at all (mouse/trackpad only). */
export function lacksTouch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const coarse = window.matchMedia('(any-pointer: coarse)').matches;
  return !coarse && (navigator.maxTouchPoints ?? 0) === 0;
}

function skipped(): boolean {
  if (new URLSearchParams(location.search).has('desktop')) return true;
  try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; }
}

/** Resolves at once on phones/tablets; on a computer, once the player chooses to continue anyway. */
export function phoneGate(el: HTMLElement): Promise<void> {
  if (!lacksTouch() || skipped()) return Promise.resolve();
  const code = new URLSearchParams(location.search).get('room')?.trim().toUpperCase() ?? '';
  el.innerHTML = `<div class="center phone-gate">
    <div>
      <div class="phone-gate-icon" aria-hidden="true">📱</div>
      <h1>Grab your phone</h1>
      <p>Doodle FFA is played on a touchscreen: you draw with your finger, then hold the joystick while tapping attack.</p>
      <canvas class="phone-gate-qr" aria-label="Scan to open this room on your phone"></canvas>
      <p class="phone-gate-code">${code ? `Scan with your phone camera to join room <b>${code.replace(/[^A-Z0-9]/g, '')}</b>.` : 'Scan the QR code on the big screen with your phone camera.'}</p>
      <button class="phone-gate-skip">Continue on this computer anyway</button>
    </div>
  </div>`;
  const canvas = el.querySelector<HTMLCanvasElement>('.phone-gate-qr')!;
  if (code) void roomJoinUrl(code).then((url) => QRCode.toCanvas(canvas, url, { width: 220, margin: 2 })).catch(() => canvas.remove());
  else canvas.remove();
  return new Promise((resolve) => {
    el.querySelector<HTMLButtonElement>('.phone-gate-skip')!.onclick = () => {
      try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* private mode */ }
      el.innerHTML = '';
      resolve();
    };
  });
}
