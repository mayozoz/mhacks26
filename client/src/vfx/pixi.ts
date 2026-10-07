import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { assetImage, loadVfxAssets, VFX_ASSETS, type VfxAsset } from './assets';
import { VFX_LIMIT, type VfxMark } from './scene';
import { proceduralImage } from './procedural';

let textures: Map<VfxAsset, Texture> | undefined;
/** Bounded, reusable overlays in the main arena's existing Pixi effect layers. */
export class PixiAbilityVfx {
  readonly view = new Container();
  readonly floor = new Container();
  private floorInk = new Graphics();
  private sprites: Sprite[] = [];
  constructor() {
    this.floor.addChild(this.floorInk);
    void loadVfxAssets().then(() => {
      if (!textures) textures = new Map(VFX_ASSETS.map(name => [name, Texture.from(assetImage(name)!)]));
    });
  }
  update(marks: VfxMark[], unit: number,
    project: (x: number, y: number, h: number) => { x: number; y: number },
    weapon: (owner: string) => Sprite | null | undefined) {
    this.floorInk.clear();
    let index = 0;
    for (const m of marks) {
      const p = project(m.x, m.y, m.h), size = m.size * unit;
      if (m.kind === 'shadow') {
        for (let i = 3; i >= 1; i--) this.floorInk
          .ellipse(p.x, p.y, size / 2 * i / 3, size * 0.65 * 0.4 * i / 3)
          .fill({ color: m.color, alpha: m.alpha * 0.18 });
      } else if (m.kind === 'ring') {
        const edge = project(m.x, m.y + m.size / 2, m.h);
        this.floorInk.ellipse(p.x, p.y, size / 2, Math.abs(edge.y - p.y))
          .stroke({ color: m.color, width: Math.max(1, unit * 0.025), alpha: m.alpha });
      } else {
        const tex = m.kind === 'sprite' ? textures?.get(m.asset!) : Texture.from(proceduralImage(m.kind, m.phase));
        if (!tex || index >= VFX_LIMIT) continue;
        let s = this.sprites[index++];
        if (!s) { s = new Sprite(tex); s.anchor.set(0.5); this.sprites.push(s); this.view.addChild(s); }
        s.texture = tex; s.visible = true; s.position.set(p.x, p.y);
        if (m.attachment) {
          const held = weapon(m.owner!);
          if (!held?.visible) { s.visible = false; continue; }
          const center = held.toGlobal({ x: held.texture.width * (0.6 - held.anchor.x), y: held.texture.height * (0.5 - held.anchor.y) });
          s.position.copyFrom(this.view.toLocal(center));
        }
        s.width = size * (m.stretchX ?? 1);
        s.height = size * tex.height / tex.width * (m.stretchY ?? 1);
        s.alpha = m.alpha; s.rotation = m.rotation ?? 0;
      }
    }
    for (let i = index; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }
}
