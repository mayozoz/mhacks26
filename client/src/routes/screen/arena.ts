import { Timestamp } from 'spacetimedb';
import { Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture, type Filter } from 'pixi.js';
import {
  ARCHETYPE_MODULES, Character, Character3D, Feedback, Interpolator, STAGE, Stage3D, StageGrid, Tweener,
  WeaponDecor, createWeaponSprite, drawMarker, ease, edgePoints, loadCharacterAsset, loadCutout, motionFeel,
  type CharacterAsset, type EdgePoints,
} from '@doodle/engine';
import {
  ABILITY_TUNING, DEFAULT_SWING, MAX_HP, arenaExtents, colorForSlot,
  type AbilityObjectData, type FighterEffects, type Marker, type Phase, type ProjectileMeta, type StoredWeapon,
} from '@doodle/spec';
import { GAME, PROJECTILE } from '../../../../server/src/balance';
import { secondsLeft, serverNowMs } from '../../net/clock';
import type { DbConnection } from '../../module_bindings';
import { hexToNum } from '../../ui/theme';
import { drawStorm } from './storm-effects';
import { AbilityVfxScene, type VfxFrame } from '../../vfx/scene';
import { PixiAbilityVfx } from '../../vfx/pixi';
import { ThreeAbilityVfx } from '../../vfx/three';

// Display-only stand-in until the fighter's weapon row arrives. Never used for gameplay.
const PLACEHOLDER: StoredWeapon = {
  spec: DEFAULT_SWING,
  stats: { cooldown: 0.6, damagePerHit: 7.2, dotPerSecond: 0, dotSeconds: 0, rangeUnits: 1.6, areaUnits: 1, moveSpeedMul: 1 },
};

const MOVE_SPEED = 5; // units/s — mirrors GAME.moveSpeed, only used to scale the run animation

interface FighterView {
  /** Pixi overlay (hand/weapon, tag, HP) — or the full 2D rig when 3D is unavailable */
  char: Character;
  body3d: Character3D | null;
  last: { x: number; y: number } | null;
  weapon: Sprite | null;
  interp: Interpolator;
  lastAttack: bigint;
  stored: StoredWeapon;
  /** set once HP hits 0; the avatar + weapon fade out and stay hidden for the rest of the round */
  dead: boolean;
  /** px-per-unit the weapon sprite was built at; the hand rescales by unit / weaponUnit so the
   *  weapon keeps its world size as the arena (and the zoom) grows with the player count */
  weaponUnit: number;
  /** the AI's upgrades drawn on top of the doodle (never edits it) */
  decor: WeaponDecor | null;
  effects: FighterEffects;
  grayscale: ColorMatrixFilter;
}

const DEATH_FADE_S = 0.9;

/** Each weapon sprite's own filters (e.g. raw-doodle outline/glow), so status tints can stack on top. */
const baseFilters = new WeakMap<Sprite, Filter[]>();

/** One rendered projectile row: a glowing shot, or the owner's weapon flying (throw). */
interface ProjectileView {
  view: Container;
  shadow: Graphics | null;
  interp: Interpolator;
  meta: ProjectileMeta;
  owner: string;
  expiresMs: number;
  spin: number;
}

/**
 * Shared-screen arena. With the 3D character: three.js draws floor grid + bodies on a canvas
 * underneath; this Pixi canvas (transparent) draws weapons, fx, tags, storm and markers on top,
 * placed with Stage3D.toScreen so both layers line up. Without it: everything is 2D Pixi.
 */
export class Arena {
  private world = new Container();
  private grid = new StageGrid();
  /** ground-plane layer: squashed vertically to match the tilted 3D camera */
  private ground = new Container();
  /** faint ring at the arena wall — fighters are clamped to it, so keep it visible */
  private edge = new Graphics();
  private storm = new Graphics();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private markers = new Container();
  private actors = new Container();
  private fx = new Container();
  private shots = new Container();
  private projectiles = new Map<bigint, ProjectileView>();
  private vfxScene = new AbilityVfxScene();
  private vfx2d = new PixiAbilityVfx();
  private vfx3d: ThreeAbilityVfx | null = null;
  private disposed = false;
  private cleanups: (() => void)[] = [];
  private projectileSprites = new Map<bigint, Sprite>();
  private blind = new Graphics();
  private blindUntil = new Timestamp(0n);
  private numbers = new Container();
  private tweener = new Tweener();
  private feedback: Feedback;
  private fighters = new Map<string, FighterView>();
  private textures = new Map<string, Texture>();
  /** doodle outline points per texture (decorations hang off the real silhouette) */
  private edges = new WeakMap<Texture, EdgePoints>();
  private code = '';
  private phase: Phase = 'lobby';
  private unit = 40; // px per world unit, recomputed from arena radius

  private constructor(
    private app: Application,
    private conn: DbConnection,
    private stage3d: Stage3D | null,
    private asset: CharacterAsset | null,
  ) {
    this.ground.addChild(this.edge, this.storm, this.markers);
    if (stage3d) this.ground.scale.y = Stage3D.groundScaleY;
    else this.world.addChild(this.grid.view);
    this.world.addChild(this.ground, this.vfx2d.floor, this.actors, this.shots, this.fx, this.numbers);
    app.stage.addChild(this.world, this.blind);
    this.feedback = new Feedback(this.world, this.tweener, this.numbers);
    app.ticker.add((t) => this.frame(t.deltaMS / 1000));
    this.fx.addChild(this.vfx2d.view);
    if (stage3d) this.vfx3d = new ThreeAbilityVfx(stage3d.scene, stage3d.camera,asset);
    this.wire();

  }

  static async create(host: HTMLElement, conn: DbConnection): Promise<Arena> {
    // A missing/broken model must never stall the round: fall back to the 2D rig.
    let asset = await loadCharacterAsset().catch((e: unknown) => {
      console.warn('[arena] 3D character unavailable, using 2D rig', e);
      return null;
    });
    let stage3d: Stage3D | null = null;
    if (asset) {
      try { stage3d = new Stage3D(); }
      catch (error) {
        console.warn('[arena] 3D graphics unavailable, using the 2D arena', error);
        asset = null;
      }
    }
    if (stage3d) host.appendChild(stage3d.canvas);
    const app = new Application();
    await app.init({ resizeTo: window, background: STAGE.background, backgroundAlpha: stage3d ? 0 : 1, antialias: true });
    Object.assign(app.canvas.style, { position: 'absolute', inset: '0' });
    host.appendChild(app.canvas);
    return new Arena(app, conn, stage3d, asset);
  }

  /** game (x, y, height) → Pixi world-container coords */
  private toScreen(x: number, y: number, h = 0) {
    return this.stage3d ? Stage3D.toScreen(x, y, h, this.unit) : { x: x * this.unit, y: (y - h * 0.5) * this.unit };
  }

  setRoom(code: string) { this.code = code; }
  setPhase(p: Phase) {
    if (p !== this.phase) { this.vfxScene.reset(); this.vfx2d.reset(); this.vfx3d?.reset(); this.blindUntil=new Timestamp(0n); }
    this.phase = p;
    if (p === 'draw' || p === 'lobby') {
      // Round boundary: drop every fighter and every weapon texture, so nobody's old doodle
      // can show up next round.
      this.clearFighters();
      for (const id of [...this.projectiles.keys()]) this.removeProjectile(id);
      for (const tex of this.textures.values()) tex.destroy(true);
      this.textures.clear();
    }
  }

  private wire() {
    const c = this.conn;
    const watch = <K extends 'onInsert'|'onUpdate'|'onDelete', T extends Record<K, (callback: any) => void>>(table:T, kind:K, callback:Parameters<T[K]>[0]) => {
      table[kind](callback);
      this.cleanups.push(() => (table as any)[kind.replace('on','removeOn')](callback));
    };
    const mine = (roomCode: string) => roomCode === this.code;

    watch(c.db.fighter, 'onInsert', (_e, f) => { if (mine(f.roomCode)) void this.ensureFighter(f.player.toHexString()); });
    watch(c.db.fighter, 'onUpdate', (_e, _old, f) => {
      if (!mine(f.roomCode)) return;
      const v = this.fighters.get(f.player.toHexString());
      if (!v) return;
      v.interp.push(f.x, f.y, f.facing);
      v.char.setHp(f.hp / MAX_HP);
      v.effects = JSON.parse(f.effects);
      if (f.hp <= 0) this.killFighter(v);
      if (f.lastAttackAt.microsSinceUnixEpoch !== v.lastAttack) {
        v.lastAttack = f.lastAttackAt.microsSinceUnixEpoch;
        this.playAttack(v, f.facing);
      }
    });
    watch(c.db.fighter, 'onDelete', (_e, f) => this.removeFighter(f.player.toHexString()));

    watch(c.db.fxEvent, 'onInsert', (_e, ev) => {
      if (!mine(ev.roomCode)) return;
      const { x, y } = this.toScreen(ev.x, ev.y, 1.2);
      if (ev.type === 'blind') this.blindUntil = new Timestamp(ev.createdAt.microsSinceUnixEpoch + BigInt(Math.round(ev.value * 1e6)));
      if (ev.type === 'hit') {
        const attacker = this.fighters.get(ev.owner.toHexString());
        const weight = attacker?.stored.spec.motion.weight ?? 0.5;
        this.feedback.hitStop(40);
        this.feedback.shake(2 + weight * 10);
        this.feedback.damageNumber(x, y, ev.value);
        // TODO(M1): flash the victim — needs victim id on the event (add `target` column).
      } else if (ev.type === 'shockwave') {
        // slam / lobbed-shot landing: ring on the ground (ground layer is foreshortened like the 3D floor)
        this.shockwave(ev.x, ev.y, ev.value, ev.owner.toHexString());
      } else if (ev.type === 'death') {
        // TODO(M1): confetti in the dead player's color.
      }
    });

    watch(c.db.projectile, 'onInsert', (_e, p) => { if (mine(p.roomCode)) this.addProjectile(p); });
    watch(c.db.projectile, 'onUpdate', (_e, _o, p) => {
      const v = this.projectiles.get(p.id);
      if (!v) return;
      v.interp.push(p.x, p.y, Math.atan2(p.vy, p.vx));
      try { v.meta = JSON.parse(p.hits) as ProjectileMeta; } catch { /* keep last */ }
    });
    watch(c.db.projectile, 'onDelete', (_e, p) => this.removeProjectile(p.id));

    // When a weapon row changes (fallback/AI spec, sprite URL), rebuild that fighter's weapon.
    const prepareWeapon = (w: { roomCode: string; player: { toHexString(): string }; spec: string; sfxUrl: string }) => {
      if (!mine(w.roomCode)) return;
      void this.refreshWeapon(w.player.toHexString());
    };
    watch(c.db.weapon, 'onInsert', (_e, w) => prepareWeapon(w));
    watch(c.db.weapon, 'onUpdate', (_e, _o, w) => prepareWeapon(w));
  }

  private async ensureFighter(hex: string) {
    if(this.disposed)return;
    if (this.fighters.has(hex)) return;
    const p = [...this.conn.db.player.iter()].find((x) => x.identity.toHexString() === hex);
    if (!p) return;
    const color = colorForSlot(p.colorSlot);
    const tint = hexToNum(color.hex);
    const char = new Character(tint, p.marker as Marker, p.name, this.unit, { overlay: !!this.stage3d });
    this.actors.addChild(char.view);
    let body3d: Character3D | null = null;
    if (this.stage3d && this.asset) {
      body3d = new Character3D(this.asset, tint);
      this.stage3d.scene.add(body3d.root);
    }
    const v: FighterView = { char, body3d, last: null, weapon: null, interp: new Interpolator(), lastAttack: 0n, stored: PLACEHOLDER, dead: false, weaponUnit: this.unit, decor: null, effects: {}, grayscale: new ColorMatrixFilter() };
    v.grayscale.desaturate();
    this.fighters.set(hex, v);
    const row = [...this.conn.db.fighter.iter()].find((f) => f.player.toHexString() === hex);
    if (row) { v.interp.push(row.x, row.y, row.facing); v.effects = JSON.parse(row.effects); char.setHp(row.hp / MAX_HP); }
    // Joined mid-battle (e.g. screen reload): someone already out shouldn't pop back in.
    if (row && row.hp <= 0) this.killFighter(v, true);
    await this.refreshWeapon(hex);
  }

  private async refreshWeapon(hex: string) {
    const v = this.fighters.get(hex);
    if (!v) return;
    const row = [...this.conn.db.weapon.iter()].find((w) => w.player.toHexString() === hex);
    v.stored = row?.spec ? (JSON.parse(row.spec) as StoredWeapon) : PLACEHOLDER;
    const doodle = [...this.conn.db.doodle.iter()].find((d) => d.player.toHexString() === hex);

    let tex: Texture | null = null;
    let raw = false;
    if (row?.spriteUrl) tex = await this.loadUrl(row.spriteUrl);
    if (!tex && doodle) { tex = await this.loadPng(hex, doodle.png); raw = true; }
    if (!tex || this.disposed || this.fighters.get(hex)!==v) return;

    v.weapon?.destroy();
    v.decor?.destroy();
    v.weapon = createWeaponSprite(tex, v.stored, this.unit, raw);
    v.weaponUnit = this.unit;
    this.vfx3d?.setWeapon(hex,tex.source.resource as TexImageSource,v.weapon.width/this.unit,v.weapon.height/this.unit);
    baseFilters.set(v.weapon, v.weapon.filters ? [...v.weapon.filters] : []);
    v.decor = new WeaponDecor(tex, this.edges.get(tex) ?? [], v.stored.spec, v.weapon.scale.x);
    v.char.hand.addChild(v.decor.back, v.weapon, v.decor.front); // upgrades behind + in front
  }

  /** Generated sprite (inline or hosted). Cut out the white too: server-side background removal isn't built. */
  private async loadUrl(url: string): Promise<Texture | null> {
    return this.cachedCutout(url, url);
  }

  /** Raw doodle PNG (sprite fallback): strokes only, no white box. */
  private async loadPng(key: string, png: Uint8Array): Promise<Texture | null> {
    // Keyed by content, not just player: a re-submitted drawing must never reuse the old texture.
    return this.cachedCutout(`png:${key}:${png.length}:${hashBytes(png)}`, png);
  }

  private async cachedCutout(key: string, src: string | Uint8Array): Promise<Texture | null> {
    const cached = this.textures.get(key);
    if (cached) return cached;
    try {
      const canvas = await loadCutout(src);
      if(this.disposed)return null;
      const tex = Texture.from(canvas);
      this.edges.set(tex, edgePoints(canvas));
      this.textures.set(key, tex);
      return tex;
    } catch { return null; }
  }

  /** Fade the dead fighter's avatar (3D body + ring) and overlay (weapon, tag, HP bar) out of the arena. */
  private killFighter(v: FighterView, instant = false) {
    if (v.dead) return;
    v.dead = true;
    const hide = () => {
      v.char.view.visible = false;
      v.body3d?.setOpacity(0);
    };
    if (instant) return hide();
    void this.tweener.to(DEATH_FADE_S, (t) => {
      const a = 1 - t;
      v.char.view.alpha = a;
      v.body3d?.setOpacity(a);
    }, ease.inQuad).then(hide);
    // TODO(M1): death confetti in the player's color (fx_event 'death' already fires).
  }

  private playAttack(v: FighterView, facing: number) {
    if (!v.weapon || v.dead) return;
    const mod = ARCHETYPE_MODULES[v.stored.spec.archetype];
    const feel = motionFeel(v.stored.spec.motion, v.stored.spec.archetype);
    void v.body3d?.attack(v.stored.spec.archetype, feel, this.tweener);
    void mod.play(v.weapon, {
      spec: v.stored.spec, stats: v.stored.stats, feel,
      tweener: this.tweener, unit: this.unit, fxLayer: this.fx, facing,
      from: v.last ?? undefined,
      project: (x, y, h = 0) => this.toScreen(x, y, h),
    });
  }

  private shockwave(x: number, y: number, radius: number, ownerHex: string) {
    const owner = [...this.conn.db.player.iter()].find((p) => p.identity.toHexString() === ownerHex);
    const color = owner ? hexToNum(colorForSlot(owner.colorSlot).hex) : 0xffffff;
    const g = new Graphics();
    this.ground.addChild(g);
    const cx = x * this.unit, cy = y * this.unit; // ground layer is already squashed vertically
    void this.tweener.to(0.35, (t) => {
      const r = radius * this.unit * (0.3 + 0.7 * t);
      g.clear().circle(cx, cy, r).stroke({ color: 0xffffff, width: 6 * (1 - t), alpha: 1 - t })
        .circle(cx, cy, r * 0.92).stroke({ color, width: 3 * (1 - t), alpha: 1 - t });
    }).then(() => g.destroy());
  }

  private addProjectile(p: { id: bigint; owner: { toHexString(): string }; x: number; y: number; vx: number; vy: number; hits: string; expiresAt: { toMillis(): bigint } }) {
    let meta: ProjectileMeta;
    try { meta = JSON.parse(p.hits) as ProjectileMeta; } catch { return; }
    const owner = p.owner.toHexString();
    const fv = this.fighters.get(owner);
    const view = new Container();
    let shadow: Graphics | null = null;
    if (meta.k === 'throw' && fv?.weapon) {
      // the owner's actual weapon flies; their hand is empty until it comes back
      const s = new Sprite(fv.weapon.texture);
      s.anchor.copyFrom(fv.weapon.anchor);
      s.scale.set(fv.weapon.scale.x * 0.8 * fv.char.hand.scale.x); // same zoom as the hand
      if (fv.weapon.filters) s.filters = [...fv.weapon.filters];
      view.addChild(s);
      fv.weapon.visible = false;
    } else {
      const player = [...this.conn.db.player.iter()].find((x) => x.identity.toHexString() === owner);
      const outline = player ? hexToNum(colorForSlot(player.colorSlot).hex) : 0xffffff;
      const pal = fv?.stored.spec.palette[0];
      const fill = pal ? hexToNum(pal) : 0xfff3a0;
      const r = meta.r * this.unit;
      // weapon's own color, thin outline in the player's color (brief §3)
      view.addChild(new Graphics().circle(0, 0, r * 1.6).fill({ color: fill, alpha: 0.25 }).circle(0, 0, r).fill(fill).stroke({ color: outline, width: 2 }));
      if (meta.beh === 'arc') {
        shadow = new Graphics().ellipse(0, 0, r, r * 0.5).fill({ color: 0x000000, alpha: 0.35 });
        this.shots.addChild(shadow);
      }
    }
    this.shots.addChild(view);
    const interp = new Interpolator();
    interp.push(p.x, p.y, Math.atan2(p.vy, p.vx));
    this.projectiles.set(p.id, { view, shadow, interp, meta, owner, expiresMs: Number(p.expiresAt.toMillis()), spin: 0 });
  }

  private removeProjectile(id: bigint) {
    const v = this.projectiles.get(id);
    if (!v) return;
    v.view.destroy({ children: true });
    v.shadow?.destroy();
    this.projectiles.delete(id);
    if (v.meta.k === 'throw') {
      // weapon is back in hand (unless another throw from the same owner is still out)
      const stillOut = [...this.projectiles.values()].some((o) => o.owner === v.owner && o.meta.k === 'throw');
      const fv = this.fighters.get(v.owner);
      if (fv?.weapon && !stillOut) fv.weapon.visible = true;
    }
  }

  private drawProjectiles(dt: number) {
    const now = serverNowMs();
    for (const v of this.projectiles.values()) {
      const s = v.interp.sample();
      if (!s) continue;
      let h = 1.0; // shots fly at about hand height
      if (v.meta.k === 'shot' && v.meta.beh === 'arc') {
        const life = Math.max(1, v.expiresMs - v.meta.t0);
        const t = Math.min(1, Math.max(0, (now - v.meta.t0) / life));
        h = 0.6 + 4 * PROJECTILE.arcPeakHeight * t * (1 - t);
        const g = this.toScreen(s.x, s.y, 0);
        v.shadow?.position.set(g.x, g.y);
      }
      const p = this.toScreen(s.x, s.y, h);
      v.view.position.set(p.x, p.y);
      if (v.meta.k === 'throw') { v.spin += dt * 16; v.view.rotation = v.spin; }
    }
  }

  private removeFighter(hex: string) {
    this.vfx3d?.removeWeapon(hex);
    const v = this.fighters.get(hex);
    v?.char.view.destroy({ children: true });
    v?.body3d?.dispose();
    v?.decor?.destroy();
    this.fighters.delete(hex);
  }

  private clearFighters() {
    for (const hex of [...this.fighters.keys()]) this.removeFighter(hex);
  }

  private frame(dt: number) {
    if (this.disposed) return;
    const simDt = this.feedback.step(dt);
    this.tweener.step(dt);
    const r = this.conn.db.room.code.find(this.code);
    if (!r) return;

    // Fit the screen-shaped arena rectangle to the screen (letterboxed if the aspect differs).
    const arenaR = r.arenaR || 10;
    const { hw, hh } = arenaExtents(arenaR);
    const k = this.stage3d ? Stage3D.groundScaleY : 1;
    this.unit = Math.min(this.app.screen.width / (2 * hw), this.app.screen.height / (2 * hh * k));
    this.world.position.set(this.app.screen.width / 2, this.app.screen.height / 2);

    if (this.stage3d) {
      this.stage3d.setView(this.app.screen.width, this.app.screen.height, this.unit);
      this.stage3d.setShake(this.world.pivot.x, this.world.pivot.y);
    } else {
      this.grid.draw(this.app.screen.width / 2, this.app.screen.height / 2, this.unit);
    }
    this.edge.clear().rect(-hw * this.unit, -hh * this.unit, 2 * hw * this.unit, 2 * hh * this.unit).stroke({ color: 0x5a5a5a, width: 2, alpha: 0.6 });
    this.storm.clear();
    if (this.phase === 'battle') {
      drawStorm(this.storm, r.stormX * this.unit, r.stormY * this.unit, r.stormR * this.unit,
        this.unit, hw * this.unit, hh * this.unit, performance.now() / 1000, this.reducedMotion.matches);
    }

    this.drawDropMarkers();
    this.blind.clear();
    if (this.phase === 'battle' && secondsLeft(this.blindUntil) > 0)
      this.blind.rect(0, 0, this.app.screen.width, this.app.screen.height).fill(0xffffff);

    for (const [hex, v] of this.fighters) {
      const s = v.interp.sample();
      if (!s) continue;
      const live = (key: keyof FighterEffects) => {
        const effect = v.effects[key];
        return !!effect && secondsLeft(new Timestamp(BigInt(Math.round(effect.until * 1e6)))) > 0;
      };
      const scale = live('shrink') ? ABILITY_TUNING.shrinkScale : 1;
      const immunity = live('invisible');
      v.body3d?.setAppearance(scale, immunity, live('frozen'));
      for (const part of [v.char.body, v.char.head, v.char.ring]) {
        part.scale.set(v.body3d ? 1 : scale*this.unit/v.char.unit);
        part.filters = immunity ? [v.grayscale] : [];
        part.alpha = immunity ? 0.65 : 1;
      }
      if (!v.body3d) v.char.hand.x = v.char.unit * 0.4 * scale;
      // Hand is empty while the weapon is flying: the Boomerang ability OR a throw-archetype attack.
      const thrown = [...this.conn.db.abilityObject.iter()].some(o => o.roomCode === this.code && o.owner.toHexString() === hex && (JSON.parse(o.data) as AbilityObjectData).kind === 'boomerang')
        || [...this.projectiles.values()].some((p) => p.owner === hex && p.meta.k === 'throw');
      if (v.weapon) {
        v.weapon.visible = !thrown;
        // keep the weapon's own filters (raw-doodle outline + glow); add grayscale while invisible
        const base = baseFilters.get(v.weapon) ?? [];
        v.weapon.filters = immunity ? [...base, v.grayscale] : base;
        v.weapon.alpha = immunity ? 0.65 : 1;
      }
      // Scale the hand container (not the sprite, which attack animations own): Weapon boost, and
      // the current zoom vs. the zoom the sprite was built at — bigger arena → smaller weapon.
      const zoom = this.unit / (v.weaponUnit || this.unit);
      v.char.hand.scale.set((live('weapon_boost') ? ABILITY_TUNING.weaponScale : 1) * zoom);
      const moved = v.last ? Math.hypot(s.x - v.last.x, s.y - v.last.y) : 0;
      v.last = { x: s.x, y: s.y };
      const speed = Math.min(1, moved / Math.max(1e-3, dt * MOVE_SPEED));
      const feet = this.toScreen(s.x, s.y);
      v.char.view.position.set(feet.x, feet.y);
      // weapon points along the facing, as seen through the tilted camera
      v.char.aim = Math.atan2(Math.sin(s.facing) * (this.stage3d ? Stage3D.groundScaleY : 1), Math.cos(s.facing));
      if (v.body3d) {
        v.body3d.setTransform(s.x, s.y, s.facing);
        v.body3d.update(simDt, speed);
        const hand = v.body3d.handPosition();
        const hp = this.toScreen(hand.x, hand.y, hand.h), head = this.toScreen(s.x, s.y, v.body3d.headHeight);
        v.char.layout3D({ x: hp.x - feet.x, y: hp.y - feet.y }, { x: head.x - feet.x, y: head.y - feet.y });
      }
      v.char.animate(simDt, speed, v.stored.spec.motion.wobble);
      // upgrades follow the weapon sprite (after attack animations moved it this frame)
      if (v.decor && v.weapon) { v.decor.sync(v.weapon); v.decor.update(simDt); }
      v.char.view.zIndex = feet.y;
    }
    this.actors.sortableChildren = true;
    this.drawAbilities(dt);
    this.drawProjectiles(simDt);
    this.stage3d?.render();
    // TODO: attach vfx emitters per weapon (vfx/index.ts).
  }

  private drawAbilities(dt: number) {
    const now = serverNowMs() / 1000;
    const objects = this.phase === 'battle' ? [...this.conn.db.abilityObject.iter()].filter(o => o.roomCode === this.code) : [];
    const frame: VfxFrame = {
      now,
      objects: objects.map(o => ({ id:String(o.id),owner:o.owner.toHexString(),x:o.x,y:o.y,data:JSON.parse(o.data) })),
      fighters: this.phase === 'battle' ? [...this.conn.db.fighter.iter()].filter(f=>f.roomCode===this.code).map(f=>({ id:f.player.toHexString(),x:f.x,y:f.y,facing:f.facing,hp:f.hp,effects:JSON.parse(f.effects),attackAt:Number(f.lastAttackAt.microsSinceUnixEpoch)/1e6 })) : [],
      events: this.phase === 'battle' ? [...this.conn.db.fxEvent.iter()].filter(e=>e.roomCode===this.code).map(e=>({id:String(e.id),owner:e.owner.toHexString(),type:e.type,x:e.x,y:e.y,at:Number(e.createdAt.microsSinceUnixEpoch)/1e6,value:e.value})) : [],
    };
    const marks = this.vfxScene.build(frame);
    for(const o of frame.objects)if(o.data.kind==='boomerang'&&o.data.until>now)marks.push({kind:'weapon',owner:o.owner,x:o.x,y:o.y,h:.8,size:1,alpha:1,rotation:now*12});
    if(frame.objects.some(o=>o.data.kind==='bomb'&&now>=o.data.start&&now-o.data.start<.1))this.feedback.shake(2);
    this.vfx3d?.update(marks);
    this.vfx2d.update(this.vfx3d ? marks.filter(m=>m.kind==='text'||m.attachment) : marks, this.unit, (x,y,h)=>this.toScreen(x,y,h),
      owner => this.fighters.get(owner)?.weapon);
    const active = new Set<bigint>();
    for (const row of objects) {
      const d = JSON.parse(row.data) as AbilityObjectData;
      if(d.until<=now) continue;
      if(d.kind==='blind') this.blindUntil=new Timestamp(BigInt(Math.round(d.until*1e6)));
      if(d.kind!=='boomerang'||this.vfx3d) continue;
      active.add(row.id);
      let sprite=this.projectileSprites.get(row.id);
      const owner=this.fighters.get(row.owner.toHexString());
      if(!sprite&&owner?.weapon){
        sprite=new Sprite(owner.weapon.texture);sprite.anchor.set(.5);
        this.fx.addChild(sprite);this.projectileSprites.set(row.id,sprite);
      }
      if(sprite){const p=this.toScreen(row.x,row.y,.8);sprite.position.set(p.x,p.y);sprite.rotation+=dt*12;
        const zoom=this.unit/(owner?.weaponUnit||this.unit);sprite.width=(owner?.weapon?.width??this.unit)*zoom;sprite.height=(owner?.weapon?.height??this.unit)*zoom;}
    }
    for(const [id,sprite] of this.projectileSprites) if(!active.has(id)){sprite.destroy();this.projectileSprites.delete(id);}
  }

  dispose() {
    if(this.disposed)return;this.disposed=true;
    for(const cleanup of this.cleanups)cleanup();this.cleanups=[];
    this.vfxScene.reset();this.vfx2d.dispose();this.vfx3d?.dispose();
    this.clearFighters();for(const id of [...this.projectiles.keys()])this.removeProjectile(id);
    this.app.destroy(true,{children:true});this.stage3d?.dispose();
    for(const texture of this.textures.values())texture.destroy(true);this.textures.clear();
  }

  private drawDropMarkers() {
    this.markers.removeChildren();
    if (this.phase !== 'drop' && this.phase !== 'reveal') return;
    const r = this.conn.db.room.code.find(this.code);
    // Before battle the room has no arena size yet; preview with the size this many players will get.
    const count = [...this.conn.db.player.iter()].filter((p) => p.roomCode === this.code).length;
    const { hw, hh } = arenaExtents(r?.arenaR || GAME.arenaBaseRadius + GAME.arenaPerPlayer * count);
    for (const p of this.conn.db.player.iter()) {
      if (p.roomCode !== this.code || p.dropX < 0) continue;
      const g = new Graphics();
      const c = hexToNum(colorForSlot(p.colorSlot).hex);
      drawMarker(g, p.marker as Marker, (p.dropX * 2 - 1) * (hw - 1) * this.unit, (p.dropY * 2 - 1) * (hh - 1) * this.unit, this.unit * 0.4, c);
      this.markers.addChild(g);
    }
  }
}

/** FNV-1a over the bytes — cheap content key for doodle textures. */
function hashBytes(b: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619);
  return (h >>> 0).toString(36);
}
