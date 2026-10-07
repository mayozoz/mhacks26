import { Graphics } from 'pixi.js';

/** All effects sit outside the exact server-owned safe circle. No gameplay geometry changes. */
export function drawStorm(g: Graphics, x: number, y: number, radius: number, unit: number, halfW: number, halfH: number, time: number, reduced: boolean) {
  g.clear();
  const r = Math.max(0, radius), t = reduced ? 0 : time;
  // Dark outer atmosphere with a soft, layered inner rim.
  g.rect(-halfW - 300, -halfH - 300, halfW * 2 + 600, halfH * 2 + 600)
    .fill({ color: 0x061e32, alpha: .48 }).circle(x, y, r).cut();
  for (let i = 5; i >= 1; i--) {
    const width = i * 5;
    g.circle(x, y, r + width / 2).stroke({ color: 0x34d8e8, width, alpha: .035 });
  }
  g.circle(x, y, r).stroke({ color: 0x91fff0, width: 2, alpha: .85 });
  // Broken bands orbit the boundary rather than flashing over the combatants.
  for (let i = 0; i < 14; i++) {
    const angle = i / 14 * Math.PI * 2 + t * .09;
    const rr = r + 7 + 3 * Math.sin(t * 1.4 + i);
    g.moveTo(x + Math.cos(angle) * rr, y + Math.sin(angle) * rr)
      .arc(x, y, rr, angle, angle + .12).stroke({ color: i % 4 ? 0x49cfe8 : 0xe8ffe2, width: 3, alpha: .6 });
  }
  // Wide translucent wind trails spiral through the dangerous side of the wall.
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.39996 - t * (.055 + i % 3 * .02);
    const rr = r + 22 + (i % 5) * unit * .55;
    g.moveTo(x + Math.cos(angle) * rr, y + Math.sin(angle) * rr)
      .arc(x, y, rr, angle, angle + .18 + i % 3 * .08)
      .stroke({ color: i % 2 ? 0x3997bc : 0x79dbd7, width: 7 + i % 4 * 4, alpha: .065 });
  }
  // Short electrical forks travel around the rim with a soft rise and fade.
  // No full-screen flashes; reduced-motion mode keeps a quiet, static boundary.
  if (!reduced) for (let i = 0; i < 6; i++) {
    const cycle = (t * .4 + i / 6) % 1;
    const strength = Math.sin(Math.PI * Math.min(1, cycle / .45));
    if (cycle > .45 || strength < .03) continue;
    const angle = i * 2.39996 + Math.floor(t * .4 + i / 6) * .63;
    const points: { x: number; y: number }[] = [];
    for (let j = 0; j < 7; j++) {
      const a = angle + j * .022;
      const rr = r + 8 + j * unit * .19 + (j % 2) * 9;
      points.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    for (const [width, alpha] of [[8, .07], [2, .5]]) {
      g.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) g.lineTo(point.x, point.y);
      g.stroke({ color: 0xc0fff5, width: width!, alpha: alpha! * strength });
    }
    const fork = points[3]!;
    g.moveTo(fork.x, fork.y).lineTo(fork.x + Math.cos(angle + .5) * unit * .35, fork.y + Math.sin(angle + .5) * unit * .35)
      .stroke({ color: 0xa1e9ff, width: 1.5, alpha: strength * .4 });
  }
  // Bounded particle count; deterministic movement avoids allocating sprites every frame.
  for (let i = 0; i < 72; i++) {
    const angle = i * 2.39996 + t * (.035 + (i % 3) * .015);
    const drift = reduced ? .5 : (i * .137 + t * .10) % 1;
    const rr = r + 12 + drift * unit * 3;
    const px = x + Math.cos(angle) * rr, py = y + Math.sin(angle) * rr;
    if (Math.abs(px) > halfW + 60 || Math.abs(py) > halfH + 60) continue;
    const alpha = .1 + Math.sin(drift * Math.PI) * .4;
    g.moveTo(px, py).lineTo(px + Math.cos(angle + 1.2) * (5 + i % 8), py + Math.sin(angle + 1.2) * (5 + i % 8))
      .stroke({ color: i % 7 ? 0x71e4e5 : 0xffd58a, width: i % 3 ? 1.5 : 2.5, alpha });
  }
}
