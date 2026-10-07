import { expect, it } from 'vitest';
import { AbilityVfxScene, VFX_LIMIT } from '../src/vfx/scene';

const fighter = { id: 'a', x: 2, y: 0, facing: 0, hp: 100, effects: {}, attackAt: 0 };
it('attaches Attack boost to the weapon and Rage to the moving character', () => {
  const scene = new AbilityVfxScene();
  const boosted = { ...fighter, effects: { attack_boost: { until: 13 }, rage: { until: 13 } } };
  const marks = scene.build({ events: [], now: 11, fighters: [boosted], objects: [] });
  expect(marks.find(m => m.attachment === 'weapon')?.owner).toBe('a');
  expect(marks.find(m => m.asset === 'anger-mark' && !m.attachment)?.x).toBe(2.35);
  expect(scene.build({ events: [], now: 13, fighters: [boosted], objects: [] })).toEqual([]);
});
it('draws blood only for confirmed drain targets, and ignores unrelated abilities', () => {
  const scene = new AbilityVfxScene();
  const object = { id: '1', owner: 'a', x: 0, y: 0, data: { kind: 'drain' as const, start: 10, until: 13, radius: 3 } };
  expect(scene.build({ events: [], now: 11, fighters: [fighter], objects: [object] }).some(m => m.kind === 'blood')).toBe(false);
  const marks = scene.build({ events: [], now: 11, fighters: [fighter], objects: [{ ...object,
    data: { ...object.data, targets: [{ id: 'b', x: 4, y: 0 }] } }] });
  expect(marks.filter(m => m.kind === 'blood')).toHaveLength(5);
  expect(marks.some(m => m.kind === 'ring')).toBe(false);
  expect(scene.build({ events: [], now: 11, fighters: [fighter], objects: [{ ...object, data: { ...object.data, kind: 'wall' } }] }).filter(m => m.kind === 'wall')).toHaveLength(4);
});
it('keeps fire sparse and animated, mushrooms breathing, and pools bounded', () => {
  const scene = new AbilityVfxScene();
  const object = { id: '1', owner: 'a', x: 0, y: 0, data: { kind: 'fire' as const, start: 10, until: 13, radius: 1 } };
  const first = scene.build({ events: [], now: 11, fighters: [], objects: [object] });
  const later = scene.build({ events: [], now: 11.1, fighters: [], objects: [object] });
  expect(first.filter(m => m.kind === 'flame')).toHaveLength(2);
  expect(first.find(m => m.kind === 'flame')?.phase).not.toBe(later.find(m => m.kind === 'flame')?.phase);
  const mushroom = scene.build({ events: [], now: 11, fighters: [], objects: [{ ...object, data: { ...object.data, kind: 'mushroom' } }] });
  expect(mushroom.find(m => m.asset === 'poison-mushroom')?.stretchY).not.toBe(1);
  expect(mushroom.some(m => m.asset === undefined && m.kind !== 'shadow')).toBe(false);
  expect(scene.build({ events: [], now: 11, fighters: [], objects: Array.from({ length: 1000 }, () => object) }).length).toBeLessThanOrEqual(VFX_LIMIT);
});
it('overlaps flames around the complete ring and joins consecutive footprints', () => {
  const scene = new AbilityVfxScene();
  const object = { id: '1', owner: 'a', x: 0, y: 0, data: { kind: 'fire' as const, start: 10, until: 13, radius: 0.65 } };
  const trail = scene.build({ events: [], now: 11, fighters: [], objects: [object,
    { ...object, id: '2', x: 0.55, data: { ...object.data, start: 10.1 } }] });
  expect(trail.some(m => m.kind === 'flame' && m.x > 0.15 && m.x < 0.4)).toBe(true);
  const flames = scene.build({ events: [], now: 11, fighters: [], objects: [
    { ...object, data: { ...object.data, kind: 'ring', radius: 2 } },
  ] }).filter(m => m.kind === 'flame');
  for (let i = 0; i < flames.length; i++) {
    const a = flames[i]!, b = flames[(i + 1) % flames.length]!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(a.size * 0.4);
  }
});
