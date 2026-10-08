import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { ABILITIES, MYSTERY_STICK, extractFeatures } from '@doodle/spec';
import { enterPhase } from '../src/lib/phases';
import { applyFallbacks, storeWeapon } from '../src/lib/weapons';
import type { Ctx, RoomRow } from '../src/lib/ctx';

vi.mock('../src/schema', () => ({ default: { reducer: (args: unknown, fn?: unknown) => fn ?? args } }));
vi.mock('spacetimedb/server', () => ({
  SenderError: class extends Error {},
  t: { string: () => ({}), byteArray: () => ({}), f32: () => ({}) },
}));
import { prepareWeapon } from '../src/reducers/draw';
import { SPEC_WAIT_S } from '../src/balance';
const prepare = prepareWeapon as unknown as (ctx: unknown) => void;

function setup() {
  const identity = { toHexString: () => 'abc' };
  let player = { identity, roomCode: 'TEST', abilityId: 'flash', dropX: -1, dropY: -1 };
  let room = { code: 'TEST', phase: 'draw', seed: 123, phaseStartedAt: new Timestamp(0n) } as RoomRow;
  let weapon: any = { player: identity, roomCode: 'TEST', spec: '', status: 'pending', spriteUrl: '', sfxUrl: '' };
  const drawing = { features: JSON.stringify(extractFeatures({ width: 512, height: 512, strokes: [{ color: '#ff3b3b', width: 10, points: [[20, 40, 0], [400, 40, 1000]] }] })) };
  const ctx = { sender: identity, timestamp: new Timestamp(100_000_000n), db: {
    player: { identity: { find: () => player, update: (p: any) => { player = p; } }, roomCode: { filter: () => [player] } },
    room: { code: { find: () => room, update: (r: RoomRow) => { room = r; } } },
    drawing: { player: { find: () => drawing } },
    weapon: { player: { find: () => weapon, update: (w: any) => { weapon = w; } }, insert: (w: any) => { weapon = w; }, roomCode: { filter: () => [weapon] } },
  } } as unknown as Ctx;
  return { ctx, get player() { return player; }, get room() { return room; }, get weapon() { return weapon; }, setWeapon: (w: any) => { weapon = w; } };
}

describe('post-drawing preparation', () => {
  it('resets total damage when starting a new round', () => {
    const s = setup();
    const db = s.ctx.db as any;
    db.player.identity.update({ ...s.player, totalDamage: 750 });
    for (const name of ['generation', 'drawing', 'doodle', 'weapon', 'weaponVoice', 'fighter', 'input', 'projectile', 'abilityObject', 'fxEvent']) {
      db[name] = { player: { delete: () => {} }, roomCode: { delete: () => {} } };
    }
    const logs: any[] = [], seen: any[] = [];
    db.gameLog = { insert: (row: any) => logs.push(row) };
    db.playerSeen = { insert: (row: any) => seen.push(row), identity: { find: () => undefined } };
    enterPhase(s.ctx, s.room, 'draw');
    expect((s.player as any).totalDamage).toBe(0);
    expect(logs).toMatchObject([{ roomCode: 'TEST', players: 1 }]);
    expect(seen).toMatchObject([{ rounds: 1 }]);
  });
  it('assigns a valid random special and allows 60 seconds for the full sequence', () => {
    const s = setup();
    enterPhase(s.ctx, s.room, 'drop');
    expect(Object.keys(ABILITIES)).toContain(s.player.abilityId);
    expect(s.room.phaseEndsAt.microsSinceUnixEpoch).toBe(160_000_000n);
    const special = s.player.abilityId;
    enterPhase(s.ctx, s.room, 'reveal');
    expect(s.player.abilityId).toBe(special);
  });
  it('finalizes a features-based weapon before deployment and keeps it at reveal', () => {
    const s = setup(); enterPhase(s.ctx, s.room, 'drop'); prepare(s.ctx);
    expect(s.weapon.status).toBe('fallback');
    expect(JSON.parse(s.weapon.spec).spec.archetype).toBe('thrust');
    const final = s.weapon.spec;
    prepare(s.ctx); applyFallbacks(s.ctx, 'TEST', 123);
    expect(s.weapon.spec).toBe(final);
  });
  it('preserves an already generated weapon', () => {
    const s = setup(); enterPhase(s.ctx, s.room, 'drop');
    const spec = storeWeapon({ ...MYSTERY_STICK, name: 'AI weapon' });
    s.setWeapon({ ...s.weapon, spec, status: 'ready' }); prepare(s.ctx);
    expect(s.weapon.spec).toBe(spec); expect(s.weapon.status).toBe('ready');
  });
  it('waits for an AI weapon that is still being designed', () => {
    const s = setup(); enterPhase(s.ctx, s.room, 'drop');
    s.setWeapon({ ...s.weapon, status: 'generating' });
    expect(() => prepare(s.ctx)).toThrow('weapon still generating');
    expect(s.weapon.spec).toBe('');
  });
  it('locks in the shape-based weapon once the wait runs out', () => {
    const s = setup(); enterPhase(s.ctx, s.room, 'drop');
    s.setWeapon({ ...s.weapon, status: 'generating' });
    (s.ctx as any).timestamp = new Timestamp(s.room.phaseStartedAt.microsSinceUnixEpoch + BigInt(SPEC_WAIT_S * 1e6));
    prepare(s.ctx);
    expect(s.weapon.status).toBe('fallback'); expect(s.weapon.spec).not.toBe('');
  });
  it('rejects finalization outside preparation', () => {
    const s = setup(); expect(() => prepare(s.ctx)).toThrow('drawing is not ready');
    expect(s.weapon.spec).toBe('');
  });
});
