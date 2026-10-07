import { ABILITIES, ABILITY_TUNING as T, arenaExtents, isAbilityId, type AbilityObjectData, type FighterEffects, type StoredWeapon } from '@doodle/spec';
import { GAME } from '../balance';
import { addSeconds } from './time';
import type { Ctx, FighterRow, RoomRow } from './ctx';

export const timeSeconds = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch) / 1e6;
export const effectsOf = (f: FighterRow): FighterEffects => JSON.parse(f.effects);
export const hasEffect = (f: FighterRow, key: keyof FighterEffects, now: number) => (effectsOf(f)[key]?.until ?? 0) > now;
export const hitRadius = (f: FighterRow, now: number) => GAME.hitRadius * (hasEffect(f, 'shrink', now) ? T.shrinkScale : 1);
export function setEffect(f: FighterRow, key: keyof FighterEffects, until: number, dps?: number, source?: string) {
  const effects = effectsOf(f);
  effects[key] = { until, ...(dps === undefined ? {} : { dps }), ...(source === undefined ? {} : { source }) };
  f.effects = JSON.stringify(effects);
}
export function damage(f: FighterRow, amount: number, now: number): number {
  if (f.hp <= 0 || hasEffect(f, 'invisible', now)) return 0;
  const dealt = Math.min(f.hp, Math.max(0, amount));
  f.hp -= dealt;
  return dealt;
}

/** Persist actual opponent damage separately from short-lived visual events. */
export function creditDamage(ctx: Ctx, victim: FighterRow, source: string | undefined, dealt: number) {
  if (!source || source === victim.player.toHexString() || dealt <= 0) return;
  const p = [...ctx.db.player.roomCode.filter(victim.roomCode)].find(p => p.identity.toHexString() === source);
  if (p && p.roomCode === victim.roomCode) ctx.db.player.identity.update({ ...p, totalDamage: p.totalDamage + dealt });
}

export function dealOpponentDamage(ctx: Ctx, victim: FighterRow, source: string | undefined, amount: number, now: number): number {
  const dealt = damage(victim, amount, now);
  creditDamage(ctx, victim, source, dealt);
  return dealt;
}
/**
 * Phone damage cue (fx 'damage', owner = victim) for a direct hit from another player's ability.
 * Damage-over-time (burn, poison, drain) and the storm deliberately don't cue — no constant buzzing.
 */
function cue(ctx: Ctx, r: RoomRow, victim: FighterRow, dealt: number) {
  if (dealt > 0) ctx.db.fxEvent.insert({ id: 0n, roomCode: r.code, type: 'damage', x: victim.x, y: victim.y, owner: victim.player, value: dealt, createdAt: ctx.timestamp });
}

/** Confirmed presentation cues reuse the existing short-lived event table. */
function visual(ctx: Ctx, r: RoomRow, f: FighterRow, type: string, value = 0) {
  ctx.db.fxEvent.insert({ id: 0n, roomCode: r.code, type, x: f.x, y: f.y, owner: f.player, value, createdAt: ctx.timestamp });
}

export function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
export function segmentFraction(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  return ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1);
}
function objects(ctx: Ctx, r: RoomRow) { return [...ctx.db.abilityObject.roomCode.filter(r.code)]; }
type Zone = { x: number; y: number; d: AbilityObjectData };
export interface BattleGeometry { walls: Zone[]; smoke: Zone[] }
export function battleGeometry(ctx: Ctx, r: RoomRow): BattleGeometry {
  const now = timeSeconds(ctx);
  const zones = objects(ctx, r).map(o => ({ x: o.x, y: o.y, d: JSON.parse(o.data) as AbilityObjectData }))
    .filter(o => o.d.until > now);
  return { walls: zones.filter(o => o.d.kind === 'wall'), smoke: zones.filter(o => o.d.kind === 'smoke') };
}
/** Swept, sub-stepped movement prevents dashes, hooks and knockback crossing arena walls. */
export function moveFighter(ctx: Ctx, r: RoomRow, f: FighterRow, x: number, y: number, geometry?: BattleGeometry) {
  const now = timeSeconds(ctx), radius = hitRadius(f, now), { hw, hh } = arenaExtents(r.arenaR);
  const walls = (geometry ?? battleGeometry(ctx, r)).walls;
  const steps = Math.max(1, Math.ceil(Math.hypot(x - f.x, y - f.y) / 0.15));
  const dx = (x - f.x) / steps, dy = (y - f.y) / steps;
  for (let i = 0; i < steps; i++) {
    let nx = Math.max(-hw + radius, Math.min(hw - radius, f.x + dx));
    let ny = Math.max(-hh + radius, Math.min(hh - radius, f.y + dy));
    for (const w of walls) {
      const left = w.x - w.d.radius, right = w.x + w.d.radius;
      const top = w.y - w.d.radius, bottom = w.y + w.d.radius;
      const inside = f.x > left && f.x < right && f.y > top && f.y < bottom;
      if (inside) {
        nx = Math.max(left + radius, Math.min(right - radius, nx));
        ny = Math.max(top + radius, Math.min(bottom - radius, ny));
      } else {
        if (ny >= top - radius && ny <= bottom + radius) {
          if (f.x <= left - radius && nx > left - radius) nx = left - radius;
          if (f.x >= right + radius && nx < right + radius) nx = right + radius;
        }
        if (nx >= left - radius && nx <= right + radius) {
          if (f.y <= top - radius && ny > top - radius) ny = top - radius;
          if (f.y >= bottom + radius && ny < bottom + radius) ny = bottom + radius;
        }
      }
    }
    f.x = nx; f.y = ny;
  }
}
export function untargetable(ctx: Ctx, r: RoomRow, f: FighterRow, geometry?: BattleGeometry) {
  return (geometry ?? battleGeometry(ctx, r)).smoke.some(o => Math.hypot(f.x - o.x, f.y - o.y) <= o.d.radius);
}
function spawn(ctx: Ctx, r: RoomRow, f: FighterRow, x: number, y: number, d: AbilityObjectData) {
  ctx.db.abilityObject.insert({ id: 0n, roomCode: r.code, owner: f.player, x, y, data: JSON.stringify(d) });
}

export function activateAbility(ctx: Ctx, r: RoomRow, f: FighterRow, all: Map<string, FighterRow>) {
  const now = timeSeconds(ctx), id = f.abilityId;
  if (!isAbilityId(id) || f.hp <= 0 || !f.abilityCharges ||
      ctx.timestamp.microsSinceUnixEpoch < f.abilityReadyAt.microsSinceUnixEpoch || hasEffect(f, 'silenced', now)) return;
  const cfg = ABILITIES[id];
  const input = ctx.db.input.player.find(f.player);
  const direction = input && Math.hypot(input.dx, input.dy) > 0.01 ? Math.atan2(input.dy, input.dx) : f.facing;
  const ux = Math.cos(direction), uy = Math.sin(direction);
  const enemies = [...all.values()].filter(o => !o.player.isEqual(f.player) && o.hp > 0);
  const zone = (kind: AbilityObjectData['kind'], radius: number, duration: number = cfg.duration, x = f.x, y = f.y) =>
    spawn(ctx, r, f, x, y, { kind, radius, start: now, until: now + duration });
  f.abilityCharges--;
  f.abilityReadyAt = addSeconds(ctx.timestamp, cfg.cooldown);
  ctx.db.fxEvent.insert({ id: 0n, roomCode: r.code, type: id, x: f.x, y: f.y, owner: f.player, value: direction, createdAt: ctx.timestamp });
  switch (id) {
    case 'flash': case 'dash': {
      const ax = f.x, ay = f.y;
      moveFighter(ctx, r, f, f.x + ux * T.travelDistance, f.y + uy * T.travelDistance);
      visual(ctx, r, f, `${id}_end`, direction);
      if (id === 'dash') for (const o of enemies) {
        if (segmentDistance(o.x, o.y, ax, ay, f.x, f.y) > hitRadius(o, now) + 0.5) continue;
        const dealt = dealOpponentDamage(ctx, o, f.player.toHexString(), GAME.maxHp * T.dashDamageFraction, now);
        cue(ctx, r, o, dealt);
        if (dealt > 0) visual(ctx, r, o, 'dash_impact', dealt);
        moveFighter(ctx, r, o, o.x + ux * T.knockbackDistance, o.y + uy * T.knockbackDistance);
      }
      break;
    }
    case 'smoke': zone('smoke', T.smokeRadius); break;
    case 'flashbang':
      zone('blind', 0);
      ctx.db.fxEvent.insert({ id: 0n, roomCode: r.code, type: 'blind', x: f.x, y: f.y, owner: f.player, value: cfg.duration, createdAt: ctx.timestamp });
      break;
    case 'mini_arena': {
      const radius = T.wallHalfSize;
      zone('wall', radius);
      for (const o of all.values()) if (Math.abs(o.x - f.x) <= radius + hitRadius(o, now) && Math.abs(o.y - f.y) <= radius + hitRadius(o, now)) {
        const rad = hitRadius(o, now);
        o.x = Math.max(f.x - radius + rad, Math.min(f.x + radius - rad, o.x));
        o.y = Math.max(f.y - radius + rad, Math.min(f.y + radius - rad, o.y));
      }
      break;
    }
    case 'mushrooms':
      for (let i = -1; i <= 1; i++) zone('mushroom', T.mushroomRadius, cfg.duration, f.x + uy * i, f.y - ux * i);
      break;
    case 'fire_ring': zone('ring', T.ringRadius); break;
    case 'life_drain': zone('drain', T.drainRadius); break;
    case 'freeze': {
      const x = f.x + ux * T.freezeDistance, y = f.y + uy * T.freezeDistance;
      zone('freeze', T.freezeHalfSize, 0.5, x, y);
      for (const o of enemies) if (Math.abs(o.x - x) <= T.freezeHalfSize + hitRadius(o, now) && Math.abs(o.y - y) <= T.freezeHalfSize + hitRadius(o, now)) setEffect(o, 'frozen', now + 3);
      break;
    }
    case 'boomerang': case 'hook': case 'silence':
      spawn(ctx, r, f, f.x, f.y, { kind: id, radius: T.projectileRadius, start: now, until: now + T.projectileSeconds, vx: ux * T.projectileSpeed, vy: uy * T.projectileSpeed, originX: f.x, originY: f.y, hits: [] });
      break;
    case 'nuke1': case 'nuke2': {
      const { hw, hh } = arenaExtents(r.arenaR);
      // Grid cells overlap to cover the entire arena; each victim takes one blast per activation.
      const cells: { x: number; y: number; wave: number }[] = [];
      for (let y = -hh; y <= hh + 1; y += T.blastGridSpacing) for (let x = -hw; x <= hw + 1; x += T.blastGridSpacing) {
        cells.push({ x, y, wave: id === 'nuke1' ? Math.floor(Math.hypot(x - f.x, y - f.y) / T.blastGridSpacing) : Math.round((y + hh) / T.blastGridSpacing) });
      }
      const maxWave = Math.max(...cells.map(c => c.wave), 1);
      const group = `nuke:${f.player.toHexString()}:${now}`;
      if (id === 'nuke1') spawn(ctx, r, f, f.x, f.y, { kind: 'bomb', radius: T.blastRadius, start: now + T.blastWindup, until: now + T.blastWindup + T.blastVisibleSeconds, hits: [group] });
      for (const c of cells) spawn(ctx, r, f, c.x, c.y, { kind: 'bomb', radius: T.blastRadius, start: now + T.blastWindup + c.wave / maxWave * T.blastSweepSeconds, until: now + T.blastWindup + T.blastVisibleSeconds + c.wave / maxWave * T.blastSweepSeconds, hits: [group] });
      break;
    }
    default:
      if (id === 'attack_boost') {
        const cost = Math.min(f.hp, GAME.maxHp * T.attackHealthCostFraction);
        f.hp = Math.max(0, f.hp - GAME.maxHp * T.attackHealthCostFraction);
        visual(ctx, r, f, 'ability_cost', cost);
      }
      setEffect(f, id, now + cfg.duration);
  }
}

export function stepStatuses(ctx: Ctx, all: Map<string, FighterRow>, dt: number) {
  const now = timeSeconds(ctx);
  for (const f of all.values()) {
    const effects = effectsOf(f);
    for (const [key, effect] of Object.entries(effects)) {
      // sim.ts keeps its own non-status state in the same JSON (knockback `kb`, queued attack `pa`)
      if (key === 'kb' || key === 'pa') continue;
      // Integrate only the portion of this tick before expiration.
      if (effect.dps) dealOpponentDamage(ctx, f, effect.source, effect.dps * Math.max(0, Math.min(dt, effect.until - (now - dt))), now);
      if (effect.until <= now) delete effects[key as keyof FighterEffects];
    }
    f.effects = JSON.stringify(effects);
  }
}

export function stepAbilityObjects(ctx: Ctx, r: RoomRow, all: Map<string, FighterRow>, weapons: Map<string, StoredWeapon>, dt: number) {
  const now = timeSeconds(ctx);
  const firePatches = objects(ctx, r).filter(o => (JSON.parse(o.data) as AbilityObjectData).kind === 'fire');
  for (const f of all.values()) if (f.hp > 0 && hasEffect(f, 'fire_steps', now)) {
    const existing = firePatches.some(o => o.owner.isEqual(f.player) && Math.hypot(o.x - f.x, o.y - f.y) < T.firePatchSpacing);
    if (!existing) spawn(ctx, r, f, f.x, f.y, { kind: 'fire', radius: T.firePatchRadius, start: now, until: now + T.firePatchSeconds });
  }
  const rows = objects(ctx, r);
  const bombHits = new Map<string, Set<string>>();
  for (const row of rows) {
    const d = JSON.parse(row.data) as AbilityObjectData;
    if (d.kind === 'bomb') {
      const group = d.hits![0]!;
      const hits = bombHits.get(group) ?? new Set<string>();
      for (const hit of d.hits!.slice(1)) hits.add(hit);
      bombHits.set(group, hits);
    }
  }
  for (const row of rows) {
    const d = JSON.parse(row.data) as AbilityObjectData;
    if (d.until <= now) { ctx.db.abilityObject.id.delete(row.id); continue; }
    if (d.start > now) continue;
    const owner = all.get(row.owner.toHexString());
    if (d.kind === 'drain') d.targets = [];
    let remove = false;
    const ax = row.x, ay = row.y;
    if (d.kind === 'ring' || d.kind === 'drain') {
      if (!owner || owner.hp <= 0) { ctx.db.abilityObject.id.delete(row.id); continue; }
      row.x = owner.x; row.y = owner.y;
    }
    if (['boomerang', 'hook', 'silence'].includes(d.kind)) {
      if (d.kind === 'boomerang' && now - d.start >= T.boomerangReturnAfter && !d.returning) { d.returning = true; d.hits = []; }
      if (d.returning && owner) {
        const dist = Math.hypot(owner.x - row.x, owner.y - row.y);
        if (dist <= T.projectileSpeed * dt) { ctx.db.abilityObject.id.delete(row.id); continue; }
        d.vx = (owner.x - row.x) / dist * T.projectileSpeed; d.vy = (owner.y - row.y) / dist * T.projectileSpeed;
      }
      row.x += (d.vx ?? 0) * dt; row.y += (d.vy ?? 0) * dt;
    }
    const candidates = [...all.values()].filter(o => o.hp > 0 && !o.player.isEqual(row.owner));
    if (d.kind === 'hook' || d.kind === 'silence') candidates.sort((a, b) => segmentFraction(a.x, a.y, ax, ay, row.x, row.y) - segmentFraction(b.x, b.y, ax, ay, row.x, row.y));
    for (const o of candidates) {
      const id = o.player.toHexString(), dist = Math.hypot(o.x - row.x, o.y - row.y);
      if (['smoke', 'wall', 'blind', 'freeze'].includes(d.kind)) continue;
      if (['boomerang', 'hook', 'silence'].includes(d.kind)) {
        if (d.hits?.includes(id) || segmentDistance(o.x, o.y, ax, ay, row.x, row.y) > d.radius + hitRadius(o, now)) continue;
        d.hits!.push(id);
        if (d.kind === 'boomerang') cue(ctx, r, o, dealOpponentDamage(ctx, o, row.owner.toHexString(), (weapons.get(row.owner.toHexString())?.stats.damagePerHit ?? 300), now));
        if (d.kind === 'silence') { setEffect(o, 'silenced', now + 3); remove = true; }
        if (d.kind === 'hook') {
          visual(ctx, r, o, 'hook_contact');
          if (owner) {
            const len = Math.hypot(o.x - owner.x, o.y - owner.y) || 1;
            moveFighter(ctx, r, o, owner.x + (o.x - owner.x) / len, owner.y + (o.y - owner.y) / len);
            visual(ctx, r, o, 'hook_end');
          }
          remove = true;
        }
        if (remove) break;
      } else if (d.kind === 'ring') {
        if (Math.abs(dist - d.radius) <= T.ringHalfWidth + hitRadius(o, now)) setEffect(o, 'burn', now + T.burnSeconds, GAME.stormDps, row.owner.toHexString());
      } else if (dist <= d.radius + hitRadius(o, now)) {
        if (d.kind === 'fire') setEffect(o, 'burn', now + T.burnSeconds, GAME.stormDps, row.owner.toHexString());
        if (d.kind === 'mushroom') { setEffect(o, 'poison', now + T.poisonSeconds, T.poisonDps, row.owner.toHexString()); visual(ctx, r, o, 'spore_hit'); remove = true; break; }
        if (d.kind === 'drain' && owner && owner.hp > 0) {
          const dealt = dealOpponentDamage(ctx, o, row.owner.toHexString(), T.drainDps * dt, now);
          owner.hp = Math.min(GAME.maxHp, owner.hp + dealt);
          if (dealt > 0) d.targets!.push({ id, x: o.x, y: o.y });
        }
        if (d.kind === 'bomb') {
          const hits = bombHits.get(d.hits![0]!)!;
          if (!hits.has(id)) { cue(ctx, r, o, dealOpponentDamage(ctx, o, row.owner.toHexString(), T.blastDamage, now)); hits.add(id); }
        }
      }
    }
    if (remove) ctx.db.abilityObject.id.delete(row.id);
    else {
      const data = JSON.stringify(d);
      if (row.x !== ax || row.y !== ay || data !== row.data) ctx.db.abilityObject.id.update({ ...row, data });
    }
  }
  // Copy shared activation hit history to future bomb cells before older cells expire.
  for (const row of rows) {
    const live = ctx.db.abilityObject.id.find(row.id);
    if (!live) continue;
    const d = JSON.parse(live.data) as AbilityObjectData;
    if (d.kind === 'bomb') {
      const group = d.hits![0]!;
      d.hits = [group, ...bombHits.get(group)!];
      const data = JSON.stringify(d);
      if (data !== live.data) ctx.db.abilityObject.id.update({ ...live, data });
    }
  }
}
