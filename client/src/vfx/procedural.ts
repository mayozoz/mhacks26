/** Small shared animation atlas drawn from curves, never from the fire artwork. */
const frames = new Map<string, HTMLCanvasElement>();
export function proceduralImage(kind: 'flame' | 'blood' | 'spark', phase = 0) {
  const frame = kind === 'flame' ? ((Math.floor(phase * 8) % 48) + 48) % 48 : 0;
  const key = `${kind}:${frame}`;
  const cached = frames.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.lineJoin = 'round';
  if (kind === 'flame') {
    const t = frame / 48 * Math.PI * 2;
    // Each tongue bends independently; the base stays planted while tips curl and stretch.
    for (let i = 0; i < 3; i++) {
      const base = 42 + i * 22;
      const tip = base + Math.sin(t + i * 2.1) * 14;
      const top = 17 + i * 11 + Math.sin(t * 2 + i) * 9;
      g.beginPath();
      g.moveTo(base - 14, 111);
      g.bezierCurveTo(base - 29, 88, base + 9, 68, tip, top);
      g.bezierCurveTo(tip + 31, top + 25, base + 9, 78, base + 16, 91);
      g.bezierCurveTo(base + 29, 111, base + 1, 122, base - 14, 111);
      g.fillStyle = i === 1 ? '#ff9d28' : '#f46924';
      g.strokeStyle = '#713125';
      g.lineWidth = 3;
      g.fill(); g.stroke();
      g.beginPath();
      g.moveTo(base - 7, 108);
      g.bezierCurveTo(base - 11, 92, base + 5, 86, base + Math.sin(t + i) * 7, 65 + i * 8);
      g.bezierCurveTo(base + 20, 98, base + 14, 119, base - 7, 108);
      g.fillStyle = '#ffe18a'; g.fill();
    }
  } else if (kind === 'blood') {
    g.beginPath(); g.moveTo(64, 9);
    g.bezierCurveTo(58, 38, 28, 61, 29, 85);
    g.bezierCurveTo(30, 126, 99, 126, 99, 85);
    g.bezierCurveTo(99, 60, 70, 36, 64, 9);
    g.fillStyle = '#cc2443'; g.strokeStyle = '#69152d'; g.lineWidth = 6;
    g.fill(); g.stroke();
    g.beginPath(); g.ellipse(48, 83, 7, 14, 0.35, 0, Math.PI * 2);
    g.fillStyle = '#ff8990'; g.fill();
  } else {
    g.fillStyle = '#ffd481'; g.beginPath(); g.ellipse(64, 64, 22, 36, 0.3, 0, Math.PI * 2); g.fill();
  }
  frames.set(key, canvas);
  return canvas;
}
