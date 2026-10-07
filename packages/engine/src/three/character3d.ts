import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Archetype } from '@doodle/spec';
import type { MotionFeel } from '../motion';
import type { Tweener } from '../tween';
import { ATTACK_POSES, blendPose, type Pose, type RigBone } from './poses';

export const CHARACTER_URL = '/models/character/character.glb';
/** model is ~2 m tall; scale so it reads well next to the 1-unit hitbox */
const MODEL_SCALE = 0.85;

// Mixamo bone names lose the ':' through glTF → three ("mixamorig:RightHand" → "mixamorigRightHand").
const BONE_NAMES: Record<RigBone | 'hand', string> = {
  spine: 'mixamorigSpine2',
  arm: 'mixamorigRightArm',
  forearm: 'mixamorigRightForeArm',
  hand: 'mixamorigRightHand',
};

export interface CharacterAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

let assetPromise: Promise<CharacterAsset> | null = null;
/** Loaded once, cloned per player. Rejects if the file is missing → callers fall back to 2D. */
export function loadCharacterAsset(url = CHARACTER_URL): Promise<CharacterAsset> {
  return (assetPromise ??= new GLTFLoader().loadAsync(url).then((g) => ({ scene: g.scene, clips: g.animations })));
}

const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3();

/** One player's 3D body: tinted clone, Idle↔Run blend, procedural attack layered on top. */
export class Character3D {
  readonly root = new THREE.Group();
  private bodyMaterial: THREE.MeshStandardMaterial;
  private baseColor: number;
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private run?: THREE.AnimationAction;
  private bones: Partial<Record<RigBone | 'hand', THREE.Bone>> = {};
  private pose: Pose = {};
  private attackToken = 0;
  private runWeight = 0;
  private materials: THREE.Material[] = [];
  private ownedGeometry: THREE.BufferGeometry[] = [];

  constructor(asset: CharacterAsset, color: number) {
    this.baseColor = color;
    this.model = SkeletonUtils.clone(asset.scene);
    this.model.scale.setScalar(MODEL_SCALE);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0 });
    this.materials.push(mat);
    this.bodyMaterial = mat;
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = mat;
        o.frustumCulled = false; // skinned bounds are unreliable; there are only ≤12 of us
      }
    });
    for (const [key, name] of Object.entries(BONE_NAMES)) {
      const b = this.model.getObjectByName(name);
      if (b) this.bones[key as RigBone] = b as THREE.Bone;
    }

    // Ground ring in player color (the 2D overlay adds the marker shape next to the name tag).
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.materials.push(ring.material);
    this.ownedGeometry.push(ring.geometry);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.root.add(ring, this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n: string) => asset.clips.find((c) => c.name.toLowerCase() === n);
    const idle = clip('idle'), run = clip('run');
    if (idle) (this.idle = this.mixer.clipAction(idle)).play();
    if (run) { (this.run = this.mixer.clipAction(run)).play(); this.run.setEffectiveWeight(0); }
  }

  setAppearance(scale: number, invulnerable: boolean, frozen: boolean) {
    this.root.scale.setScalar(scale);
    this.bodyMaterial.color.setHex(invulnerable ? 0x888888 : frozen ? 0x88ddff : this.baseColor);
  }

  /** game coords → three: (x, 0, y). `facing` is the game angle (radians, +x = 0). */
  setTransform(x: number, y: number, facing: number) {
    this.root.position.set(x, 0, y);
    this.root.rotation.y = Math.atan2(Math.cos(facing), Math.sin(facing)); // model faces +Z
  }

  /** `speed` 0–1 (fraction of max move speed). Call once per frame with the (hit-stop aware) dt. */
  update(dt: number, speed: number) {
    const target = speed > 0.05 ? 1 : 0;
    this.runWeight += (target - this.runWeight) * Math.min(1, dt * 10);
    this.run?.setEffectiveWeight(this.runWeight);
    this.idle?.setEffectiveWeight(1 - this.runWeight);
    if (this.run) this.run.timeScale = 0.7 + 0.5 * speed;
    this.mixer.update(dt);
    this.applyPose();
  }

  /** Play the archetype's body motion with the same timings as the weapon sprite. */
  async attack(archetype: Archetype, feel: MotionFeel, tweener: Tweener, scale = 1) {
    const token = ++this.attackToken;
    const p = ATTACK_POSES[archetype];
    const live = () => token === this.attackToken; // a newer attack takes over
    const windUp = scalePose(p.windUp, scale), strike = scalePose(p.strike, scale);
    await tweener.to(feel.windUp, (t) => live() && blendPose({}, windUp, t, this.pose));
    await tweener.to(feel.strike, (t) => live() && blendPose(windUp, strike, t, this.pose), feel.strikeEase);
    await tweener.to(feel.recover, (t) => live() && blendPose(strike, {}, Math.min(1, t), this.pose), feel.recoverEase);
    if (live()) this.pose = {};
  }

  /** Freeze the attack timeline at t ∈ [0, 3] (0–1 wind-up, 1–2 strike, 2–3 recover). Dev only. */
  setPoseAt(archetype: Archetype, t: number) {
    const p = ATTACK_POSES[archetype];
    if (t <= 1) blendPose({}, p.windUp, t, this.pose);
    else if (t <= 2) blendPose(p.windUp, p.strike, t - 1, this.pose);
    else blendPose(p.strike, {}, Math.min(1, t - 2), this.pose);
  }

  /** Right-hand position in game coords {x, y, h} — where the 2D weapon sprite attaches. */
  handPosition(): { x: number; y: number; h: number } {
    const hand = this.bones.hand;
    if (!hand) return { x: this.root.position.x, y: this.root.position.z, h: 1 };
    this.root.updateMatrixWorld(true);
    hand.getWorldPosition(tmpV);
    return { x: tmpV.x, y: tmpV.z, h: tmpV.y };
  }

  /** 0–1. Fades body + ground ring together (death). 1 restores full opacity. */
  setOpacity(a: number) {
    for (const m of this.materials) {
      const base = m === this.materials[0] ? 1 : 0.9;
      m.transparent = a < 1 || base < 1;
      m.opacity = base * a;
      m.depthWrite = m === this.bodyMaterial && a >= 1;
    }
    this.root.visible = a > 0;
  }

  /** Top of the head (for name tag / HP bar), in game height units. */
  get headHeight() { return (2.0 * MODEL_SCALE + 0.15) * this.root.scale.y; }

  dispose() {
    this.attackToken++;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    const skeletons=new Set<THREE.Skeleton>();
    this.model.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((o as THREE.SkinnedMesh).skeleton);});
    for(const skeleton of skeletons)skeleton.dispose();
    this.root.removeFromParent();
    for(const material of this.materials)material.dispose();this.materials=[];
    for(const geometry of this.ownedGeometry)geometry.dispose();this.ownedGeometry=[];
    this.root.clear();
  }

  /** After the mixer wrote this frame's pose: rotate bones in *character* space by `this.pose`. */
  private applyPose() {
    const entries = Object.entries(this.pose) as [RigBone, Pose[RigBone]][];
    if (entries.length === 0) return;
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(tmpQ2).clone();
    for (const [name, axes] of entries) {
      const bone = this.bones[name];
      if (!bone?.parent || !axes) continue;
      // roll (raise sideways) → pitch (raise forward) → yaw (sweep), so a yaw still sweeps a raised arm
      for (const ax of ['z', 'x', 'y'] as const) {
        const angle = axes[ax];
        if (!angle) continue;
        // world-space rotation about the character's axis, converted into the bone's parent space
        const axisWorld = AXIS[ax].clone().applyQuaternion(rootQ);
        const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        tmpQ.setFromAxisAngle(axisWorld, angle);
        const local = parentQ.clone().invert().multiply(tmpQ).multiply(parentQ);
        bone.quaternion.premultiply(local);
        bone.updateMatrixWorld(true);
      }
    }
  }
}

function scalePose(p: Pose, s: number): Pose {
  if (s === 1) return p;
  return blendPose({}, p, s);
}
