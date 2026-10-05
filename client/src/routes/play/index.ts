import type { Phase } from '@doodle/spec';
import { connect } from '../../net/connection';
import { syncFromPhaseStart } from '../../net/clock';
import { applyPlayerTheme } from '../../ui/theme';
import { preventControllerZoom } from '../../ui/no-zoom';
import type { PlayCtx, View } from './types';
import { joinView } from './join';
import { phoneGate } from './phone-gate';
import { drawView } from './draw';
import { dropView } from './drop';
import { battleView } from './battle';
import { waitingView } from './waiting';
import { resultsView } from './results';
import { revealView } from './reveal';
import { mountPlayDebug } from './debug-status';
import { enableAudio } from '../../audio/sfx';
import { ControllerAudio } from './audio';

// Controller (/play). Subscribes to its room, the room's players, and its own
// fighter + weapon rows only, and
// swaps one full-screen view per phase.

const VIEWS: Record<Phase, View> = {
  lobby: waitingView('You\'re in! Watch the big screen.'),
  draw: drawView,
  drop: dropView,
  reveal: revealView,
  battle: battleView,
  results: resultsView,
};

export async function mount(el: HTMLElement) {
  preventControllerZoom();
  enableAudio();
  await phoneGate(el); // computers without touch: "grab your phone" first
  const { conn, identity } = await connect('play');
  const me = identity.toHexString();
  const ctx: PlayCtx = { conn, identity, el, roomCode: '' };
  ctx.audio = new ControllerAudio(ctx);
  mountPlayDebug(ctx);

  let current: { phase: Phase; cleanup: () => void } | null = null;
  let roomReady = false;
  const show = (phase: Phase) => {
    if (current?.phase === phase) return;
    current?.cleanup();
    el.innerHTML = '';
    current = { phase, cleanup: VIEWS[phase](ctx) };
  };

  const onJoined = async (code: string) => {
    ctx.roomCode = code;
    roomReady = false;
    let subscription: { unsubscribe(): void } | undefined;
    let cancelled = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cancelled = true;
          reject(new Error('The room did not load. Check the big screen, then tap Join to retry.'));
        }, 10000);
        subscription = conn.subscriptionBuilder()
          .onApplied(() => {
            if (cancelled) return;
            clearTimeout(timeout);
            const r = conn.db.room.code.find(code);
            if (!r) { reject(new Error('Room not found. Scan the current QR code on the big screen.')); return; }
            try {
              syncFromPhaseStart(r.phaseStartedAt); show(r.phase as Phase);
              roomReady = true;
              ctx.audio?.sync();
              resolve();
            } catch (error) { reject(error); }
          })
          .onError(() => {
            clearTimeout(timeout);
            reject(new Error('Could not load the room. Reload the big screen and this phone, then retry.'));
          })
          .subscribe([
            `SELECT * FROM room WHERE code = '${code}'`,
            `SELECT * FROM player WHERE room_code = '${code}'`,
            `SELECT * FROM fighter WHERE player = 0x${me}`,
            // Only opponent-inflicted damage addressed to this controller.
            `SELECT * FROM fx_event WHERE room_code = '${code}' AND owner = 0x${me} AND type = 'damage'`,
            // own weapon only — needed for the cooldown ring (stats.cooldown)
            `SELECT * FROM weapon WHERE player = 0x${me}`,
            // own doodle — shown on the reveal weapon card
            `SELECT * FROM doodle WHERE player = 0x${me}`,
          ]);
      });
    } catch (error) {
      cancelled = true; subscription?.unsubscribe();
      roomReady = false; ctx.roomCode = ''; throw error;
    }
  };

  conn.db.room.onUpdate((_c, _old, r) => {
    if (!roomReady || r.code !== ctx.roomCode) return;
    syncFromPhaseStart(r.phaseStartedAt);
    show(r.phase as Phase);
  });
  conn.db.player.onInsert((_c, p) => { if (p.identity.toHexString() === me) applyPlayerTheme(p.colorSlot); });

  const cleanupJoin = joinView(ctx, async (code) => { await onJoined(code); cleanupJoin(); });
}
