import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { ABILITIES, type AbilityObjectData } from '@doodle/spec';
import { activateAbility, damage, effectsOf, hasEffect, hitRadius, moveFighter, setEffect, stepAbilityObjects, stepStatuses, untargetable } from '../src/lib/abilities';
import type { Ctx, FighterRow, RoomRow } from '../src/lib/ctx';
import { GAME } from '../src/balance';

function setup(ability = 'flash') {
  const identity = (id: string) => ({ toHexString: () => id, isEqual: (o: { toHexString(): string }) => o.toHexString() === id });
  const timestamp = (s: number) => new Timestamp(BigInt(Math.round(s * 1e6)));
  const fighter = (id: string, x: number): FighterRow => ({ player: identity(id), roomCode: 'TEST', x, y: 0, facing: 0, hp: GAME.maxHp,
    cooldownReadyAt: timestamp(0), lastAttackAt: timestamp(0), effects: '{}', abilityId: ability, abilityCharges: 2, abilityReadyAt: timestamp(0) } as FighterRow);
  const f = fighter('a', 0), enemy = fighter('b', 2);
  const all = new Map([['a', f], ['b', enemy]]);
  const rows = new Map<bigint, any>();
  const events: any[] = [];
  const players = [...all.values()].map(f => ({ identity: f.player, roomCode: 'TEST', totalDamage: 0 }));
  let seq = 0n;
  const ctx = { timestamp: timestamp(100), db: {
    player: { roomCode: { filter: () => players }, identity: { find: () => undefined, update: (p: any) => Object.assign(players.find(o => o.identity.isEqual(p.identity))!, p) } },
    input: { player: { find: () => ({ dx: 1, dy: 0 }) } },
    abilityObject: {
      roomCode: { filter: (code: string) => [...rows.values()].filter(o => o.roomCode === code) },
      insert: (row: any) => { const r = { ...row, id: ++seq }; rows.set(r.id, r); return r; },
      id: { find: (id: bigint) => rows.get(id), delete: (id: bigint) => rows.delete(id), update: (row: any) => rows.set(row.id, row) },
    }, fxEvent: { insert: (event:any) => events.push(event) },
  } } as unknown as Ctx;
  const room = { code: 'TEST', arenaR: 12 } as RoomRow;
  return { f, enemy, all, ctx, room, rows, players, events, setTime: (s: number) => { ctx.timestamp = timestamp(s); } };
}

describe('special abilities', () => {
  it('reports the wall-limited teleport endpoint at the same server timestamp',()=>{
    const s=setup('flash');
    s.ctx.db.abilityObject.insert({id:0n,owner:s.f.player,roomCode:'TEST',x:0,y:0,data:JSON.stringify({kind:'wall',radius:1,start:99,until:105})});
    activateAbility(s.ctx,s.room,s.f,s.all);
    const departure=s.events.find(e=>e.type==='flash'),arrival=s.events.find(e=>e.type==='flash_end');
    expect(departure.x).toBe(0);expect(arrival.x).toBeCloseTo(.5);expect(arrival.x).toBe(s.f.x);
    expect(arrival.createdAt).toEqual(departure.createdAt);
  });
  it('emits dash impact only for confirmed damage, including the actual contact position',()=>{
    const s=setup('dash');s.enemy.x=1;activateAbility(s.ctx,s.room,s.f,s.all);
    expect(s.events.find(e=>e.type==='dash_impact').x).toBe(1);
    const immune=setup('dash');setEffect(immune.enemy,'invisible',103);
    activateAbility(immune.ctx,immune.room,immune.f,immune.all);
    expect(immune.events.some(e=>e.type==='dash_impact')).toBe(false);
  });
  it('sends drain targets only for opponents actually damaged and clears stale targets',()=>{
    const s=setup('life_drain');activateAbility(s.ctx,s.room,s.f,s.all);
    stepAbilityObjects(s.ctx,s.room,s.all,new Map(),.05);
    const targets=()=>JSON.parse([...s.rows.values()][0].data).targets;
    expect(targets()).toEqual([{id:'b',x:2,y:0}]);
    setEffect(s.enemy,'invisible',103);s.setTime(100.05);
    stepAbilityObjects(s.ctx,s.room,s.all,new Map(),.05);expect(targets()).toEqual([]);
  });
  it('reports the attack boost health cost once per actual activation',()=>{
    const s=setup('attack_boost');activateAbility(s.ctx,s.room,s.f,s.all);activateAbility(s.ctx,s.room,s.f,s.all);
    expect(s.events.filter(e=>e.type==='ability_cost')).toHaveLength(1);
    expect(s.events.find(e=>e.type==='ability_cost').value).toBe(500);
  });
  it.each(Object.keys(ABILITIES))('%s consumes one charge and starts its own cooldown', id => {
    const s = setup(id); activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.f.abilityCharges).toBe(1);
    expect(Number(s.f.abilityReadyAt.microsSinceUnixEpoch) / 1e6).toBe(100 + ABILITIES[id as keyof typeof ABILITIES].cooldown);
  });
  it('rejects cooldown activation and a third use', () => {
    const s = setup(); activateAbility(s.ctx, s.room, s.f, s.all);
    const x = s.f.x; activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.f.x).toBe(x); expect(s.f.abilityCharges).toBe(1);
    s.setTime(108); activateAbility(s.ctx, s.room, s.f, s.all);
    s.setTime(116); activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.f.abilityCharges).toBe(0); expect(s.f.x).toBeCloseTo(6);
  });
  it.each(Object.keys(ABILITIES))('%s permits its second use exactly when cooldown ends', id => {
    const s = setup(id);
    activateAbility(s.ctx, s.room, s.f, s.all);
    const ready = 100 + ABILITIES[id as keyof typeof ABILITIES].cooldown;
    s.setTime(ready - 0.001);
    activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.f.abilityCharges).toBe(1);
    s.setTime(ready);
    activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.f.abilityCharges).toBe(0);
  });
  it('invulnerability blocks all damage for exactly two seconds', () => {
    const s = setup('invisible'); activateAbility(s.ctx, s.room, s.f, s.all);
    expect(damage(s.f, 500, 101.99)).toBe(0);
    expect(damage(s.f, 500, 102)).toBe(500);
  });
  it('silence prevents activation without spending a charge', () => {
    const s = setup(); setEffect(s.f, 'silenced', 103);
    activateAbility(s.ctx, s.room, s.f, s.all); expect(s.f.abilityCharges).toBe(2);
  });
  it('shrink halves the collision radius and restores it on expiry', () => {
    const s = setup('shrink'); activateAbility(s.ctx, s.room, s.f, s.all);
    expect(hitRadius(s.f, 101)).toBe(0.25); expect(hitRadius(s.f, 106)).toBe(0.5);
    s.setTime(106); stepStatuses(s.ctx, s.all, 0.05); expect(effectsOf(s.f).shrink).toBeUndefined();
  });
  it('smoke prevents targeting without granting damage immunity', () => {
    const s = setup('smoke'); activateAbility(s.ctx, s.room, s.f, s.all);
    expect(untargetable(s.ctx, s.room, s.f)).toBe(true); expect(damage(s.f, 100, 100)).toBe(100);
    s.setTime(104); expect(untargetable(s.ctx, s.room, s.f)).toBe(false);
  });
  it('walls stop long movements from crossing in either direction', () => {
    const s = setup('mini_arena'); activateAbility(s.ctx, s.room, s.f, s.all);
    moveFighter(s.ctx, s.room, s.f, 10, 0); expect(s.f.x).toBe(2.5);
    s.enemy.x = -6; moveFighter(s.ctx, s.room, s.enemy, 0, 0); expect(s.enemy.x).toBe(-3.5);
    s.setTime(105); moveFighter(s.ctx, s.room, s.f, 10, 0); expect(s.f.x).toBeCloseTo(10);
  });
  it('dash uses a swept hit and knockback instead of testing only its endpoint', () => {
    const s = setup('dash'); s.enemy.x = 1; activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.enemy.hp).toBe(GAME.maxHp * 0.88); expect(s.enemy.x).toBeCloseTo(3);
    expect(s.players[0]!.totalDamage).toBeCloseTo(GAME.maxHp * 0.12);
  });
  it('does not credit damage blocked by invulnerability or the ability health cost', () => {
    const s = setup('dash'); setEffect(s.enemy, 'invisible', 102);
    activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.players[0]!.totalDamage).toBe(0);
    s.f.abilityId = 'attack_boost'; s.setTime(110);
    activateAbility(s.ctx, s.room, s.f, s.all);
    expect(s.f.hp).toBeLessThan(GAME.maxHp);
    expect(s.players.every(p => p.totalDamage === 0)).toBe(true);
  });
  it('hook hits the first opponent along its path even when table order differs', () => {
    const s = setup('hook'); s.enemy.x = 4;
    const near = { ...s.enemy, player: s.f.player, x: 2 };
    // A third distinct identity, inserted after the more distant opponent.
    near.player = { toHexString: () => 'c', isEqual: (o: any) => o.toHexString() === 'c' } as any;
    s.all.set('c', near); activateAbility(s.ctx, s.room, s.f, s.all);
    s.setTime(100.6); stepAbilityObjects(s.ctx, s.room, s.all, new Map(), 0.6);
    expect(near.x).toBeCloseTo(1); expect(s.enemy.x).toBe(4); expect(s.rows.size).toBe(0);
  });
  it('mushrooms apply poison for five seconds then disappear', () => {
    const s = setup('mushrooms'); s.enemy.x = 0;
    activateAbility(s.ctx, s.room, s.f, s.all); stepAbilityObjects(s.ctx, s.room, s.all, new Map(), 0.05);
    expect(effectsOf(s.enemy).poison?.until).toBe(105);
    s.setTime(101); stepStatuses(s.ctx, s.all, 1); expect(s.enemy.hp).toBe(GAME.maxHp - 125);
    expect(s.players[0]!.totalDamage).toBe(125);
    s.setTime(102); stepStatuses(s.ctx, s.all, 1);
    expect(s.players[0]!.totalDamage).toBe(250);
    s.setTime(106); stepStatuses(s.ctx, s.all, 1); expect(hasEffect(s.enemy, 'poison', 106)).toBe(false);
  });
  it('life drain heals only actual damage and never exceeds maximum HP', () => {
    const s = setup('life_drain'); s.f.hp = 4000; s.enemy.hp = 50;
    activateAbility(s.ctx, s.room, s.f, s.all); stepAbilityObjects(s.ctx, s.room, s.all, new Map(), 1);
    expect(s.enemy.hp).toBe(0); expect(s.f.hp).toBe(4050);
    expect(s.players[0]!.totalDamage).toBe(50);
  });
  it.each(['nuke1', 'nuke2'])('%s covers the arena without repeatedly damaging a stationary opponent', id => {
    const s = setup(id); activateAbility(s.ctx, s.room, s.f, s.all);
    const bombs = [...s.rows.values()].map(row => ({ ...row, d: JSON.parse(row.data) as AbilityObjectData }));
    expect(bombs.length).toBeGreaterThan(50);
    for (let t = 100; t < 105; t += 0.05) { s.setTime(t); stepAbilityObjects(s.ctx, s.room, s.all, new Map(), 0.05); }
    expect(s.enemy.hp).toBe(GAME.maxHp - 200); expect(s.rows.size).toBe(0);
    expect(s.players[0]!.totalDamage).toBe(200);
  });
});

// Exercise the real combat tick using in-memory table adapters.
import { stepBattle } from '../src/lib/sim';
import { readWeapon } from '../src/lib/weapons';
function battle(ability = 'flash') {
  const s = setup(ability);
  const input = { player: s.f.player, dx: 0, dy: 0, attackBuffered: true, abilityBuffered: false };
  const db = s.ctx.db as any;
  db.input.player.find = (id: any) => id.isEqual(s.f.player) ? input : undefined;
  db.input.player.update = (row: any) => Object.assign(input, row);
  db.fighter = { roomCode: { filter: () => [...s.all.values()] }, player: { update: (row: FighterRow) => s.all.set(row.player.toHexString(), row) } };
  db.weapon = { player: { find: () => undefined } };
  db.room = { code: { update: () => {} } };
  // weapon projectiles (shoot/throw) — none in these tests, but the tick reads the table
  db.projectile = { roomCode: { filter: () => [] }, insert: () => {}, id: { update: () => {}, delete: () => {} } };
  Object.assign(s.room, { seed: 123, phaseStartedAt: new Timestamp(100_000_000n), phaseEndsAt: new Timestamp(160_000_000n), stormX: 0, stormY: 0 });
  s.enemy.x = 1;
  // Hits land on the weapon's strike frame (strikeDelayS), not on the press, so `step(n)` runs
  // n ticks and advances the clock 50 ms each.
  let t = 100;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { s.setTime(t); stepBattle(s.ctx, s.room, 0.05); t += 0.05; } };
  return { ...s, input, step };
}

describe('ability integration with the combat tick', () => {
  it('attack boost increases normal attack damage by 40%', () => {
    const base = battle(); base.step(10);
    const boosted = battle('attack_boost'); boosted.input.abilityBuffered = true; boosted.step(10);
    expect(GAME.maxHp - boosted.all.get('b')!.hp).toBeCloseTo((GAME.maxHp - base.all.get('b')!.hp) * 1.4);
    expect(boosted.all.get('a')!.hp).toBe(GAME.maxHp * 0.9);
    expect(boosted.all.get('a')!.abilityCharges).toBe(1);
  });
  it('rage shortens normal attack cooldown', () => {
    const s = battle('rage'); s.input.abilityBuffered = true; s.step();
    const cooldown = Number(s.all.get('a')!.cooldownReadyAt.microsSinceUnixEpoch) / 1e6 - 100;
    expect(cooldown).toBeCloseTo(readWeapon(undefined).stats.cooldown / 1.4, 5);
  });
  it('weapon boost increases server hit reach', () => {
    const normal = battle(); const boosted = battle('weapon_boost');
    const distance = readWeapon(undefined).stats.rangeUnits * 1.3 + GAME.hitRadius;
    normal.enemy.x = distance; boosted.enemy.x = distance;
    normal.step(10); boosted.input.abilityBuffered = true; boosted.step(10);
    expect(normal.all.get('b')!.hp).toBe(GAME.maxHp);
    expect(boosted.all.get('b')!.hp).toBeLessThan(GAME.maxHp);
  });
  it('silence clears attack and special requests without consuming charges', () => {
    const s = battle(); setEffect(s.f, 'silenced', 103); s.input.abilityBuffered = true; s.step();
    expect(s.all.get('b')!.hp).toBe(GAME.maxHp); expect(s.all.get('a')!.abilityCharges).toBe(2);
    expect(s.input.attackBuffered).toBe(false); expect(s.input.abilityBuffered).toBe(false);
  });
  it('freeze prevents movement, normal attacks and special activation', () => {
    const s = battle(); setEffect(s.f, 'frozen', 103); s.input.dx = 1; s.input.abilityBuffered = true; s.step();
    expect(s.all.get('a')!.x).toBe(0); expect(s.all.get('a')!.abilityCharges).toBe(2);
    expect(s.all.get('b')!.hp).toBe(GAME.maxHp);
  });
  it('invulnerability blocks storm and sudden death damage in the actual tick', () => {
    const s = battle('invisible'); s.input.attackBuffered = false;
    s.input.abilityBuffered = true; s.f.x = 10;
    s.setTime(151); stepBattle(s.ctx, s.room, 0.05);
    expect(s.all.get('a')!.hp).toBe(GAME.maxHp);
    expect(s.all.get('b')!.hp).toBeLessThan(GAME.maxHp);
  });
});

import { MAX_ABILITY_COOLDOWN_S } from '@doodle/spec';

describe('ability cooldown scale', () => {
  it('caps at 22 s, with the nukes the longest', () => {
    const cds = Object.entries(ABILITIES).map(([id, a]) => [id, a.cooldown] as const);
    const max = Math.max(...cds.map(([, c]) => c));
    expect(max).toBe(MAX_ABILITY_COOLDOWN_S);
    expect(ABILITIES.nuke1.cooldown).toBe(max);
    expect(ABILITIES.nuke2.cooldown).toBe(max);
    for (const [id, c] of cds) if (!id.startsWith('nuke')) expect(c).toBeLessThan(max);
  });
});
