import { ABILITIES, ABILITY_TUNING, isAbilityId, type AbilityId, type StoredWeapon } from '@doodle/spec';
import { mountCountdown } from '../../ui/countdown';
import { loadDoodle, weaponStage, type WeaponStage } from '../../ui/weapon-stage';
import { ABILITY_GUIDE } from './ability-guide';
import { weaponGuide } from './weapon-guide';
import type { View } from './types';
import './drop.css';
import { abilityIcon, ABILITY_ACCENTS } from '../../ui/ability-icons';
import { resumeAudio } from '../../audio/sfx';

const IDS = Object.keys(ABILITIES) as AbilityId[];
const STEPS = ['Roll', 'Special', 'Weapon', 'Deploy'];

export const dropView: View = (ctx) => {
  const room = () => ctx.conn.db.room.code.find(ctx.roomCode);
  const player = () => ctx.conn.db.player.identity.find(ctx.identity);
  const ability = (): AbilityId => {
    const id = player()?.abilityId;
    return id && isAbilityId(id) ? id : 'flash';
  };
  const key = `doodle.preparation:${ctx.roomCode}:${ctx.identity.toHexString()}:${room()?.phaseStartedAt.microsSinceUnixEpoch}`;
  let step = 0;
  try { step = Math.max(0, Math.min(3, Number(sessionStorage.getItem(key)) || 0)); } catch { /* private mode */ }
  let active = true, version = 0;
  let stage: WeaponStage | null = null;
  const timers: number[] = [];
  ctx.el.innerHTML = `<div class="prep-page"><header class="prep-header"><span>GET READY</span><div id="cd"></div></header><nav class="prep-steps" aria-label="Preparation steps"></nav><main class="prep-body"></main></div>`;
  const body = ctx.el.querySelector<HTMLElement>('.prep-body')!;
  const nav = ctx.el.querySelector<HTMLElement>('.prep-steps')!;
  const stopCd = mountCountdown(ctx.el.querySelector('#cd')!, () => room()?.phaseEndsAt);
  const moveTo = (next: number) => {
    if (!active) return;
    step = next;
    try { sessionStorage.setItem(key, String(step)); } catch { /* private mode */ }
    render();
  };
  const render = () => {
    const current = ++version;
    ctx.audio?.setWeaponDisplay(step === 2);
    stage?.destroy(); stage = null;
    nav.innerHTML = STEPS.map((name, i) => `<span class="${i === step ? 'is-current' : i < step ? 'is-done' : ''}" ${i === step ? 'aria-current="step"' : ''}>${i + 1} ${name}</span>`).join('');
    if (step === 0) {
      const tickets = Array.from({ length: 5 }, () => IDS).flat();
      body.innerHTML = `<h1>Your special move</h1><p>Watch the tickets roll. A new random ability each round.</p><div class="ability-reel-shell"><div class="ability-reel-pointer" aria-hidden="true">▼</div><div class="ability-reel-window" aria-hidden="true"><div class="ability-reel-track">${tickets.map(id => `<div class="ability-ticket" style="--ticket-accent:${ABILITY_ACCENTS[id]}"><span class="ability-ticket-number">SPECIAL MOVE</span><div class="ability-ticket-art">${abilityIcon(id, false)}</div><span class="ability-ticket-name">${ABILITIES[id].name}</span></div>`).join('')}</div><div class="ability-reel-selection"></div></div></div><p class="wheel-result" role="status" aria-live="polite">Rolling…</p>`;
      timers.push(window.setTimeout(() => {
        if (!active || current !== version) return;
        const id = ability();
        const track = body.querySelector<HTMLElement>('.ability-reel-track')!;
        const selected = track.children[3 * IDS.length + IDS.indexOf(id)] as HTMLElement;
        const first = track.children[0] as HTMLElement;
        const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 3800;
        track.style.transition = `transform ${duration}ms cubic-bezier(.12,.75,.14,1)`;
        track.style.transform = `translateX(-${selected.offsetLeft - first.offsetLeft}px)`;
        timers.push(window.setTimeout(() => {
          if (!active || current !== version) return;
          selected.classList.add('is-selected');
          body.querySelector<HTMLElement>('.wheel-result')!.textContent = `${ABILITIES[id].name}!`;
          timers.push(window.setTimeout(() => moveTo(1), 900));
        }, duration));
      }, 300));
    } else if (step === 1) {
      const id = ability(), a = ABILITIES[id];
      body.innerHTML = `<span class="prep-eyebrow">YOUR SPECIAL ABILITY</span><div class="prep-ability-art">${abilityIcon(id, false)}</div><h1>${a.name}</h1><p>${ABILITY_GUIDE[id].description}</p><div class="prep-facts"><span>${ABILITY_TUNING.charges} uses per battle</span><span>${a.cooldown}s cooldown</span></div><p class="prep-hint">During battle, tap the small circular special button. Move the joystick to aim directional abilities.</p><button class="prep-next">See my weapon →</button><p class="prep-error" role="status"></p>`;
      const next = body.querySelector<HTMLButtonElement>('.prep-next')!;
      next.onclick = async () => {
        next.disabled = true; next.textContent = 'Preparing weapon…';
        // While the server is still designing the weapon, it refuses for a few seconds; keep
        // retrying quietly (it locks in the shape-based weapon once the wait runs out).
        for (;;) {
          try { await ctx.conn.reducers.prepareWeapon({}); break; }
          catch {
            if (!active || current !== version) return;
            if (ctx.conn.db.weapon.player.find(ctx.identity)?.status !== 'generating') {
              body.querySelector<HTMLElement>('.prep-error')!.textContent = 'Your drawing is still arriving. Tap to try again.';
              next.textContent = 'See my weapon →'; next.disabled = false;
              return;
            }
            await new Promise((r) => setTimeout(r, 500));
            if (!active || current !== version) return;
          }
        }
        moveTo(2);
      };
    } else if (step === 2) {
      const w = ctx.conn.db.weapon.player.find(ctx.identity);
      const stored = w?.spec ? JSON.parse(w.spec) as StoredWeapon : null;
      body.innerHTML = `<span class="prep-eyebrow">YOUR WEAPON</span><h1 class="prep-weapon-name"></h1><div class="prep-weapon-art"></div><button class="prep-hear" type="button">Hear weapon</button><p class="prep-voice-status" role="status"></p><div class="prep-weapon-guide"></div><button class="prep-next">Pick deployment spot →</button>`;
      const hear = body.querySelector<HTMLButtonElement>('.prep-hear')!;
      hear.disabled = !stored;
      hear.onclick = async () => {
        const ready = resumeAudio();
        hear.disabled = true; hear.textContent = 'Listening…';
        const played = await ready && await ctx.audio?.announce(true);
        if (!active || current !== version) return;
        hear.disabled = false; hear.textContent = played ? 'Hear weapon' : 'Tap to retry';
        body.querySelector('.prep-voice-status')!.textContent = played ? '' : 'Could not play the announcement. Tap to retry.';
      };
      const deploy = body.querySelector<HTMLButtonElement>('.prep-next')!;
      deploy.disabled = !stored;
      if (!stored) deploy.textContent = 'Receiving your weapon…';
      deploy.onclick = () => moveTo(3);
      body.querySelector<HTMLElement>('.prep-weapon-name')!.textContent = stored?.spec.name ?? 'Your doodle';
      if (stored) {
        const info = weaponGuide(stored), guide = body.querySelector<HTMLElement>('.prep-weapon-guide')!;
        guide.innerHTML = '<div class="prep-facts"><span></span><span></span><span></span></div><p class="prep-element"></p><p class="prep-how"></p><p class="prep-hint"></p>';
        const facts = guide.querySelectorAll('span');
        facts[0]!.textContent = info.element; facts[1]!.textContent = info.type; facts[2]!.textContent = info.range;
        guide.querySelector('.prep-element')!.textContent = info.elementDescription;
        guide.querySelector('.prep-how')!.textContent = info.how;
        guide.querySelector('.prep-hint')!.textContent = `${info.cadence}. ${info.effects}`;
      }
      void (async () => {
        const d = ctx.conn.db.doodle.player.find(ctx.identity);
        const art = await loadDoodle({ spriteUrl: w?.spriteUrl, png: d?.png }).catch(() => null);
        if (!active || current !== version) return;
        const preview = await weaponStage(art, stored?.spec ?? null, { size: Math.min(innerWidth * .65, 240) });
        if (!active || current !== version) { preview.destroy(); return; }
        stage = preview;
        body.querySelector('.prep-weapon-art')!.appendChild(preview.el); preview.swing();
      })().catch(() => {});
    } else {
      body.innerHTML = `<span class="prep-eyebrow">FINAL STEP</span><h1>Pick your deployment spot</h1><p>Tap the arena to choose where you start. You can move your marker until everyone is ready.</p><div class="prep-arena" aria-label="Deployment arena"><div class="prep-pin"></div></div><p class="prep-deploy-status" role="status">Choose your spot.</p><p class="prep-hint">The round continues when everyone has deployed. If time runs out, unplaced players get a random spot.</p>`;
      const arena = body.querySelector<HTMLDivElement>('.prep-arena')!, pin = body.querySelector<HTMLDivElement>('.prep-pin')!;
      const mark = (x: number, y: number) => { pin.style.display = 'block'; pin.style.left = `${x * 100}%`; pin.style.top = `${y * 100}%`; };
      const p = player();
      if (p && p.dropX >= 0 && p.dropY >= 0) { mark(p.dropX, p.dropY); body.querySelector('.prep-deploy-status')!.textContent = 'Deployed! Waiting for the other players…'; }
      arena.onpointerdown = async e => {
        const r = arena.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        mark(x, y);
        try {
          await ctx.conn.reducers.setDrop({ x, y });
          if (active && current === version) body.querySelector('.prep-deploy-status')!.textContent = 'Deployed! Waiting for the other players…';
        } catch {
          if (active && current === version) body.querySelector('.prep-deploy-status')!.textContent = 'Could not save your spot. Tap to retry.';
        }
      };
    }
  };
  const onWeapon: Parameters<typeof ctx.conn.db.weapon.onUpdate>[0] = (_event, old, w) => {
    if (active && step === 2 && w.player.isEqual(ctx.identity) && w.spec !== old.spec) render();
  };
  ctx.conn.db.weapon.onUpdate(onWeapon);
  const swing = window.setInterval(() => stage?.swing(), 2200);
  render();
  return () => { active = false; ctx.audio?.setWeaponDisplay(false); stopCd(); timers.forEach(clearTimeout); clearInterval(swing); stage?.destroy(); ctx.conn.db.weapon.removeOnUpdate(onWeapon); };
};
