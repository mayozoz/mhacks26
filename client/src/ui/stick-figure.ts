export interface StickFigurePose {
  x: number; y: number; color: string; facing: number; scale: number;
  stride: number; attacking: boolean; hurt: number; frozen: boolean; weaponScale: number; empowered: boolean;
  hideWeapon?: boolean;
  grayscale?: boolean;
}

/** Readable arena character: head, body, arms, walking legs, weapon and hit reaction. */
export function drawStickFigure(g: CanvasRenderingContext2D, p: StickFigurePose) {
  g.save();
  if(p.grayscale)g.filter='grayscale(1)';
  g.translate(p.x + Math.sin(p.hurt * 35) * p.hurt * 7, p.y);
  g.scale(p.scale * (Math.cos(p.facing) < 0 ? -1 : 1), p.scale);
  g.rotate(p.hurt * -.2);
  const ink = p.hurt > .1 ? '#ff5b75' : p.color;
  const leg = p.frozen ? 0 : Math.sin(p.stride) * 9;
  const arm = p.attacking ? -16 : -3;
  const segments = [
    [0, -11, 0, 12], [0, -5, -13, 6], [0, -5, 14, arm],
    [0, 12, -10 - leg, 28], [0, 12, 10 + leg, 28],
  ];
  g.lineCap = g.lineJoin = 'round';
  for (const [width, color] of [[9, '#11101b'], [5, ink]] as const) {
    g.strokeStyle = color; g.lineWidth = width;
    for (const [x1,y1,x2,y2] of segments) { g.beginPath(); g.moveTo(x1!,y1!); g.lineTo(x2!,y2!); g.stroke(); }
  }
  g.beginPath(); g.arc(0, -22, 10, 0, Math.PI * 2); g.fillStyle = '#fffaf2'; g.fill(); g.strokeStyle = ink; g.lineWidth = 4; g.stroke();
  g.strokeStyle = '#11101b'; g.lineWidth = 2;
  if (p.hurt > .1) {
    for (const x of [-2, 4]) { g.beginPath(); g.moveTo(x-2, -26); g.lineTo(x+2,-22); g.moveTo(x+2,-26); g.lineTo(x-2,-22); g.stroke(); }
    g.beginPath(); g.arc(2, -18, 3, Math.PI, 0); g.stroke();
  } else {
    g.fillStyle = '#11101b'; g.beginPath(); g.arc(0,-24,1.6,0,Math.PI*2); g.arc(6,-24,1.6,0,Math.PI*2); g.fill();
    g.beginPath(); g.arc(3,-21,3,0,Math.PI); g.stroke();
  }
  if (!p.hideWeapon) {
  const angle = p.attacking ? -.9 + Math.sin(p.stride * 2) * .65 : -.45;
  g.save(); g.translate(14, arm); g.rotate(angle);
  g.fillStyle = p.empowered ? '#fbbf24' : '#fff'; g.strokeStyle = '#11101b'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(1,-3); g.lineTo(26*p.weaponScale,-3); g.lineTo(34*p.weaponScale,0); g.lineTo(26*p.weaponScale,3); g.lineTo(1,3); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(0,-7); g.lineTo(0,7); g.strokeStyle = '#c4b5fd'; g.lineWidth = 4; g.stroke(); g.restore();
  }
  if (p.frozen) {
    g.fillStyle = '#7dd3fc30'; g.strokeStyle = '#7dd3fc'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-19,-36); g.lineTo(18,-32); g.lineTo(23,30); g.lineTo(-20,30); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#e0f2fe'; g.lineWidth = 2; g.beginPath(); g.moveTo(-19,-36); g.lineTo(8,-7); g.lineTo(-7,10); g.lineTo(23,30); g.stroke();
  }
  g.restore();
}
