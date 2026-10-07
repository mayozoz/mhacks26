import * as THREE from 'three';
import { Character3D, type CharacterAsset } from '@doodle/engine';
import { assetImage, loadVfxAssets, VFX_ASSETS, type VfxAsset } from './assets';
import { VFX_LIMIT, type VfxMark } from './scene';
import { proceduralImage } from './procedural';
const proceduralTextures = new Map<HTMLCanvasElement, THREE.Texture>();

let textures: Map<VfxAsset, THREE.Texture> | undefined;
const box = new THREE.BoxGeometry(1, 1, 1),
  crystal = new THREE.ConeGeometry(0.5, 1, 5);
const ring = new THREE.RingGeometry(0.48, 0.5, 48),
  plane = new THREE.PlaneGeometry(1, 1);
let shadowTexture: THREE.CanvasTexture | undefined;
function softShadow() {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'white');
  gradient.addColorStop(1, '#ffffff00');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return (shadowTexture = new THREE.CanvasTexture(c));
}
type Slot = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial | THREE.MeshToonMaterial;
  outline?: THREE.Mesh;
};
/** Real scene geometry and depth-tested billboards: effects can pass behind 3D bodies. */
export class ThreeAbilityVfx {
  private root = new THREE.Group();
  private pools = new Map<string, Slot[]>();
  private dead = false;
  private allocated = 0;
  private axis = new THREE.Vector3(0, 0, 1);
  private ghosts: Character3D[] = [];
  private weapons = new Map<string, { texture: THREE.Texture; width: number; height: number }>();
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private asset?: CharacterAsset | null,
  ) {
    scene.add(this.root);
    void loadVfxAssets().then(() => {
      if (!textures)
        textures = new Map(
          VFX_ASSETS.map((name) => {
            const t = new THREE.CanvasTexture(assetImage(name)!);
            t.colorSpace = THREE.SRGBColorSpace;
            return [name, t];
          }),
        );
    });
  }
  setWeapon(owner: string, source: TexImageSource, width: number, height: number) {
    this.removeWeapon(owner);
    const texture = new THREE.Texture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.weapons.set(owner, { texture, width, height });
  }
  removeWeapon(owner: string) {
    this.weapons.get(owner)?.texture.dispose();
    this.weapons.delete(owner);
  }
  update(marks: VfxMark[]) {
    if (this.dead) return;
    for (const pool of this.pools.values()) for (const s of pool) s.mesh.visible = false;
    for (const ghost of this.ghosts) ghost.setOpacity(0);
    const counts = new Map<string, number>();
    let total = 0,
      ghostIndex = 0;
    for (const m of marks) {
      if (m.kind === 'text' || m.attachment || total++ >= VFX_LIMIT) continue;
      if (m.kind === 'ghost') {
        if (this.asset && ghostIndex < 48) {
          let ghost = this.ghosts[ghostIndex++];
          if (!ghost) {
            ghost = new Character3D(this.asset, 0xb8dfff);
            this.ghosts.push(ghost);
            this.root.add(ghost.root);
          }
          ghost.setTransform(m.x, m.y, m.rotation ?? 0);
          ghost.setAppearance(1, true, false);
          ghost.setOpacity(m.alpha);
        }
        continue;
      }
      const kind = m.kind,
        solid = kind === 'wall' || kind === 'crystal';
      const key = kind;
      const i = counts.get(key) ?? 0;
      counts.set(key, i + 1);
      let pool = this.pools.get(key);
      if (!pool) {
        pool = [];
        this.pools.set(key, pool);
      }
      let slot = pool[i];
      if (!slot) {
        if (this.allocated >= VFX_LIMIT) {
          // Reclaim a cold slot of another kind instead of starving later abilities after nukes.
          for (const [other, slots] of this.pools) {
            if (other === key || slots.length <= (counts.get(other) ?? 0)) continue;
            const old = slots.pop()!;
            this.root.remove(old.mesh);
            old.material.dispose();
            if (old.outline) (old.outline.material as THREE.Material).dispose();
            this.allocated--;
            break;
          }
        }
        if (this.allocated >= VFX_LIMIT) continue;
        this.allocated++;
        const material = solid
          ? new THREE.MeshToonMaterial({ color: m.color, transparent: true, depthWrite: true })
          : new THREE.MeshBasicMaterial({
              transparent: true,
              depthWrite: false,
              depthTest: true,
              side: THREE.DoubleSide,
            });
        const geometry = solid ? (kind === 'wall' ? box : crystal) : kind === 'ring' ? ring : plane;
        const mesh = new THREE.Mesh(geometry, material);
        this.root.add(mesh);
        slot = { mesh, material };
        pool.push(slot);
        if (solid) {
          const outline = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: 0x142034,
              transparent: true,
              side: THREE.BackSide,
              depthWrite: false,
            }),
          );
          outline.scale.setScalar(1.055);
          mesh.add(outline);
          slot.outline = outline;
        }
      }
      const { mesh, material } = slot;
      mesh.visible = true;
      mesh.position.set(m.x, m.h, m.y);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      material.opacity = m.alpha;
      material.color.setHex(m.color ?? 0xffffff);
      if (solid) material.depthWrite = m.alpha >= 0.99;
      if (slot.outline) (slot.outline.material as THREE.MeshBasicMaterial).opacity = m.alpha;
      if (kind === 'wall') {
        mesh.scale.set(m.size, m.h * 2, m.depth ?? 0.18);
        mesh.rotation.y = -(m.rotation ?? 0);
      } else if (kind === 'crystal') {
        mesh.scale.set(m.size, m.depth ?? 1, m.size);
        mesh.rotation.y = m.rotation ?? 0;
      } else if (kind === 'weapon') {
        const weapon = this.weapons.get(m.owner!);
        if (!weapon) {
          mesh.visible = false;
          continue;
        }
        if (material.map !== weapon.texture) {
          material.map = weapon.texture;
          material.needsUpdate = true;
        }
        mesh.scale.set(weapon.width, weapon.height, 1);
        mesh.quaternion.copy(this.camera.quaternion);
        mesh.rotateOnAxis(this.axis, -(m.rotation ?? 0));
      } else if (kind === 'sprite' || kind === 'flame' || kind === 'blood' || kind === 'spark') {
        const image = kind === 'sprite' ? assetImage(m.asset!) : proceduralImage(kind, m.phase);
        let texture = kind === 'sprite' ? textures?.get(m.asset!) : image && proceduralTextures.get(image);
        if (!texture && image && kind !== 'sprite') {
          texture = new THREE.CanvasTexture(image);
          texture.colorSpace = THREE.SRGBColorSpace;
          proceduralTextures.set(image, texture);
        }
        if (!texture) {
          mesh.visible = false;
          continue;
        }
        if (material.map !== texture) {
          material.map = texture;
          material.needsUpdate = true;
        }
        mesh.scale.set(m.size * (m.stretchX ?? 1), (m.size * image!.height) / image!.width * (m.stretchY ?? 1), 1);
        if (m.ground) {
          mesh.rotation.x = -Math.PI / 2;
          mesh.rotation.z = m.rotation ?? 0;
        } else {
          mesh.quaternion.copy(this.camera.quaternion);
          mesh.rotateOnAxis(this.axis, -(m.rotation ?? 0));
        }
      } else if (kind === 'shadow') {
        if (material.map !== softShadow()) {
          material.map = softShadow();
          material.needsUpdate = true;
        }
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = -(m.rotation ?? 0);
        mesh.scale.set(m.size, m.floorDepth ?? m.size, 1);
      } else if (kind === 'ring') {
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.setScalar(m.size);
      } else if (kind === 'line') {
        // Thin floor-parallel ribbon; independent of camera rotation and actual physics.
        const dx = m.x2! - m.x,
          dy = m.y2! - m.y;
        mesh.position.set((m.x + m.x2!) / 2, m.h, (m.y + m.y2!) / 2);
        mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(dy, dx));
        mesh.scale.set(Math.hypot(dx, dy), m.size, 1);
      }
    }
  }
  reset() {
    for (const pool of this.pools.values()) for (const s of pool) s.mesh.visible = false;
    for (const ghost of this.ghosts) ghost.setOpacity(0);
  }
  dispose() {
    this.dead = true;
    this.scene.remove(this.root);
    for (const ghost of this.ghosts) ghost.dispose();
    this.ghosts = [];
    for (const weapon of this.weapons.values()) weapon.texture.dispose();
    this.weapons.clear();
    for (const pool of this.pools.values())
      for (const s of pool) {
        s.material.dispose();
        if (s.outline) (s.outline.material as THREE.Material).dispose();
      }
    this.root.clear();
    this.pools.clear();
  }
}
