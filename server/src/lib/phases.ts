import { ABILITIES, ABILITY_TUNING, arenaExtents, mulberry32, revealSeconds, stormStartRadius, type Phase, type AbilityId } from '@doodle/spec';
import { GAME, PHASE_SECONDS } from '../balance';
import { addSeconds } from './time';
import { applyFallbacks } from './weapons';
import { clearPlayerRoundRows } from './player-rows';
import type { Ctx, RoomRow } from './ctx';

const NEXT: Record<Phase, Phase> = {
  lobby: 'draw', draw: 'drop', drop: 'reveal', reveal: 'battle', battle: 'results', results: 'lobby',
};

export function advancePhase(ctx: Ctx, r: RoomRow) {
  if (r.phase === 'battle') finishBattle(ctx, r);
  enterPhase(ctx, r, NEXT[r.phase as Phase]);
}

/** Single place that mutates `room.phase`. Runs the on-enter side effects. */
export function enterPhase(ctx: Ctx, r: RoomRow, phase: Phase) {
  const seconds = phase === 'lobby' ? 0 : PHASE_SECONDS[phase];
  const next: RoomRow = { ...r, phase, phaseStartedAt: ctx.timestamp, phaseEndsAt: addSeconds(ctx.timestamp, seconds) };

  switch (phase) {
    case 'lobby':
      // Round over (results finished): clear every drawing, weapon and fighter from it.
      resetRound(ctx, r.code);
      break;
    case 'draw':
      resetRound(ctx, r.code); // also covers "Play again" straight from results
      next.winner = '';
      logRoundStart(ctx, r);
      break;
    case 'drop': {
      const random = mulberry32(r.seed ^ Number(ctx.timestamp.microsSinceUnixEpoch & 0xffffffffn));
      const abilities = Object.keys(ABILITIES) as AbilityId[];
      for (const p of ctx.db.player.roomCode.filter(r.code)) {
        ctx.db.player.identity.update({ ...p, abilityId: abilities[Math.floor(random() * abilities.length)]! });
      }
      break;
    }
    case 'reveal': {
      applyFallbacks(ctx, r.code, r.seed);
      // One showcase per weapon + 3‥2‥1 (packages/spec/src/timing.ts — clients use the same math).
      const n = [...ctx.db.weapon.roomCode.filter(r.code)].length;
      next.phaseEndsAt = addSeconds(ctx.timestamp, revealSeconds(n));
      break;
    }
    case 'battle':
      Object.assign(next, spawnFighters(ctx, r));
      break;
  }
  ctx.db.room.code.update(next);
}

/** Wipe one room's per-round data: drawings, doodles, weapons, fighters, inputs, projectiles, fx. */
function resetRound(ctx: Ctx, code: string) {
  for (const p of ctx.db.player.roomCode.filter(code)) {
    ctx.db.player.identity.update({ ...p, alive: true, dropX: -1, dropY: -1, placement: 0, totalDamage: 0 });
    clearPlayerRoundRows(ctx, p.identity); // also wipes leftovers this identity has in other rooms
  }
  ctx.db.drawing.roomCode.delete(code);
  ctx.db.doodle.roomCode.delete(code);
  ctx.db.weapon.roomCode.delete(code);
  ctx.db.fighter.roomCode.delete(code);
  ctx.db.projectile.roomCode.delete(code);
  ctx.db.abilityObject.roomCode.delete(code);
  ctx.db.fxEvent.roomCode.delete(code);
}

/**
 * Arena (screen-shaped rectangle) scales with player count; the storm starts around its corners.
 * Fighters spawn at their drop (or a seeded random spot).
 */
function spawnFighters(ctx: Ctx, r: RoomRow): Partial<RoomRow> {
  const players = [...ctx.db.player.roomCode.filter(r.code)];
  const arenaR = GAME.arenaBaseRadius + GAME.arenaPerPlayer * players.length;
  const { hw, hh } = arenaExtents(arenaR);
  const rand = mulberry32(r.seed);
  for (const p of players) {
    let nx = p.dropX, ny = p.dropY;
    if (nx < 0 || ny < 0) { nx = rand(); ny = rand(); }
    // The drop picker is the same rectangle, so this is a straight linear map (1 unit margin).
    const x = (nx * 2 - 1) * (hw - 1), y = (ny * 2 - 1) * (hh - 1);
    ctx.db.fighter.player.delete(p.identity); // never collide with a stale row
    ctx.db.fighter.insert({
      player: p.identity, roomCode: r.code, x, y, facing: 0, hp: GAME.maxHp,
      cooldownReadyAt: ctx.timestamp, lastAttackAt: ctx.timestamp, effects: '{}',
      abilityId: p.abilityId, abilityCharges: ABILITY_TUNING.charges, abilityReadyAt: ctx.timestamp,
    });
  }
  return { arenaR, stormX: 0, stormY: 0, stormR: stormStartRadius(arenaR) };
}

/** Play stats: one game_log row per round, plus a player_seen row per identity. */
function logRoundStart(ctx: Ctx, r: RoomRow) {
  const players = [...ctx.db.player.roomCode.filter(r.code)];
  ctx.db.gameLog.insert({ id: 0n, roomCode: r.code, round: r.round, players: players.length, startedAt: ctx.timestamp, endedAt: undefined });
  for (const p of players) {
    const seen = ctx.db.playerSeen.identity.find(p.identity);
    if (seen) ctx.db.playerSeen.identity.update({ ...seen, lastPlayedAt: ctx.timestamp, rounds: seen.rounds + 1 });
    else ctx.db.playerSeen.insert({ identity: p.identity, firstPlayedAt: ctx.timestamp, lastPlayedAt: ctx.timestamp, rounds: 1 });
  }
}

/** Assign placements to survivors and pick the winner (highest HP% on a tie). */
function finishBattle(ctx: Ctx, r: RoomRow) {
  const fighters = [...ctx.db.fighter.roomCode.filter(r.code)].sort((a, b) => b.hp - a.hp);
  const best = fighters[0];
  // enterPhase() writes the room row right after this, so mutate rather than update.
  if (best && !r.winner) r.winner = best.player.toHexString();
  fighters.forEach((f, i) => {
    const p = ctx.db.player.identity.find(f.player);
    if (p && p.placement === 0) ctx.db.player.identity.update({ ...p, placement: i + 1 });
  });
  for (const log of ctx.db.gameLog.roomCode.filter(r.code)) {
    if (log.round === r.round && !log.endedAt) ctx.db.gameLog.id.update({ ...log, endedAt: ctx.timestamp });
  }
}
