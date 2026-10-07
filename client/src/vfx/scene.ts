import { ABILITY_TUNING, isAbilityId, type AbilityObjectData, type FighterEffects } from '@doodle/spec';
import type { VfxAsset } from './assets';

export interface VfxFighter {
  id: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  effects: FighterEffects;
  attackAt: number;
}
export interface VfxObject {
  id: string;
  owner: string;
  x: number;
  y: number;
  data: AbilityObjectData;
}
export interface VfxEvent {
  id: string;
  owner: string;
  type: string;
  x: number;
  y: number;
  at: number;
  value: number;
}
export interface VfxFrame {
  now: number;
  fighters: VfxFighter[];
  objects: VfxObject[];
  events: VfxEvent[];
}
export interface VfxMark {
  kind: 'flame' | 'blood' | 'spark' | 'sprite' | 'weapon' | 'shadow' | 'ring' | 'line' | 'wall' | 'crystal' | 'ghost' | 'text';
  x: number;
  y: number;
  h: number;
  size: number;
  alpha: number;
  asset?: VfxAsset;
  phase?: number;
  stretchX?: number;
  stretchY?: number;
  attachment?: 'weapon';
  color?: number;
  rotation?: number;
  ground?: boolean;
  x2?: number;
  y2?: number;
  depth?: number;
  text?: string;
  owner?: string;
  /** Floor footprint can be rectangular (wall contact shadows). */
  floorDepth?: number;
}
export const VFX_LIMIT = 640;
const TAU = Math.PI * 2;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Stateless effects use authoritative time; bounded history is only for trails/restoration. */
export class AbilityVfxScene {
  private trails = new Map<string, { x: number; y: number; at: number }[]>();
  private shrink = new Map<string, { until: number; x: number; y: number }>();
  reset() {
    this.trails.clear();
    this.shrink.clear();
  }
  build(frame: VfxFrame): VfxMark[] {
    const { now } = frame,
      marks: VfxMark[] = [];
    let attached = false;
    // Reserve room for statuses/confirmed cues when many bomb cells overlap.
    const put = (m: VfxMark) => {
      if (marks.length < (attached ? VFX_LIMIT : VFX_LIMIT - 160) && m.alpha > 0.001) marks.push(m);
    };
    const sprite = (
      asset: VfxAsset,
      x: number,
      y: number,
      h: number,
      size: number,
      alpha = 1,
      rotation = 0,
      ground = false,
    ) => put({ kind: 'sprite', asset, x, y, h, size, alpha, rotation, ground });
    const shadow = (x: number, y: number, size: number, alpha: number, color = 0x11121d) =>
      put({ kind: 'shadow', x, y, h: 0.015, size, alpha, color, ground: true });
    const ring = (x: number, y: number, size: number, alpha: number, color: number) =>
      put({ kind: 'ring', x, y, h: 0.025, size, alpha, color, ground: true });
    const line = (x: number, y: number, x2: number, y2: number, h: number, alpha: number, color = 0xddd8ca) =>
      put({ kind: 'line', x, y, x2, y2, h, size: 0.055, alpha, color });
    const particles = (
      asset: VfxAsset,
      x: number,
      y: number,
      age: number,
      radius: number,
      alpha: number,
      count = 4,
    ) => {
      for (let i = 0; i < count; i++) {
        const a = (i * TAU) / count + 0.6,
          t = (age * 0.8 + i / count) % 1;
        if (asset === 'ember') {
          put({ kind: 'spark', x: x + Math.cos(a) * radius * t, y: y + Math.sin(a) * radius * t,
            h: 0.25 + t * 1.3, size: 0.04, alpha: alpha * (1 - t), color: 0xffbd57 });
          continue;
        }
        sprite(
          asset,
          x + Math.cos(a) * radius * t,
          y + Math.sin(a) * radius * t,
          0.25 + t * 1.3,
          0.14 + t * 0.12,
          alpha * (1 - t),
          a + age,
        );
      }
    };
    const fire = (x: number, y: number, size: number, age: number, alpha: number) => {
      shadow(x, y, size * 1.8, alpha * 0.24, 0xff7b16);
      put({ kind: 'flame', x, y, h: size * 0.5, size, alpha, phase: age * 7 + x * 3 + y });
    };
    const active = new Set<string>();
    for (const o of frame.objects) {
      const d = o.data,
        age = now - d.start,
        remaining = d.until - now;
      if (remaining <= 0) continue;
      const fade = clamp(remaining / 0.35),
        grow = clamp(age / 0.2),
        owner = frame.fighters.find((f) => f.id === o.owner);
      const follows = d.kind === 'ring' || d.kind === 'drain';
      const x = follows && owner ? owner.x : o.x,
        y = follows && owner ? owner.y : o.y,
        r = d.radius;
      if (d.kind !== 'bomb' && age < 0) continue;
      switch (d.kind) {
        case 'smoke':
          shadow(x, y, r * 2.05, 0.25 * fade * grow);
          ring(x, y, r * 2, 0.12 * fade, 0xc9bfdc);
          for (let i = 0; i < 7; i++) {
            const a = (i * TAU) / 7,
              t = Math.max(0, age - i * 0.03),
              bloom = 1 - Math.exp(-t * 7);
            sprite(
              'smoke-puff',
              x + Math.cos(a) * r * 0.42 * bloom,
              y + Math.sin(a) * r * 0.38 * bloom,
              0.4 + (i % 3) * 0.25 + Math.sin(t + i) * 0.06,
              r * (1.15 + bloom * 0.15),
              fade * clamp(t * 6) * 0.76,
              Math.sin(t * 0.3 + i) * 0.15,
            );
          }
          break;
        case 'fire':
        for (let i = 0; i < 2; i++) fire(x + (i - 0.5) * r * 0.3, y, r * 0.9, age + i * 0.47, fade * grow * 0.85);
        // Join consecutive footprints with low overlapping flames; do not bridge teleports.
        const previous = frame.objects.filter(p => p.owner === o.owner && p.data.kind === 'fire'
          && p.data.start < d.start && p.data.until > now).sort((a, b) => b.data.start - a.data.start)[0];
        if (previous) {
          const distance = Math.hypot(x - previous.x, y - previous.y);
          if (distance <= r + previous.data.radius) {
            const steps = Math.ceil(distance / (r * 0.25));
            for (let i = 1; i < steps; i++) {
              const t = i / steps;
              fire(previous.x + (x - previous.x) * t, previous.y + (y - previous.y) * t,
                r * 0.9, age + t, Math.min(fade, clamp((previous.data.until - now) / 0.35)) * grow * 0.85);
            }
          }
        }
        particles('ember', x, y, age, r * 0.4, fade * 0.6, 1);
          break;
        case 'ring':
          ring(x, y, (r - ABILITY_TUNING.ringHalfWidth) * 2, 0.25 * fade, 0xffba38);
          ring(x, y, (r + ABILITY_TUNING.ringHalfWidth) * 2, 0.25 * fade, 0xffba38);
          const count = Math.ceil(TAU * r / 0.2);
          for (let i = 0; i < count; i++) {
            const a = (i * TAU) / count;
            fire(x + Math.cos(a) * r, y + Math.sin(a) * r, 0.6, age + i, fade * grow);
          }
          particles('ember', x, y, age, r, fade, 3);
          break;
        case 'wall': {
          const height = Math.max(0.01, grow) * fade * 1.35;
          for (let i = 0; i < 4; i++) {
            const horizontal = i < 2,
              sign = i % 2 ? 1 : -1;
            const wx = x + (horizontal ? 0 : sign * r),
              wy = y + (horizontal ? sign * r : 0);
            put({
              kind: 'shadow',
              x: wx,
              y: wy,
              h: 0.015,
              size: r * 2 + 0.3,
              floorDepth: 0.55,
              alpha: 0.3 * fade,
              color: 0x11121d,
              ground: true,
              rotation: horizontal ? 0 : Math.PI / 2,
            });
            put({
              kind: 'wall',
              x: wx,
              y: wy,
              h: height / 2,
              size: r * 2,
              depth: 0.18,
              alpha: fade,
              rotation: horizontal ? 0 : Math.PI / 2,
              color: 0x7abedc,
            });
          }
          if (remaining < 0.35) particles('debris', x, y, age, r, fade, 6);
          break;
        }
        case 'freeze':
          sprite('frost-patch', x, y, 0.03, r * 2, fade, 0, true);
          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            line(
              x + Math.cos(a) * r - Math.sin(a) * r,
              y + Math.sin(a) * r + Math.cos(a) * r,
              x + Math.cos(a) * r + Math.sin(a) * r,
              y + Math.sin(a) * r - Math.cos(a) * r,
              0.04,
              fade * 0.5,
              0x9fe9ff,
            );
          }
          break;
        case 'mushroom':
          shadow(x, y, r * 1.8, 0.3 * fade);
          put({ kind: 'sprite', asset: 'poison-mushroom', x, y,
            h: r * (0.7 + Math.sin(age * 3 + x) * 0.025), size: r * 1.8 * (0.94 + grow * 0.06), alpha: fade,
            rotation: Math.sin(age * 2.7 + x) * 0.065,
            stretchX: 1 + Math.sin(age * 3.4) * 0.045, stretchY: 1 - Math.sin(age * 3.4) * 0.045 });
          break;
        case 'bomb':
          if (age < 0) {
            ring(x, y, r * 2, 0.12 + (0.18 * (1 + Math.sin(now * 14))) / 2, 0xffa341);
            if (age > -0.65) sprite('debris', x, y, 0.3 - age * 5, 0.35, 0.7, age * 5);
          } else {
            const burst = clamp(age / 0.1);
            shadow(x, y, r * 2.1, fade * 0.22, 0xff941c);
            sprite('explosion', x, y, r * 0.5, r * 2.3 * (0.6 + burst * 0.4), fade);
            if (age > 0.12) sprite('smoke-puff', x, y, 0.6 + age, r * 1.2, fade * 0.32, age * 0.2);
            particles('debris', x, y, age, r * 1.1, fade, 2);
          }
          break;
        case 'drain':
          for (const target of d.targets ?? [])
            for (let i = 0; i < 5; i++) {
              const t = (age * 1.35 + i / 5) % 1;
              put({ kind: 'blood', x: target.x + (x - target.x) * t, y: target.y + (y - target.y) * t,
                h: 0.7 + Math.sin(t * Math.PI) * 0.45, size: 0.22 + (i % 2) * 0.06,
                alpha: fade * Math.min(1, Math.sin(t * Math.PI) * 2),
                rotation: Math.atan2(y - target.y, x - target.x) + Math.PI / 2 });
            }
          if (d.targets?.length) shadow(x, y, 0.9, fade * 0.25, 0xb92242);
          break;
        case 'hook':
          if (owner) line(owner.x, owner.y, x, y, 0.7, fade);
          shadow(x, y, 0.55, 0.22 * fade);
          sprite('hook-head', x, y, 0.7, 0.8, fade, Math.atan2(d.vy ?? 0, d.vx ?? 1));
          break;
        case 'silence':
          sprite('mute-symbol', x, y, 0.7, 0.65, fade, Math.sin(age * 8) * 0.15);
          particles('sparkle', x, y, age, 0.3, 0.4 * fade, 2);
          break;
        case 'boomerang': {
          active.add(o.id);
          const trail = this.trails.get(o.id) ?? [];
          if (!trail.length || now - trail[trail.length - 1]!.at > 0.03) trail.push({ x, y, at: now });
          while (trail.length && (now - trail[0]!.at > 0.32 || trail.length > 12)) trail.shift();
          this.trails.set(o.id, trail);
          for (let i = 1; i < trail.length; i++) {
            const a = trail[i - 1]!,
              b = trail[i]!;
            line(a.x, a.y, b.x, b.y, 0.8, (1 - (now - a.at) / 0.32) * 0.5, 0xaaddff);
          }
          shadow(x, y, 0.7, 0.22 * fade);
          break;
        }
      }
    }
    for (const id of this.trails.keys()) if (!active.has(id)) this.trails.delete(id);
    attached = true;
    for (const f of frame.fighters) {
      if (f.hp <= 0) {
        this.shrink.delete(f.id);
        continue;
      }
      const live = (key: keyof FighterEffects) => (f.effects[key]?.until ?? 0) > now;
      const { x, y } = f;
      if (live('invisible')) particles('sparkle', x, y, now, 0.55, 0.3, 3);
      if (live('attack_boost')) {
        put({ kind: 'sprite', asset: 'anger-mark', owner: f.id, attachment: 'weapon',
          x: x + Math.cos(f.facing) * 0.8, y: y + Math.sin(f.facing) * 0.8,
          h: 0.85, size: 0.46, alpha: 0.9 + Math.sin(now * 8) * 0.1 });
      }
      if (live('rage')) {
        sprite('anger-mark', x + 0.35, y, 1.9, 0.48 + Math.sin(now * 9) * 0.06);
        particles('ember', x, y, now, 0.55, 0.55, 3);
        if (f.attackAt > 0 && now >= f.attackAt && now - f.attackAt < 0.2)
          sprite(
            'slash-streak',
            x + Math.cos(f.facing) * 0.6,
            y + Math.sin(f.facing) * 0.6,
            0.9,
            1.3,
            0.85,
            f.facing,
          );
      }
      if (live('weapon_boost'))
        particles('sparkle', x + Math.cos(f.facing) * 0.8, y + Math.sin(f.facing) * 0.8, now, 0.5, 0.8, 3);
      if (live('burn')) {
        fire(x, y, 0.5, now, 0.65);
        particles('ember', x, y, now, 0.35, 0.6, 2);
      }
      if (live('poison')) particles('poison-spore', x, y, now, 0.65, 0.8, 4);
      if (live('silenced')) sprite('mute-symbol', x, y, 2.1, 0.6, 0.9);
      if (live('frozen')) {
        shadow(x, y, 1.4, 0.16, 0x73d7ff);
        const fade = clamp((f.effects.frozen!.until - now) / 0.2);
        for (let i = 0; i < 5; i++) {
          const a = (i * TAU) / 5;
          put({
            kind: 'crystal',
            x: x + Math.cos(a) * 0.48,
            y: y + Math.sin(a) * 0.48,
            h: 0.6,
            size: 0.4,
            depth: 1.05 + (i % 2) * 0.4,
            alpha: fade,
            rotation: a,
            color: 0x86dcff,
          });
        }
      }
      if (live('shrink')) this.shrink.set(f.id, { until: f.effects.shrink!.until, x, y });
      else {
        const old = this.shrink.get(f.id);
        if (old && now >= old.until && now - old.until < 0.4) {
          sprite('flash-star', x, y, 0.8, 1.1 + (now - old.until), 1 - (now - old.until) / 0.4);
        } else this.shrink.delete(f.id);
      }
    }
    for (const id of this.shrink.keys()) if (!frame.fighters.some((f) => f.id === id)) this.shrink.delete(id);
    for (const e of frame.events) {
      const age = now - e.at;
      if (age < 0 || age > 0.7) continue;
      if (isAbilityId(e.type) && frame.fighters.some((f) => f.id === e.owner && f.hp <= 0)) continue;
      const alpha = clamp(1 - age / 0.65),
        owner = frame.fighters.find((f) => f.id === e.owner);
      if (e.type === 'flash' || e.type === 'dash') {
        sprite('flash-star', e.x, e.y, 0.6, 0.7 + age, alpha);
        const end = frame.events.find(
          (v) => v.owner === e.owner && v.type === `${e.type}_end` && Math.abs(v.at - e.at) < 0.001,
        );
        if (end)
          for (let i = 0; i < 5; i++) {
            const t = i / 4;
            put({
              kind: 'ghost',
              x: e.x + (end.x - e.x) * t,
              y: e.y + (end.y - e.y) * t,
              h: 0.8,
              size: 1.1,
              alpha: alpha * 0.25,
              color: 0xb8dfff,
              rotation: e.value,
              owner: e.owner,
            });
          }
        if (end && e.type === 'dash')
          sprite(
            'slash-streak',
            (e.x + end.x) / 2,
            (e.y + end.y) / 2,
            0.65,
            Math.max(0.5, Math.hypot(end.x - e.x, end.y - e.y)),
            alpha,
            Math.atan2(end.y - e.y, end.x - e.x),
          );
      } else if (
        [
          'flash_end',
          'dash_end',
          'dash_impact',
          'hook_contact',
          'hook_end',
          'flashbang',
          'weapon_boost',
        ].includes(e.type)
      ) {
        sprite(
          e.type === 'dash_impact' ? 'explosion' : 'flash-star',
          e.x,
          e.y,
          0.8,
          0.6 + age * 1.4,
          alpha,
          age,
        );
        if (e.type === 'hook_contact') {
          const end = frame.events.find(
            (v) => v.type === 'hook_end' && v.owner === e.owner && Math.abs(v.at - e.at) < 0.001,
          );
          if (end) {
            const t = clamp(age / 0.2);
            line(end.x, end.y, e.x + (end.x - e.x) * t, e.y + (end.y - e.y) * t, 0.7, alpha);
            sprite(
              'hook-head',
              e.x + (end.x - e.x) * t,
              e.y + (end.y - e.y) * t,
              0.7,
              0.65,
              alpha,
              Math.atan2(end.y - e.y, end.x - e.x),
            );
          }
        }
      } else if (e.type === 'spore_hit') particles('poison-spore', e.x, e.y, age, 1.2, alpha, 7);
      else if (e.type === 'shrink') {
        for (let i = 0; i < 5; i++) {
          const a = (i * TAU) / 5;
          sprite('sparkle', e.x + Math.cos(a) * (1 - age), e.y + Math.sin(a) * (1 - age), 0.6, 0.22, alpha);
        }
      } else if (e.type === 'ability_cost') {
        put({
          kind: 'text',
          x: e.x,
          y: e.y,
          h: 1.8 + age,
          size: 0.35,
          alpha,
          color: 0xff7863,
          text: `−${Math.round(e.value)} HP`,
        });
      } else if (e.type === 'attack_boost') particles('ember', e.x, e.y, age, 1, alpha, 6);
      else if (e.type === 'invisible' && owner) particles('sparkle', e.x, e.y, age, 1, alpha, 5);
    }
    return marks;
  }
}
