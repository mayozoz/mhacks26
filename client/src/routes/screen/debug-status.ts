import type { DbConnection } from '../../module_bindings';
import { DEBUG, debug, type Item } from '../../debug';
import { secondsLeft, secondsOverdue } from '../../net/clock';
import { describeService, type ServiceRow } from '../../ui/service-notice';

/**
 * Shared-screen debug status (only with ?debug): phase timer, overdue/stalled detection,
 * per-player drawing + generation status, and server-side debug_event errors for this room.
 */
export function mountScreenDebug(conn: DbConnection, code: string) {
  if (!DEBUG) return;
  conn.subscriptionBuilder().subscribe(`SELECT * FROM debug_event WHERE room_code = '${code}'`);
  conn.db.debugEvent.onInsert((_c, e) => {
    if (e.roomCode === code) debug.error(`server ${e.source}`, e.message);
  });

  // A battle that stops producing fighter updates means the server tick stopped.
  let lastFighterUpdate = Date.now();
  conn.db.fighter.onUpdate((_c, _o, f) => { if (f.roomCode === code) lastFighterUpdate = Date.now(); });

  debug.addProvider((): Item[] => {
    const r = conn.db.room.code.find(code);
    if (!r) return [{ level: 'error', text: `room ${code} not found on the server` }];
    const items: Item[] = [];
    const left = secondsLeft(r.phaseEndsAt), late = secondsOverdue(r.phaseEndsAt);
    if (r.phase === 'lobby') items.push({ level: 'ok', text: `room ${code} · lobby · waiting for Start` });
    else if (late > 1.5) items.push({ level: 'error', text: `room ${code} · ${r.phase} ended ${late.toFixed(0)}s ago — server is NOT advancing (see errors / pnpm stdb:logs)` });
    else items.push({ level: 'wait', text: `room ${code} · ${r.phase} · ${left.toFixed(1)}s left` });

    for (const s of conn.db.serviceStatus.iter() as Iterable<ServiceRow>) {
      const d = describeService(s);
      items.push({ level: 'error', text: `${d.feature} · ${d.when} · ${s.detail}` });
    }

    const players = [...conn.db.player.iter()].filter((p) => p.roomCode === code);
    const doodles = new Set([...conn.db.doodle.iter()].filter((d) => d.roomCode === code).map((d) => d.player.toHexString()));
    const weapons = new Map([...conn.db.weapon.iter()].filter((w) => w.roomCode === code).map((w) => [w.player.toHexString(), w]));
    const live = players.filter((p) => p.connected).length;
    items.push({ level: live < players.length ? 'warn' : 'ok', text: `players ${live}/${players.length} connected` });

    if (r.phase === 'draw' || r.phase === 'drop' || r.phase === 'reveal') {
      items.push({ level: doodles.size < players.length ? 'wait' : 'ok', text: `drawings received ${doodles.size}/${players.length}` });
      for (const p of players) {
        const w = weapons.get(p.identity.toHexString());
        const step = (done: boolean, name: string) => `${name} ${done ? '✓' : '…'}`;
        const text = w
          ? `${p.name}: ${w.status} · ${step(!!w.spec, 'spec')} ${step(!!w.sfxUrl, 'sfx')}`
          : `${p.name}: no drawing yet`;
        items.push({ level: !w ? 'wait' : w.status === 'pending' || w.status === 'generating' ? 'wait' : w.status === 'fallback' ? 'warn' : 'ok', text });
      }
    }
    if (r.phase === 'battle') {
      const fighters = [...conn.db.fighter.iter()].filter((f) => f.roomCode === code);
      const alive = fighters.filter((f) => f.hp > 0).length;
      const quiet = (Date.now() - lastFighterUpdate) / 1000;
      items.push({ level: quiet > 1 ? 'error' : 'ok', text: `battle · ${alive}/${fighters.length} alive · last tick update ${quiet.toFixed(1)}s ago${quiet > 1 ? ' — STALLED' : ''}` });
    }
    return items;
  });
}
