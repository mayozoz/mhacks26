import { connect } from '../../net/connection';
import { REVEAL, type Phase } from '@doodle/spec';
import { countdownCue, enableAudio, resumeAudio } from '../../audio/sfx';
import { countdownTicks } from '../../audio/countdown-sounds';
import { syncFromPhaseStart } from '../../net/clock';
import { mountCountdown } from '../../ui/countdown';
import { Arena } from './arena';
import { lobbyOverlay } from './lobby';
import { resultsOverlay } from './results';
import { mountScreenDebug } from './debug-status';
import { mountScoreboard } from './scoreboard';
import { mountReveal } from './reveal';
import { mountCommentator } from './commentator';
import { mountServiceNotice } from '../../ui/service-notice';

// Shared screen (/screen). Creates a room, subscribes to everything public for it, and
// renders. It never simulates — positions come from `fighter` rows, ~100 ms behind.

const LABEL: Partial<Record<Phase, string>> = {
  draw: 'Draw your weapon!',
  drop: 'Spin for your special · learn your weapon · deploy!',
};

export async function mount(el: HTMLElement) {
  el.innerHTML = '<div class="center" role="status"><h1>Creating your party room…</h1><p>Your phone join code will appear here.</p></div>';
  const { conn, identity } = await connect('screen');
  el.innerHTML = `<div id="stage" style="position:fixed;inset:0"></div><div id="overlay" style="position:fixed;inset:0;pointer-events:none"><div class="center" role="status"><h1>Preparing your room…</h1></div></div>`;
  const overlay = el.querySelector<HTMLDivElement>('#overlay')!;
  let arena: Arena | null = null;
  const arenaReady = Arena.create(el.querySelector<HTMLDivElement>('#stage')!, conn);

  let code = '';
  let phase: Phase | null = null;
  let commentator: ReturnType<typeof mountCommentator> | null = null;
  let cleanup = () => {};
  let stopTicks = () => {};
  enableAudio(); // any click/key on the screen unlocks countdown sounds (e.g. after a reload)

  const render = () => {
    const r = conn.db.room.code.find(code);
    if (!r || r.phase === phase) return;
    phase = r.phase as Phase;
    syncFromPhaseStart(r.phaseStartedAt);
    cleanup();
    stopTicks(); stopTicks = () => {};
    overlay.innerHTML = '';
    // Countdown sounds: last 5 s of Draw/Drop/Battle, Reveal's 3‥2‥1, and a hit when the fight starts.
    const ends = () => conn.db.room.code.find(code)?.phaseEndsAt;
    if (phase === 'draw' || phase === 'drop' || phase === 'battle') stopTicks = countdownTicks(ends, 5);
    else if (phase === 'reveal') stopTicks = countdownTicks(ends, REVEAL.countdownS);
    if (phase === 'battle') countdownCue('go');
    arena?.setPhase(phase);
    commentator?.setPhase(phase);
    if (phase === 'lobby') {
      const a = lobbyOverlay(overlay, conn, code, async () => { void resumeAudio(); await arenaReady; await conn.reducers.startRound({}); });
      const b = mountServiceNotice(overlay, conn);
      cleanup = () => { a(); b(); };
    }
    else if (phase === 'results') {
      const a = resultsOverlay(overlay, conn, code), b = mountScoreboard(overlay, conn, code);
      cleanup = () => { a(); b(); };
    } else if (phase === 'reveal') {
      cleanup = mountReveal(overlay, conn, code);
    } else {
      const box = document.createElement('div');
      box.className = 'center';
      box.innerHTML = `<h1>${LABEL[phase] ?? ''}</h1>`;
      overlay.appendChild(box);
      const a = mountCountdown(box, () => conn.db.room.code.find(code)?.phaseEndsAt);
      let b = () => {};
      if (phase === 'battle') {
        b = mountScoreboard(overlay, conn, code);
        const fight = document.createElement('div');
        fight.className = 'center';
        fight.style.position = 'fixed';
        fight.style.inset = '0';
        fight.innerHTML = '<div class="fight">FIGHT!</div>';
        overlay.appendChild(fight);
        setTimeout(() => fight.remove(), 950);
      }
      cleanup = () => { a(); b(); };
    }
  };

  // Use the room this screen already hosts (it survives reloads); only create one if there's none.
  const useRoom = (roomCode: string) => {
    if (code) return;
    code = roomCode;
    mountScreenDebug(conn, code);
    commentator = mountCommentator(conn, code);
    arena?.setRoom(code);
    conn.subscriptionBuilder().onApplied(render).onError(roomError).subscribe([
      `SELECT * FROM player WHERE room_code = '${code}'`,
      `SELECT * FROM doodle WHERE room_code = '${code}'`,
      `SELECT * FROM weapon WHERE room_code = '${code}'`,
      `SELECT * FROM fighter WHERE room_code = '${code}'`,
      `SELECT * FROM ability_object WHERE room_code = '${code}'`,
      `SELECT * FROM projectile WHERE room_code = '${code}'`,
      `SELECT * FROM fx_event WHERE room_code = '${code}'`,
      'SELECT * FROM service_status',
    ]);
    render();
  };
  void arenaReady.then(created => {
    arena = created;
    if (code) arena.setRoom(code);
    if (phase) arena.setPhase(phase);
  }).catch(() => {
    const notice = document.createElement('p');
    notice.className = 'screen-connection-notice';
    notice.textContent = 'Arena graphics could not start. Enable graphics acceleration and reload to play.';
    el.appendChild(notice);
  });
  const roomError = () => {
    cleanup();
    overlay.innerHTML = '<div class="center" style="pointer-events:auto"><h1>Could not open your room</h1><p>Check the game server, then reload to retry.</p><button onclick="location.reload()">Retry</button><a href="/">Game modes</a></div>';
  };
  conn.db.room.onInsert((_c, r) => { if (r.host.isEqual(identity)) useRoom(r.code); });
  conn.db.room.onUpdate(() => render());

  conn.subscriptionBuilder()
    .onApplied(() => {
      const mine = [...conn.db.room.iter()].find((r) => r.host.isEqual(identity));
      if (mine) useRoom(mine.code);
      else void conn.reducers.createRoom({}).catch(roomError);
    })
    .onError(roomError)
    .subscribe(`SELECT * FROM room WHERE host = 0x${identity.toHexString()}`);
}
