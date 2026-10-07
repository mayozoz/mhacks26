import { Container, Graphics, Sprite, Texture, Text } from 'pixi.js';
import { assetImage, loadVfxAssets, VFX_ASSETS, type VfxAsset } from './assets';
import { VFX_LIMIT, type VfxMark } from './scene';
import { proceduralImage } from './procedural';

let textures: Map<VfxAsset, Texture> | undefined;
/** Shared asset textures are retained across views; instance sprites are pooled and disposed. */
export class PixiAbilityVfx {
  readonly view = new Container();
  readonly floor = new Container();
  private ink = new Graphics();
  private floorInk = new Graphics();
  private sprites: Sprite[] = [];
  private labels: Text[] = [];
  private dead = false;
  constructor() {
    this.view.addChild(this.ink);
    this.floor.addChild(this.floorInk);
    void loadVfxAssets().then(() => {
      if (!textures) textures = new Map(VFX_ASSETS.map((name) => [name, Texture.from(assetImage(name)!)]));
    });
  }
  update(
    marks: VfxMark[],
    unit: number,
    project: (x: number, y: number, h: number) => { x: number; y: number },
    weapon?: (owner: string) => Sprite | null | undefined,
  ) {
    if (this.dead) return;
    this.ink.clear();
    this.floorInk.clear();
    let index = 0,
      labels = 0;
    for (const m of marks) {
      const ink = m.ground ? this.floorInk : this.ink;
      const p = project(m.x, m.y, m.h),
        size = m.size * unit;
      if (m.kind === 'sprite' || m.kind === 'wall' || m.kind === 'crystal' || m.kind === 'flame' || m.kind === 'blood' || m.kind === 'spark') {
        const asset = m.asset ?? (m.kind === 'wall' ? 'fence-section' : 'ice-shard');
        const tex = m.kind === 'flame' || m.kind === 'blood' || m.kind === 'spark'
          ? Texture.from(proceduralImage(m.kind, m.phase)) : textures?.get(asset);
        if (!tex || index >= VFX_LIMIT) continue;
        let s = this.sprites[index++];
        if (!s) {
          s = new Sprite(tex);
          s.anchor.set(0.5);
          this.sprites.push(s);
          this.view.addChild(s);
        }
        const layer = m.ground ? this.floor : this.view;
        if (s.parent !== layer) layer.addChild(s);
        s.texture = tex;
        s.visible = true;
        s.position.set(p.x, p.y);
        if (m.attachment && weapon) {
          const held = weapon(m.owner!);
          if (!held?.visible) { s.visible = false; continue; }
          const center = held.toGlobal({ x: held.texture.width * (0.6 - held.anchor.x), y: held.texture.height * (0.5 - held.anchor.y) });
          s.position.copyFrom(layer.toLocal(center));
        }
        s.width = size * (m.stretchX ?? 1);
        s.height = (size * tex.height) / tex.width * (m.stretchY ?? 1);
        s.alpha = m.alpha;
        s.rotation = m.rotation ?? 0;
        if (m.kind === 'crystal') s.height = (m.depth ?? 1) * unit;
      } else if (m.kind === 'text') {
        let label = this.labels[labels++];
        if (!label) {
          label = new Text({ text: '', style: { fontSize: 18, fill: 0xff7863, fontWeight: 'bold' } });
          label.anchor.set(0.5);
          this.labels.push(label);
          this.view.addChild(label);
        }
        label.text = m.text!;
        label.position.set(p.x, p.y);
        label.alpha = m.alpha;
        label.visible = true;
      } else if (m.kind === 'shadow') {
        const depth = (m.floorDepth ?? m.size * 0.65) * unit;
        for (let i = 3; i >= 1; i--)
          ink
            .ellipse(p.x, p.y, ((size / 2) * i) / 3, (depth * 0.4 * i) / 3)
            .fill({ color: m.color, alpha: m.alpha * 0.18 });
      } else if (m.kind === 'ring') {
        const edge = project(m.x, m.y + m.size / 2, m.h);
        ink
          .ellipse(p.x, p.y, size / 2, Math.abs(edge.y - p.y))
          .stroke({ color: m.color, width: Math.max(1, unit * 0.025), alpha: m.alpha });
      } else if (m.kind === 'line') {
        const q = project(m.x2!, m.y2!, m.h);
        ink
          .moveTo(p.x, p.y)
          .lineTo(q.x, q.y)
          .stroke({ color: m.color, width: Math.max(2, size), alpha: m.alpha });
      } else if (m.kind === 'ghost') {
        ink.circle(p.x, p.y - unit * 0.35, unit * 0.15).fill({ color: m.color, alpha: m.alpha });
        const stroke = { color: m.color, width: unit * 0.12, alpha: m.alpha };
        ink
          .moveTo(p.x, p.y - unit * 0.15)
          .lineTo(p.x, p.y + unit * 0.35)
          .stroke(stroke)
          .moveTo(p.x - unit * 0.25, p.y + unit * 0.1)
          .lineTo(p.x + unit * 0.25, p.y + unit * 0.1)
          .stroke(stroke)
          .moveTo(p.x - unit * 0.2, p.y + unit * 0.65)
          .lineTo(p.x, p.y + unit * 0.35)
          .lineTo(p.x + unit * 0.2, p.y + unit * 0.65)
          .stroke(stroke);
      }
    }
    for (let i = index; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
    for (let i = labels; i < this.labels.length; i++) this.labels[i]!.visible = false;
  }
  reset() {
    this.ink.clear();
    this.floorInk.clear();
    for (const s of this.sprites) s.visible = false;
    for (const l of this.labels) l.visible = false;
  }
  dispose() {
    this.dead = true;
    this.floor.destroy({ children: true });
    this.view.destroy({ children: true });
    this.sprites = [];
    this.labels = [];
  }
}
