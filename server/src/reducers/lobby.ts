import { SenderError, t } from 'spacetimedb/server';
import { MAX_PLAYERS, colorForSlot, nextFreeColorSlot } from '@doodle/spec';
import spacetimedb from '../schema';
import { makeRoomCode } from '../lib/room-code';
import { enterPhase } from '../lib/phases';
import { clearPlayerRoundRows } from '../lib/player-rows';

/**
 * Shared screen creates a room. (Not in the brief's reducer list, but someone has to
 * mint the code; the caller becomes the room host.) The screen finds its room by
 * subscribing to `room WHERE host = <its identity>`.
 */
export const createRoom = spacetimedb.reducer((ctx) => {
  // A screen keeps its room across reloads, so phones holding the code/QR never get
  // "room not found". (The client also skips this call when it already sees its room.)
  for (const r of ctx.db.room.iter()) if (r.host.isEqual(ctx.sender)) return;

  let code = makeRoomCode(ctx.random);
  while (ctx.db.room.code.find(code)) code = makeRoomCode(ctx.random);

  ctx.db.room.insert({
    code,
    host: ctx.sender,
    phase: 'lobby',
    phaseStartedAt: ctx.timestamp,
    phaseEndsAt: ctx.timestamp,
    round: 0,
    seed: 0,
    arenaR: 0,
    stormX: 0,
    stormY: 0,
    stormR: 0,
    winner: '',
  });
});

export const joinRoom = spacetimedb.reducer(
  { code: t.string(), name: t.string() },
  (ctx, { code, name }) => {
    code = code.trim().toUpperCase();
    const r = ctx.db.room.code.find(code);
    if (!r) throw new SenderError('room not found');
    const cleanName = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Player';

    // Player color is server-assigned once per room and never changes: no reducer sets it, and a
    // returning identity (same saved token) always gets its existing row — and color — back.
    const existing = ctx.db.player.identity.find(ctx.sender);
    if (existing && existing.roomCode === code) {
      ctx.db.player.identity.update({ ...existing, name: cleanName, connected: true });
      return;
    }
    if (r.phase !== 'lobby') throw new SenderError('round in progress');
    if (existing) ctx.db.player.identity.delete(ctx.sender); // switching rooms

    let players = [...ctx.db.player.roomCode.filter(code)];
    if (players.filter((p) => p.connected).length >= MAX_PLAYERS) throw new SenderError('room full');
    // Disconnected players keep their slot so they get the same color back. Only when every slot
    // is held does a disconnected player (lowest slot first) give theirs up.
    if (players.length >= MAX_PLAYERS) {
      const evict = players.filter((p) => !p.connected).sort((a, b) => a.colorSlot - b.colorSlot)[0]!;
      ctx.db.player.identity.delete(evict.identity);
      players = players.filter((p) => p !== evict);
    }
    const slot = nextFreeColorSlot(players.map((p) => p.colorSlot));
    const color = colorForSlot(slot);
    clearPlayerRoundRows(ctx, ctx.sender); // leftovers from a previous room

    ctx.db.player.insert({
      identity: ctx.sender,
      roomCode: code,
      name: cleanName,
      colorSlot: slot,
      marker: color.marker,
      alive: true,
      connected: true,
      dropX: -1,
      dropY: -1,
      placement: 0,
      abilityId: 'flash',
      totalDamage: 0,
    });
  },
);

/** Shared screen → draw phase. */
export const startRound = spacetimedb.reducer((ctx) => {
  const r = [...ctx.db.room.iter()].find((x) => x.host.isEqual(ctx.sender));
  if (!r) throw new SenderError('not a host');
  if (r.phase !== 'lobby' && r.phase !== 'results') throw new SenderError('round already running');
  const players = [...ctx.db.player.roomCode.filter(r.code)];
  if (players.filter((p) => p.connected).length < 2) throw new SenderError('need at least 2 players');
  // Players who left the lobby don't fight; drop them now (freeing their slots for next time).
  for (const p of players) if (!p.connected) ctx.db.player.identity.delete(p.identity);

  enterPhase(ctx, { ...r, round: r.round + 1, seed: ctx.random.uint32() }, 'draw');
});

/** Shared screen's "Play again" on Results → back to the lobby (QR code), so players can join or leave first. */
export const backToLobby = spacetimedb.reducer((ctx) => {
  const r = [...ctx.db.room.iter()].find((x) => x.host.isEqual(ctx.sender));
  if (!r) throw new SenderError('not a host');
  if (r.phase !== 'results') return; // already back (Results also times out into the lobby)
  enterPhase(ctx, r, 'lobby');
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) return;
  const r = ctx.db.room.code.find(p.roomCode);
  if (!r) { ctx.db.player.identity.delete(ctx.sender); return; }
  // Keep the row (and color) so a phone that locks or reloads rejoins as the same color.
  // Lobby: freed at startRound. Mid-round: the fighter just stands there.
  ctx.db.player.identity.update({ ...p, connected: false });
});
