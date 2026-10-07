import { describe, expect, it } from 'vitest';
import { AbilityVfxScene, VFX_LIMIT, type VfxFrame } from '../src/vfx/scene';
import { blindOpacity } from '../src/ui/ability-blindness';
import { createAbilityPreview } from '../src/routes/play/ability-preview';
import { ABILITIES } from '@doodle/spec';

const empty = (now: number): VfxFrame => ({ now, objects: [], events: [], fighters: [] });
const fighter = { id: 'a', x: 0, y: 0, hp: 5000, facing: 0, effects: {}, attackAt: 0 };

describe('authoritative VFX timing and lifecycle', () => {
  it.each(Object.keys(ABILITIES) as (keyof typeof ABILITIES)[])(
    'renders %s from the actual ability state',
    (id) => {
      const s = createAbilityPreview(id);
      const scene = new AbilityVfxScene();
      let visible = false;
      for (let i = 0; i < 140; i++) {
        s.step();
        const frame: VfxFrame = {
          now: s.time,
          objects: [...s.objects.values()].map((o) => ({
            id: String(o.id),
            owner: o.owner.toHexString(),
            x: o.x,
            y: o.y,
            data: JSON.parse(o.data),
          })),
          fighters: [...s.fighters.values()].map((f) => ({
            id: f.player.toHexString(),
            x: f.x,
            y: f.y,
            hp: f.hp,
            facing: f.facing,
            effects: JSON.parse(f.effects),
            attackAt: Number(f.lastAttackAt.microsSinceUnixEpoch) / 1e6,
          })),
          events: s.events.map((e, i) => ({
            id: String(i),
            type: e.type,
            owner: e.owner?.toHexString() ?? '',
            x: e.x,
            y: e.y,
            value: e.value,
            at: e.at,
          })),
        };
        const marks = scene.build(frame);
        visible ||= marks.length > 0;
        expect(marks.length).toBeLessThanOrEqual(VFX_LIMIT);
        expect(
          marks.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && m.alpha > 0 && m.alpha <= 1),
        ).toBe(true);
      }
      expect(visible).toBe(true);
      scene.reset();
      expect(scene.build(empty(10))).toEqual([]);
    },
  );
  it('uses a confirmed teleport endpoint, never a predicted travel distance', () => {
    const scene = new AbilityVfxScene();
    const events = [{ id: '1', owner: 'a', type: 'dash', x: 0, y: 0, value: 0, at: 10 }];
    expect(
      scene.build({ ...empty(10.1), fighters: [fighter], events }).filter((m) => m.kind === 'ghost'),
    ).toHaveLength(0);
    events.push({ id: '2', owner: 'a', type: 'dash_end', x: 0.7, y: 0, value: 0, at: 10 });
    const ghosts = scene
      .build({ ...empty(10.1), fighters: [fighter], events })
      .filter((m) => m.kind === 'ghost');
    expect(ghosts).toHaveLength(5);
    expect(Math.max(...ghosts.map((m) => m.x))).toBe(0.7);
    expect(scene.build({ ...empty(11), events })).toEqual([]);
  });
  it('only draws drain droplets for server-confirmed targets', () => {
    const scene = new AbilityVfxScene();
    const data = { kind: 'drain' as const, radius: 3, start: 10, until: 13 };
    const object = { id: '1', owner: 'a', x: 0, y: 0, data };
    expect(scene.build({ ...empty(11), objects: [object] }).some((m) => m.kind === 'blood')).toBe(
      false,
    );
    expect(
      scene
        .build({
          ...empty(11),
          objects: [{ ...object, data: { ...data, targets: [{ id: 'b', x: 2, y: 0 }] } }],
        })
        .some((m) => m.kind === 'blood'),
    ).toBe(true);
  });
  it('keeps Attack boost attached to the weapon throughout movement and expiry', () => {
    const scene = new AbilityVfxScene();
    const boosted = { ...fighter, effects: { attack_boost: { until: 13 } } };
    for (const x of [0, 2, 4]) {
      const marks = scene.build({ ...empty(11), fighters: [{ ...boosted, x }] });
      const anger = marks.find(m => m.asset === 'anger-mark');
      expect(anger?.attachment).toBe('weapon');
      expect(anger?.owner).toBe('a');
      expect(anger?.x).toBeCloseTo(x + 0.8);
    }
    expect(scene.build({ ...empty(13), fighters: [boosted] })).toEqual([]);
    expect(scene.build({ ...empty(11), events: [{ id: 'cost', owner: 'a', type: 'ability_cost', x: 0, y: 0, at: 11, value: 10 }] })
      .some(m => m.asset === 'anger-mark')).toBe(false);
  });
  it('removes projectile trail history at expiry and round reset', () => {
    const scene = new AbilityVfxScene();
    const object = {
      id: '1',
      owner: 'a',
      x: 0,
      y: 0,
      data: { kind: 'boomerang' as const, radius: 0.3, start: 10, until: 12 },
    };
    scene.build({ ...empty(10), objects: [object] });
    expect(
      scene.build({ ...empty(10.1), objects: [{ ...object, x: 1 }] }).some((m) => m.kind === 'line'),
    ).toBe(true);
    scene.reset();
    expect(
      scene.build({ ...empty(10.2), objects: [{ ...object, x: 2 }] }).some((m) => m.kind === 'line'),
    ).toBe(false);
    expect(scene.build({ ...empty(12), objects: [object] })).toEqual([]);
  });
  it('keeps status icons under bomb saturation and excludes dead fighters', () => {
    const scene = new AbilityVfxScene();
    const objects = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      owner: 'a',
      x: i % 20,
      y: 0,
      data: { kind: 'bomb' as const, radius: 1, start: 10, until: 11 },
    }));
    const frame = {
      ...empty(10.2),
      objects,
      fighters: [{ ...fighter, effects: { silenced: { until: 13 } } }],
    };
    expect(scene.build(frame).some((m) => m.asset === 'mute-symbol')).toBe(true);
    expect(
      scene
        .build({ ...frame, fighters: [{ ...frame.fighters[0]!, hp: 0 }] })
        .some((m) => m.asset === 'mute-symbol'),
    ).toBe(false);
  });
  it('never shortens blindness and fades only after expiry', () => {
    expect(blindOpacity(11.999, 12)).toBe(1);
    expect(blindOpacity(12, 12)).toBe(1);
    expect(blindOpacity(12.125, 12)).toBeCloseTo(0.5);
    expect(blindOpacity(12.25, 12)).toBe(0);
    expect(blindOpacity(1, 0)).toBe(0);
  });
});
