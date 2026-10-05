import './draw.css';
import { extractFeatures, type Drawing, type Stroke } from '@doodle/spec';
import { mountCountdown } from '../../ui/countdown';
import { countdownTicks } from '../../audio/countdown-sounds';
import { debug } from '../../debug';
import type { View } from './types';
import { eraseAt } from './erase';
import { preloadAbilityIcons } from '../../ui/ability-icons';

const COLORS = [
  ['Black', '#111111'], ['Gray', '#64748b'], ['Red', '#ff3b3b'],
  ['Orange', '#f97316'], ['Yellow', '#facc15'], ['Green', '#22c55e'],
  ['Teal', '#14b8a6'], ['Blue', '#2f6bff'], ['Purple', '#8b5cf6'],
  ['Pink', '#ec4899'], ['Brown', '#92400e'], ['Cream', '#fde4b2'],
] as const;
const SIZE = 512; // canvas resolution sent to the server
/** Kick off the hidden AI weapon design (gen_spec → gen_sfx) after submit. The server only
 *  calls a provider when its private SPEC_PROVIDER secret is asi1 or agent. */
export const RUN_GENERATION = true;
/** Sound generation can run independently of spec and sprite generation. */
export const RUN_SFX_GENERATION = true;
/** Doodle → polished 2D art, independent of gameplay spec generation. */
export const RUN_SPRITE_GENERATION = true;

/** Doodle canvas with touch-friendly colors, eraser and undo. Submits when the phase ends. */
export const drawView: View = (ctx) => {
  preloadAbilityIcons();
  ctx.el.innerHTML = `
    <div class="drawing-page">
      <div id="cd"></div>
      <canvas id="c" width="${SIZE}" height="${SIZE}" aria-label="Draw your weapon"></canvas>
      <div class="drawing-palette" role="group" aria-label="Drawing colors">
        ${COLORS.map(([name, c], i) => `<button class="drawing-color" data-c="${c}" aria-label="${name} drawing color" aria-pressed="${i === 0}" style="background:${c}"></button>`).join('')}
      </div>
      <div class="drawing-tools">
        <button id="eraser" aria-pressed="false">Eraser</button>
        <button id="undo" aria-label="Undo last drawing action" disabled><span aria-hidden="true">↶</span> Undo</button>
      </div>
    </div>`;
  const room = () => ctx.conn.db.room.code.find(ctx.roomCode);
  const stopCd = mountCountdown(ctx.el.querySelector('#cd')!, () => room()?.phaseEndsAt);
  // phones tick only here: during Draw players are looking down at them
  const stopTicks = countdownTicks(() => room()?.phaseEndsAt, 5);
  const canvas = ctx.el.querySelector<HTMLCanvasElement>('#c')!;
  const g = canvas.getContext('2d')!;
  const drawing: Drawing = { width: SIZE, height: SIZE, strokes: [] };
  let color: string = COLORS[0][1];
  let erasing = false;
  let pointer: number | null = null;
  let last: [number, number] | null = null;
  const history: Stroke[][] = [];
  const undo = ctx.el.querySelector<HTMLButtonElement>('#undo')!;
  const eraser = ctx.el.querySelector<HTMLButtonElement>('#eraser')!;
  let cur: Stroke | null = null;
  let t0 = 0;

  const redraw = () => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, SIZE, SIZE);
    g.lineCap = g.lineJoin = 'round';
    for (const s of drawing.strokes) {
      g.strokeStyle = s.color;
      g.lineWidth = s.width;
      if (s.points.length === 1) {
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(s.points[0]![0], s.points[0]![1], s.width / 2, 0, Math.PI * 2);
        g.fill();
        continue;
      }
      g.beginPath();
      s.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  };
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const scaleX = r.width / canvas.offsetWidth, scaleY = r.height / canvas.offsetHeight;
    return [
      Math.max(0, Math.min(SIZE, (e.clientX - r.left - canvas.clientLeft * scaleX) / (canvas.clientWidth * scaleX) * SIZE)),
      Math.max(0, Math.min(SIZE, (e.clientY - r.top - canvas.clientTop * scaleY) / (canvas.clientHeight * scaleY) * SIZE)),
    ];
  };
  const eraseTo = (point: [number, number]) => {
    const from = last ?? point;
    const steps = Math.max(1, Math.ceil(Math.hypot(point[0] - from[0], point[1] - from[1]) / 7));
    for (let i = 0; i <= steps; i++) {
      drawing.strokes = eraseAt(drawing.strokes,
        from[0] + (point[0] - from[0]) * i / steps,
        from[1] + (point[1] - from[1]) * i / steps, 14);
    }
    last = point;
  };
  canvas.onpointerdown = (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    history.push(structuredClone(drawing.strokes));
    undo.disabled = false;
    t0 = performance.now();
    last = null;
    if (erasing) eraseTo(pos(e));
    else {
      cur = { color, width: 10, points: [[...pos(e), 0]] };
      drawing.strokes.push(cur);
    }
    redraw();
  };
  canvas.onpointermove = (e) => {
    if (pointer !== e.pointerId) return;
    if (erasing) eraseTo(pos(e));
    else cur?.points.push([...pos(e), performance.now() - t0]);
    redraw();
  };
  const finish = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    pointer = null;
    cur = null;
    last = null;
  };
  canvas.onpointerup = finish;
  canvas.onpointercancel = finish;
  canvas.onlostpointercapture = finish;
  const colorButtons = ctx.el.querySelectorAll<HTMLButtonElement>('[data-c]');
  colorButtons.forEach((button) => {
    button.onclick = () => {
      color = button.dataset.c!;
      erasing = false;
      eraser.setAttribute('aria-pressed', 'false');
      colorButtons.forEach((swatch) => swatch.setAttribute('aria-pressed', String(swatch === button)));
    };
  });
  eraser.onclick = () => {
    erasing = !erasing;
    eraser.setAttribute('aria-pressed', String(erasing));
    colorButtons.forEach(button => button.setAttribute('aria-pressed', String(!erasing && button.dataset.c === color)));
  };
  undo.onclick = () => {
    const previous = history.pop();
    if (previous) drawing.strokes = previous;
    cur = null;
    pointer = null;
    undo.disabled = history.length === 0;
    redraw();
  };
  redraw();

  let submitted = false;
  const submit = async () => {
    if (submitted) return;
    submitted = true;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    const png = new Uint8Array(await (blob ?? new Blob()).arrayBuffer());
    await debug.track('submit_drawing', ctx.conn.reducers.submitDrawing({
      strokes: JSON.stringify(drawing),
      png,
      features: JSON.stringify(extractFeatures(drawing)),
    }));
    if (RUN_SPRITE_GENERATION && drawing.strokes.length) {
      void debug.track('gen_sprite', ctx.conn.procedures.genSprite({})).catch(() => {});
    }
    if (RUN_GENERATION) {
      // Fire-and-forget. Results land in the weapon row; nothing is shown to players
      // (only the ?debug overlay lists them while they run).
      // Let sound generation use the finished spec's custom prompt when available.
      void debug.track('gen_spec', ctx.conn.procedures.genSpec({})).catch(() => {}).then(() => {
        if (RUN_SFX_GENERATION) void debug.track('gen_sfx', ctx.conn.procedures.genSfx({})).catch(() => {});
      });
    } else if (RUN_SFX_GENERATION) {
      void debug.track('gen_sfx', ctx.conn.procedures.genSfx({})).catch(() => {});
    }
  };

  // Phase changing away from draw unmounts this view → submit on the way out.
  return () => { stopCd(); stopTicks(); void submit(); };
};
