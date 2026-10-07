import { ABILITY_TUNING, type AbilityObjectData, type FighterEffects } from '@doodle/spec';
import type { VfxAsset } from './assets';

export interface VfxFighter {
  id: string; x: number; y: number; facing: number; hp: number; effects: FighterEffects;
}
export interface VfxObject {
  id: string; owner: string; x: number; y: number; data: AbilityObjectData;
}
export interface VfxMark {
  kind: 'sprite' | 'flame' | 'blood' | 'spark' | 'shadow' | 'ring';
  x: number; y: number; h: number; size: number; alpha: number;
  asset?: VfxAsset; phase?: number; stretchX?: number; stretchY?: number;
  attachment?: 'weapon'; owner?: string; color?: number; rotation?: number; ground?: boolean;

}
export const VFX_LIMIT = 640;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** Presentation only for fire, mushrooms, attack/rage marks and confirmed Life drain. */
export class AbilityVfxScene {
  build(frame: { now: number; fighters: VfxFighter[]; objects: VfxObject[] }): VfxMark[] {
    const { now } = frame, marks: VfxMark[] = [];
    let attached = false;
    const put = (m: VfxMark) => {
      if (m.alpha > 0.001 && marks.length < (attached ? VFX_LIMIT : VFX_LIMIT - 160)) marks.push(m);
    };
    const shadow = (x: number, y: number, size: number, alpha: number, color = 0x11121d) =>
      put({ kind: 'shadow', x, y, h: 0.015, size, alpha, color, ground: true });
    const fire = (x: number, y: number, size: number, age: number, alpha: number) => {
      shadow(x, y, size * 1.8, alpha * 0.24, 0xff7b16);
      put({ kind: 'flame', x, y, h: size * 0.5, size, alpha, phase: age * 7 + x * 3 + y });
    };
    const sparks = (x: number, y: number, age: number, radius: number, alpha: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const a = i * Math.PI * 2 / count + 0.6, t = (age * 0.8 + i / count) % 1;
        put({ kind: 'spark', x: x + Math.cos(a) * radius * t, y: y + Math.sin(a) * radius * t,
          h: 0.25 + t * 1.3, size: 0.04, alpha: alpha * (1 - t), color: 0xffbd57 });
      }
    };
    for (const o of frame.objects) {
      const d = o.data, age = now - d.start, remaining = d.until - now;
      if (remaining <= 0 || age < 0) continue;
      const fade = clamp(remaining / 0.35), grow = clamp(age / 0.2);
      const owner = frame.fighters.find(f => f.id === o.owner);
      const follows = d.kind === 'ring' || d.kind === 'drain';
      const x = follows && owner ? owner.x : o.x, y = follows && owner ? owner.y : o.y, r = d.radius;
      if (d.kind === 'fire') {
        for (let i = 0; i < 2; i++) fire(x + (i - 0.5) * r * 0.45, y, r * (0.55 + i * 0.2), age + i * 0.47, fade * grow * 0.85);
        sparks(x, y, age, r * 0.4, fade * 0.6, 1);
      } else if (d.kind === 'ring') {
        for (const width of [-1, 1]) put({ kind: 'ring', x, y, h: 0.025,
          size: (r + width * ABILITY_TUNING.ringHalfWidth) * 2, alpha: 0.25 * fade, color: 0xffba38, ground: true });
        for (let i = 0; i < 18; i++) {
          const a = i * Math.PI * 2 / 18;
          fire(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.6, age + i, fade * grow);
        }
        sparks(x, y, age, r, fade, 3);
      } else if (d.kind === 'mushroom') {
        shadow(x, y, r * 1.8, 0.3 * fade);
        put({ kind: 'sprite', asset: 'poison-mushroom', x, y,
          h: r * (0.7 + Math.sin(age * 3 + x) * 0.025), size: r * 1.8 * (0.94 + grow * 0.06), alpha: fade,
          rotation: Math.sin(age * 2.7 + x) * 0.065,
          stretchX: 1 + Math.sin(age * 3.4) * 0.045, stretchY: 1 - Math.sin(age * 3.4) * 0.045 });
      } else if (d.kind === 'drain') {
        for (const target of d.targets ?? []) for (let i = 0; i < 5; i++) {
          const t = (age * 1.35 + i / 5) % 1;
          put({ kind: 'blood', x: target.x + (x - target.x) * t, y: target.y + (y - target.y) * t,
            h: 0.7 + Math.sin(t * Math.PI) * 0.45, size: 0.22 + (i % 2) * 0.06,
            alpha: fade * Math.min(1, Math.sin(t * Math.PI) * 2),
            rotation: Math.atan2(y - target.y, x - target.x) + Math.PI / 2 });
        }
        if (d.targets?.length) shadow(x, y, 0.9, fade * 0.25, 0xb92242);
      }
    }
    attached = true;
    for (const f of frame.fighters) {
      if (f.hp <= 0) continue;
      const live = (key: keyof FighterEffects) => (f.effects[key]?.until ?? 0) > now;
      if (live('attack_boost')) put({ kind: 'sprite', asset: 'anger-mark', owner: f.id, attachment: 'weapon',
        x: f.x + Math.cos(f.facing) * 0.8, y: f.y + Math.sin(f.facing) * 0.8,
        h: 0.85, size: 0.46, alpha: 0.9 + Math.sin(now * 8) * 0.1 });
      if (live('rage')) {
        put({ kind: 'sprite', asset: 'anger-mark', x: f.x + 0.35, y: f.y, h: 1.9,
          size: 0.48 + Math.sin(now * 9) * 0.06, alpha: 1 });
        sparks(f.x, f.y, now, 0.55, 0.55, 3);
      }
      if (live('burn')) {
        fire(f.x, f.y, 0.5, now, 0.65);
        sparks(f.x, f.y, now, 0.35, 0.6, 2);
      }
    }
    return marks;
  }
}
