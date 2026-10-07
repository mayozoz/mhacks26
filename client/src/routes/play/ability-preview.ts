import { Identity, Timestamp } from 'spacetimedb';
import { ABILITIES, ABILITY_TUNING, MYSTERY_STICK, type AbilityId, type AbilityObjectData, type StoredWeapon } from '@doodle/spec';
import { stepBattle } from '../../../../server/src/lib/sim';
import { hitRadius, hasEffect } from '../../../../server/src/lib/abilities';
import { storeWeapon } from '../../../../server/src/lib/weapons';
import { GAME } from '../../../../server/src/balance';
import { drawStickFigure } from '../../ui/stick-figure';
import { AbilityVfxScene, type VfxFrame } from '../../vfx/scene';
import { drawCanvasVfx } from '../../vfx/canvas';
import { blindOpacity } from '../../ui/ability-blindness';
import type { Ctx, FighterRow, RoomRow } from '../../../../server/src/lib/ctx';

/** Run the real battle mechanics in an isolated, local demonstration arena. */
export function createAbilityPreview(id: AbilityId) {
  const you = Identity.fromString('1'.padStart(64, '0'));
  const foe = Identity.fromString('2'.padStart(64, '0'));
  const stamp = (s: number) => new Timestamp(BigInt(Math.round(s * 1e6)));
  const fighter = (player: Identity, x: number): FighterRow => ({ player, roomCode: 'DEMO', x, y: 0, facing: player.isEqual(you) ? 0 : Math.PI,
    hp: GAME.maxHp, effects: '{}', cooldownReadyAt: stamp(0), lastAttackAt: stamp(0), abilityId: id, abilityCharges: 2, abilityReadyAt: stamp(0) });
  const boost = ['attack_boost', 'rage', 'weapon_boost'].includes(id);
  const close = boost || ['invisible', 'smoke', 'shrink', 'mini_arena', 'mushrooms'].includes(id);
  const fighters = new Map([[you.toHexString(), fighter(you, -2)], [foe.toHexString(), fighter(foe, close ? -.3 : id === 'hook' ? 2 : 0)]]);
  if (id === 'life_drain') fighters.get(you.toHexString())!.hp = GAME.maxHp * .6;
  const inputs = new Map([you, foe].map(player => [player.toHexString(), { player, dx: 0, dy: 0, attackBuffered: false, abilityBuffered: false }]));
  const spec = storeWeapon({ ...MYSTERY_STICK, on_hit: [], vfx: [] });
  const weapons = new Map([you, foe].map(player => [player.toHexString(), JSON.parse(spec) as StoredWeapon]));
  if (id === 'weapon_boost') fighters.get(foe.toHexString())!.x = -2 + weapons.get(you.toHexString())!.stats.rangeUnits * 1.3;
  const room = { code: 'DEMO', seed: 42, phase: 'battle', phaseStartedAt: stamp(0), phaseEndsAt: stamp(60), arenaR: 6,
    stormX: 0, stormY: 0, stormR: 10, winner: '' } as RoomRow;
  type ObjectRow = { id: bigint; owner: Identity; roomCode: string; x: number; y: number; data: string };
  const objects = new Map<bigint, ObjectRow>();
  const events: { type: string; x: number; y: number; value: number; at: number; owner?: Identity }[] = [];
  let time = 0, sequence = 0n, used = false, lastAttack = -1;
  const ctx = { get timestamp() { return stamp(time); }, db: {
    fighter: { roomCode: { filter: () => [...fighters.values()] }, player: { update: (f: FighterRow) => fighters.set(f.player.toHexString(), f) } },
    input: { player: { find: (p: Identity) => inputs.get(p.toHexString()), update: (i: any) => inputs.set(i.player.toHexString(), i) } },
    weapon: { player: { find: () => ({ spec }) } },
    player: { roomCode: { filter: () => [] }, identity: { find: () => undefined } },
    room: { code: { update: () => {} } },
    projectile: { roomCode: { filter: () => [] }, insert: () => {}, id: { update: () => {}, delete: () => {} } },
    abilityObject: { roomCode: { filter: () => [...objects.values()] },
      insert: (row: ObjectRow) => { const added = { ...row, id: ++sequence }; objects.set(added.id, added); return added; },
      id: { find: (key: bigint) => objects.get(key), update: (o: ObjectRow) => objects.set(o.id, o), delete: (key: bigint) => objects.delete(key) } },
    fxEvent: { insert: (e: any) => events.push({ ...e, at: time }) },
  } } as unknown as Ctx;
  return {
    you, foe, fighters, objects, events, weapons,
    get time() { return time; },
    step() {
      time += 1 / GAME.tickHz;
      const input = inputs.get(you.toHexString())!, enemyInput = inputs.get(foe.toHexString())!;
      if (time >= 1 && !used) { input.abilityBuffered = true; used = true; }
      input.dx = id === 'fire_steps' && time >= 1 && time < 4 ? .45 : 0;
      enemyInput.dx = time >= 1.4 && time < 5 ? id === 'mini_arena' ? .6 : ['freeze', 'silence'].includes(id) ? .15 : ['mushrooms', 'fire_steps'].includes(id) ? -.25 : 0 : 0;
      const cadence = hasEffect(fighters.get(you.toHexString())!, 'rage', time) ? .65 / ABILITY_TUNING.attackSpeedMultiplier : .65;
      if (time >= 1.2 && time - lastAttack >= cadence) {
        lastAttack = time;
        if (boost) input.attackBuffered = true;
        if (['invisible', 'shrink', 'smoke', 'freeze', 'silence'].includes(id)) enemyInput.attackBuffered = true;
      }
      stepBattle(ctx, room, 1 / GAME.tickHz);
      while (events.length && time - events[0]!.at > .7) events.shift();
    },
  };
}

export function mountAbilityPreview(el: HTMLElement, id: AbilityId): () => void {
  el.innerHTML = `<canvas width="600" height="330" aria-label="${ABILITIES[id].name} stick-figure arena demonstration with damage and health"></canvas><div class="ability-preview-status" role="status"></div><div class="ability-preview-tools"><button class="demo-replay">↶ Replay</button><button class="demo-pause">Pause</button></div>`;
  const canvas = el.querySelector('canvas')!;
  const g = canvas.getContext('2d')!;
  const label = el.querySelector<HTMLElement>('.ability-preview-status')!;
  const color = getComputedStyle(el).getPropertyValue('--player').trim() || '#67e8f9';
  let simulation = createAbilityPreview(id), paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let previous = performance.now(), accumulator = 0, raf = 0;
  const scale = 43, cx = 300, cy = 160;
  const previousPositions = new Map<string, [number, number]>();
  const vfx = new AbilityVfxScene();
  let blindUntil = 0;
  const project = (x: number, y: number, h: number) => ({ x: cx + x * scale, y: cy + (y - h * 0.5) * scale });
  const point = (x: number, y: number) => [cx + x * scale, cy + y * scale];
  const circle = (x: number, y: number, r: number, fill: string, stroke?: string) => {
    const [px, py] = point(x, y); g.beginPath(); g.arc(px!, py!, Math.max(1, r * scale), 0, Math.PI * 2);
    g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 3; g.stroke(); }
  };
  const text = (text: string, x: number, y: number, fill = '#fff', size = 16) => {
    g.font = `700 ${size}px system-ui`; g.textAlign = 'center'; g.fillStyle = fill; g.fillText(text, x, y);
  };
  const draw = () => {
    const s = simulation, now = s.time;
    g.clearRect(0, 0, 600, 330); g.fillStyle = '#201e31'; g.fillRect(0, 0, 600, 330);
    g.strokeStyle = '#ffffff10'; g.lineWidth = 1;
    for (let x = 42; x < 600; x += scale) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 330); g.stroke(); }
    for (let y = 31; y < 330; y += scale) { g.beginPath(); g.moveTo(0, y); g.lineTo(600, y); g.stroke(); }
    const frame: VfxFrame = {
      now,
      objects: [...s.objects.values()].map(o => ({ id: String(o.id), owner: o.owner.toHexString(), x: o.x, y: o.y, data: JSON.parse(o.data) })),
      fighters: [...s.fighters.values()].map(f => ({ id: f.player.toHexString(), x: f.x, y: f.y, facing: f.facing, hp: f.hp, effects: JSON.parse(f.effects), attackAt: Number(f.lastAttackAt.microsSinceUnixEpoch) / 1e6 })),
      events: s.events.map((e, i) => ({ id: String(i), owner: e.owner?.toHexString() ?? '', type: e.type, x: e.x, y: e.y, at: e.at, value: e.value })),
    };
    const marks = vfx.build(frame);
    drawCanvasVfx(g, marks, scale, project, true);
    for (const f of s.fighters.values()) {
      const mine = f.player.isEqual(s.you), [x, y] = point(f.x, f.y);
      const invisible = hasEffect(f, 'invisible', now), frozen = hasEffect(f, 'frozen', now), poisoned = hasEffect(f, 'poison', now), burning = hasEffect(f, 'burn', now);
      const inSmoke = [...s.objects.values()].some(o => { const d = JSON.parse(o.data) as AbilityObjectData; return d.kind === 'smoke' && d.until > now && Math.hypot(f.x - o.x, f.y - o.y) <= d.radius; });
      g.globalAlpha = invisible ? .65 : inSmoke ? .4 : 1;
      const key = f.player.toHexString(), previous = previousPositions.get(key);
      const walking = previous && Math.hypot(f.x - previous[0], f.y - previous[1]) > .001;
      previousPositions.set(key, [f.x, f.y]);
      const hurtEvent = s.events.find(e => e.type === 'damage' && e.owner?.isEqual(f.player) && now - e.at < .35);
      const hurt = hurtEvent ? Math.max(0, 1 - (now - hurtEvent.at) / .35) : 0;
      const attacking = now - Number(f.lastAttackAt.microsSinceUnixEpoch) / 1e6 < .3;
      drawStickFigure(g, {
        x: x!, y: y!, color: frozen ? '#7dd3fc' : poisoned ? '#a3e635' : mine ? color : '#fb7185',
        facing: f.facing, scale: hitRadius(f, now) / GAME.hitRadius,
        stride: walking || attacking ? now * 12 : 0, attacking, hurt, frozen,
        weaponScale: hasEffect(f, 'weapon_boost', now) ? 1.6 : hasEffect(f, 'shrink', now) ? 2 : 1,
        empowered: hasEffect(f, 'attack_boost', now), grayscale: invisible,
        hideWeapon: frame.objects.some(o => o.owner === f.player.toHexString() && o.data.kind === 'boomerang'),
      });
      g.globalAlpha = 1;
      g.fillStyle = '#090811'; g.fillRect(x! - 29, y! - 43, 58, 7); g.fillStyle = mine ? color : '#fb7185'; g.fillRect(x! - 29, y! - 43, 58 * Math.max(0, f.hp) / GAME.maxHp, 7);
      text(`${Math.round(f.hp / GAME.maxHp * 100)}%`, x!, y! - 50, '#fff', 13);
      text(mine ? 'YOU' : 'OPPONENT', x!, y! + 43, '#ffffff99', 12);
      const status = frozen ? 'FROZEN' : hasEffect(f, 'silenced', now) ? 'SILENCED' : invisible ? 'IMMUNE' : inSmoke ? 'AUTO-AIM BLOCKED' : burning ? 'BURNING' : poisoned ? 'POISONED' : hasEffect(f, 'rage', now) ? 'FASTER ATTACKS' : hasEffect(f, 'attack_boost', now) ? '+40% DAMAGE' : hasEffect(f, 'weapon_boost', now) ? '1.6× REACH' : hasEffect(f, 'shrink', now) ? 'HALF-SIZE BODY' : '';
      if (status) text(status, x!, y! + 61, frozen ? '#7dd3fc' : '#fbbf24', 12);
    }
    drawCanvasVfx(g, marks, scale, project);
    for (const o of frame.objects) {
      if (o.data.kind === 'blind') blindUntil = Math.max(blindUntil, o.data.until);
      if (o.data.kind !== 'boomerang' || o.data.until <= now) continue;
      const p = project(o.x, o.y, 0.8);
      g.save(); g.translate(p.x, p.y); g.rotate(now * 12);
      g.strokeStyle = '#f8f4ff'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-16, 0); g.lineTo(16, 0); g.stroke();
      g.strokeStyle = '#bba4ff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-10, -6); g.lineTo(-10, 6); g.stroke(); g.restore();
    }
    for (const e of s.events) if (e.type === 'damage' && now - e.at < .6) {
      const p = point(e.x, e.y); text('?' + Math.round(e.value), p[0]!, p[1]! - 10 - (now - e.at) * 35, '#fda4af', 18);
    }
    if (blindOpacity(now, blindUntil) > 0) {
      g.globalAlpha = blindOpacity(now, blindUntil); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 330); g.globalAlpha = 1;
    }
    label.textContent = now < 1 ? 'Before activation' : now < 1.5 ? `${ABILITIES[id].name} activated` : now < 7 ? ABILITIES[id].name : 'Watch it again';
  };
  const pause = el.querySelector<HTMLButtonElement>('.demo-pause')!;
  const updatePause = () => { pause.textContent = paused ? 'Play demo' : 'Pause'; };
  updatePause();
  pause.onclick = () => { paused = !paused; updatePause(); };
  el.querySelector<HTMLButtonElement>('.demo-replay')!.onclick = () => { simulation = createAbilityPreview(id); vfx.reset(); blindUntil = 0; previousPositions.clear(); accumulator = 0; paused = false; updatePause(); };
  const frame = (now: number) => {
    const elapsed = Math.min(.2, (now - previous) / 1000); previous = now;
    if (!paused) {
      accumulator += elapsed;
      while (accumulator >= 1 / GAME.tickHz) { simulation.step(); accumulator -= 1 / GAME.tickHz; }
      if (simulation.time > 8) { simulation = createAbilityPreview(id); vfx.reset(); blindUntil = 0; previousPositions.clear(); }
    }
    draw(); raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
