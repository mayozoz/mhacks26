import bounds from './asset-bounds.json';

export type VfxAsset = keyof typeof bounds;
export const VFX_ASSETS = Object.keys(bounds) as VfxAsset[];
const images = new Map<VfxAsset, HTMLCanvasElement>();
let loading: Promise<void> | undefined;
export const assetImage = (name: VfxAsset) => images.get(name);

/** Crop transparent padding at load time, without modifying the supplied artwork. */
export function loadVfxAssets() {
  return (loading ??= Promise.all(
    VFX_ASSETS.map(async (name) => {
      const image = new Image();
      image.src = `/vfx/${name}.png`;
      const canvas = document.createElement('canvas');
      try {
        await image.decode();
        const [, , x, y, w, h] = bounds[name];
        canvas.width = w!;
        canvas.height = h!;
        canvas.getContext('2d')!.drawImage(image, x!, y!, w!, h!, 0, 0, w!, h!);
      } catch {
        console.warn(`[vfx] Missing ${name}; using procedural fallback`);
        canvas.width = canvas.height = 64;
        const g = canvas.getContext('2d')!;
        g.fillStyle = name.includes('poison') ? '#a3e635' : name.includes('ice') ? '#7dd3fc' : '#ffd580';
        g.strokeStyle = '#151827';
        g.lineWidth = 5;
        g.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6,
            r = i % 2 ? 14 : 28;
          g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
      images.set(name, canvas);
    }),
  ).then(() => {}));
}
