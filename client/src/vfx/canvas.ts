import { assetImage, loadVfxAssets } from './assets';
import type { VfxMark } from './scene';
import { proceduralImage } from './procedural';

export function drawCanvasVfx(
  g: CanvasRenderingContext2D,
  marks: VfxMark[],
  unit: number,
  project: (x: number, y: number, h: number) => { x: number; y: number },
  floor = false,
) {
  void loadVfxAssets();
  for (const m of marks) {
    if (!!m.ground !== floor) continue;
    const p = project(m.x, m.y, m.h),
      size = m.size * unit;
    g.save();
    g.translate(p.x, p.y);
    g.globalAlpha = m.alpha;
    g.fillStyle = g.strokeStyle = `#${(m.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
    if (m.kind === 'sprite' || m.kind === 'flame' || m.kind === 'blood' || m.kind === 'spark') {
      const image = m.kind === 'sprite' ? m.asset && assetImage(m.asset) : proceduralImage(m.kind, m.phase);
      g.rotate(m.rotation ?? 0);
      g.scale(m.stretchX ?? 1, m.stretchY ?? 1);
      if (image)
        g.drawImage(
          image,
          -size / 2,
          (-size * image.height) / image.width / 2,
          size,
          (size * image.height) / image.width,
        );
    } else if (m.kind === 'shadow') {
      const color = g.fillStyle;
      const gradient = g.createRadialGradient(0, 0, 0, 0, 0, size / 2);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, `${color}00`);
      g.fillStyle = gradient;
      g.rotate(m.rotation ?? 0);
      g.scale(1, (m.floorDepth ?? m.size * 0.65) / m.size);
      g.beginPath();
      g.arc(0, 0, size / 2, 0, Math.PI * 2);
      g.fill();
    } else if (m.kind === 'ring') {
      g.lineWidth = Math.max(1, unit * 0.025);
      g.beginPath();
      g.arc(0, 0, size / 2, 0, Math.PI * 2);
      g.stroke();
    } else if (m.kind === 'line') {
      const end = project(m.x2!, m.y2!, m.h);
      g.lineCap = 'round';
      g.lineWidth = Math.max(2, size);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(end.x - p.x, end.y - p.y);
      g.stroke();
    } else if (m.kind === 'wall' || m.kind === 'crystal') {
      const image = assetImage(m.kind === 'wall' ? 'fence-section' : 'ice-shard');
      if (m.kind === 'wall') {
        g.rotate(m.rotation ?? 0);
        g.fillStyle = '#133449';
        g.strokeStyle = '#101827';
        g.lineWidth = 3;
        g.fillRect(-size / 2, -unit * 0.2, size, unit * 0.4);
        g.strokeRect(-size / 2, -unit * 0.2, size, unit * 0.4);
        if (image) g.drawImage(image, -size / 2, -unit * 0.8, size, unit * 0.9);
      } else if (image)
        g.drawImage(image, -size * 0.65, (-unit * (m.depth ?? 1)) / 2, size * 1.3, unit * (m.depth ?? 1));
    } else if (m.kind === 'ghost') {
      g.strokeStyle = g.fillStyle;
      g.lineWidth = unit * 0.12;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(0, -unit * 0.35, unit * 0.15, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(0, -unit * 0.15);
      g.lineTo(0, unit * 0.35);
      g.moveTo(-unit * 0.25, unit * 0.1);
      g.lineTo(unit * 0.25, unit * 0.1);
      g.moveTo(-unit * 0.2, unit * 0.65);
      g.lineTo(0, unit * 0.35);
      g.lineTo(unit * 0.2, unit * 0.65);
      g.stroke();
    } else if (m.kind === 'text') {
      g.font = `800 ${Math.max(12, size)}px system-ui`;
      g.textAlign = 'center';
      g.fillText(m.text!, 0, 0);
    }
    g.restore();
  }
}
