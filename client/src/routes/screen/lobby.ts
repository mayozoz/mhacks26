import QRCode from 'qrcode';
import '../../ui/arena-menu.css';
import { menuBackdrop } from '../../ui/menu-art';
import { MAX_PLAYERS, colorForSlot } from '@doodle/spec';
import type { DbConnection } from '../../module_bindings';
import { roomJoinUrl } from '../../net/room-link';
import { mountTutorial } from './tutorial';
import { drawMarkerSvg } from '../../ui/marker-svg';

/** Every player uses a phone; they join with the QR code or the party link. */
export function lobbyOverlay(el: HTMLElement, conn: DbConnection, code: string, startRound = () => conn.reducers.startRound({})): () => void {
  let active = true, busy = false;
  el.innerHTML = `<div class="room-lobby arena-menu">${menuBackdrop()}<div class="lobby-shell">
    <header class="lobby-header"><a class="lobby-back" href="/">← Game modes</a><span class="lobby-brand">DOODLE FFA</span><span class="lobby-mode">MULTIPLAYER PARTY</span></header>
    <div class="lobby-heading"><span class="lobby-eyebrow">THE ARENA IS WAITING</span><h1>Grab your phone. Join the battle.</h1><p>Draw a weapon on your phone. Settle it on the big screen.</p></div>
    <div class="lobby">
      <section class="lobby-panel lobby-join" aria-labelledby="join-heading"><span class="lobby-eyebrow">01 · JOIN THE ROOM</span><h2 id="join-heading">Scan to join</h2><div class="lobby-qr"><canvas id="qr" aria-label="Scan this QR code on your phone to join"></canvas></div><div class="lobby-room-code"><span>ROOM CODE</span><strong class="lobby-code">${code}</strong></div><a id="party-link" class="party-link" target="_blank" rel="noopener">Preparing your room link…</a><button id="copy-link" class="party-copy" disabled>Copy room link</button><p id="copy-status" role="status">Open your camera and scan the code.</p></section>
      <section class="lobby-panel lobby-party" aria-labelledby="players-heading"><div class="lobby-roster-heading"><div><span class="lobby-eyebrow">02 · YOUR PARTY</span><h2 id="players-heading">Who's playing?</h2></div><span id="player-count" class="lobby-count" aria-live="polite">0 joined</span></div><ul id="players" aria-label="Players in the room"></ul><div class="lobby-start-area"><button id="start" disabled>Start match →</button><p id="start-hint" role="status"></p></div></section>
      <section class="lobby-panel lobby-controls"><span class="lobby-eyebrow">03 · GET READY</span><div class="lobby-tutorial"></div><p class="lobby-tip">Draw anything. It becomes your weapon.</p></section>
    </div><footer class="lobby-footer">Everyone plays on their own phone. Keep this screen open.</footer>
  </div></div>`;
  const stopTutorial = mountTutorial(el.querySelector<HTMLDivElement>('.lobby-tutorial')!);
  const copy = el.querySelector<HTMLButtonElement>('#copy-link')!;
  void roomJoinUrl(code).then(async url => {
    if (!active) return;
    const link = el.querySelector<HTMLAnchorElement>('#party-link')!;
    link.href = url; link.textContent = url; copy.disabled = false;
    copy.onclick = async () => {
      const status = el.querySelector<HTMLElement>('#copy-status')!;
      try { await navigator.clipboard.writeText(url); if (active) status.textContent = 'Room link copied! Open it on your phone.'; }
      catch { if (active) status.textContent = 'Press and hold the room link above to copy it.'; }
    };
    await QRCode.toCanvas(el.querySelector<HTMLCanvasElement>('#qr')!, url, { width: 320, margin: 2 });
  }).catch(() => {
    if (active) el.querySelector('#copy-status')!.textContent = 'Could not prepare the QR code. Reload this screen to retry.';
  });
  const list = el.querySelector<HTMLUListElement>('#players')!;
  const start = el.querySelector<HTMLButtonElement>('#start')!;
  const hint = el.querySelector<HTMLElement>('#start-hint')!;
  let tooFew = false; // set when Start was pressed with fewer than 2 phones; cleared when someone joins
  const begin = async () => {
    if (!active || busy) return;
    if (connectedCount() < 2) { tooFew = true; refresh(); return; }
    busy = true; start.disabled = true; hint.classList.remove('is-error'); hint.textContent = 'Starting your match…';
    try { await startRound(); }
    catch (error) { if (active) { busy = false; refresh(); hint.textContent = error instanceof Error ? error.message : 'Could not start. Please retry.'; } }
  };
  const roomPlayers = () => [...conn.db.player.iter()].filter(p => p.roomCode === code);
  const connectedCount = () => roomPlayers().filter(p => p.connected).length;
  const refresh = () => {
    const ps = roomPlayers().sort((a, b) => a.colorSlot - b.colorSlot);
    const humanCount = ps.filter(p => p.connected).length;
    if (humanCount >= 2) tooFew = false;
    start.disabled = busy;
    el.querySelector('#player-count')!.textContent = `${humanCount} / ${MAX_PLAYERS} joined`;
    // Only complain about the 2-player minimum once the host actually presses Start.
    const error = tooFew && !busy;
    hint.classList.toggle('is-error', error);
    hint.textContent = busy ? 'Starting your match…' : error ? `Need at least 2 players to start. ${humanCount === 1 ? 'Get 1 more phone to scan the code.' : 'Scan the code with 2 phones.'}` : humanCount >= MAX_PLAYERS ? `Room full (${MAX_PLAYERS} players max).` : '';
    list.innerHTML = ps.length ? ps.map(p => {
      const c = colorForSlot(p.colorSlot);
      return `<li class="lobby-player${p.connected ? '' : ' is-offline'}" style="--c:${c.hex}"><span class="lobby-player-marker" aria-hidden="true">${drawMarkerSvg(p.marker, c.hex, 24)}</span><div><strong>${escapeHtml(p.name)}</strong><span>PHONE CONTROLLER</span></div><span class="lobby-player-status">${p.connected ? 'Ready' : 'Offline'}</span></li>`;
    }).join('') : '<li class="lobby-empty"><span aria-hidden="true">✦</span><strong>Your party starts here</strong><p>Scan the code. Your name will appear here.</p></li>';
  };
  conn.db.player.onInsert(refresh); conn.db.player.onUpdate(refresh); conn.db.player.onDelete(refresh);
  refresh();
  start.onclick = () => void begin();
  return () => {
    active = false; stopTutorial();
    conn.db.player.removeOnInsert(refresh); conn.db.player.removeOnUpdate(refresh); conn.db.player.removeOnDelete(refresh);
  };
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
