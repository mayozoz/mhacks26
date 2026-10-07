import { Timestamp } from 'spacetimedb';
import nipplejs from 'nipplejs';
import { ABILITIES, ABILITY_TUNING, isAbilityId, MAX_HP, type StoredWeapon } from '@doodle/spec';
import { secondsLeft, serverNowMs } from '../../net/clock';
import { mountAbilityBlindness } from '../../ui/ability-blindness';
import { mountDamageFeedback } from './damage-feedback';
import { click, resumeAudio } from '../../audio/sfx';
import { mountRotateHint } from '../../ui/rotate-hint';
import type { View } from './types';
import './battle-controls.css';
import { abilityIcon } from '../../ui/ability-icons';

const SEND_HZ = 20;

/** Landscape: joystick left, signature button right (with cooldown ring), HP bar on top. */
export const battleView: View = (ctx) => {
  ctx.el.innerHTML = `
    <div class="battle-controls-shell">
      <div id="hp" style="position:absolute;top:12px;left:50%;translate:-50%;width:40vw;height:14px;border-radius:7px;background:#0006;overflow:hidden">
        <div id="hpfill" style="height:100%;width:100%;background:var(--player)"></div>
      </div>
      <button id="hear-weapon" class="battle-hear" aria-label="Hear your weapon">Hear weapon</button>
      <div id="stick" class="battle-stick-zone" aria-label="Movement area"></div>
      <div class="battle-attack-zone">
        <div class="battle-attack-frame">
          <button id="atk" class="battle-sword-button" aria-label="Attack">
            <svg class="battle-sword" viewBox="0 0 48 48" aria-hidden="true">
              <path d="m19 28 5 5L39 18l2-11-11 2z" fill="currentColor"/>
              <path d="m23 29 11-11" fill="none" stroke="#14121f" stroke-width="2" opacity=".25" stroke-linecap="round"/>
              <path d="m15 25 13 13M12 36l8-8M9 39l3-3" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <svg class="battle-sword-cooldown" viewBox="0 0 100 100" aria-hidden="true">
            <circle id="ring" cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>
          </svg>
        </div>
        <button id="special" class="battle-special" aria-label="Special ability">
          <span class="battle-special-art"></span>
          <span class="battle-special-name">Special</span>
          <span class="battle-special-status">2/2</span>
        </button>
      </div>
    </div>`;

  // Non-blocking rotate pill (ui/rotate-hint.ts): a phone with rotation lock can still play.
  const unhint = mountRotateHint(ctx.el, false);
  const zone = ctx.el.querySelector<HTMLElement>('#stick')!;
  const stick = nipplejs.create({ zone, mode: 'dynamic', color: '#fff', size: 120, fadeTime: 0 });
  stick.on('start', () => zone.classList.add('is-active'));
  stick.on('end', () => zone.classList.remove('is-active'));

  // Send the direction vector only when it changes, max 20/s.
  let want = { dx: 0, dy: 0 };
  let sent = { dx: 0, dy: 0 };
  stick.on('move', (_e, d) => {
    const f = Math.min(1, d.force);
    // nipplejs: +y is up; arena: +y is down.
    want = { dx: Math.cos(d.angle.radian) * f, dy: -Math.sin(d.angle.radian) * f };
  });
  stick.on('end', () => (want = { dx: 0, dy: 0 }));
  const sender = setInterval(() => {
    if (Math.abs(want.dx - sent.dx) < 0.02 && Math.abs(want.dy - sent.dy) < 0.02) return;
    sent = want;
    void ctx.conn.reducers.setInput(want);
  }, 1000 / SEND_HZ);

  const stopDamageFeedback = mountDamageFeedback(ctx);
  let blindUntil = 0;
  const stopBlind = mountAbilityBlindness(ctx.el, () => {
    for (const o of ctx.conn.db.abilityObject.iter()) if (o.roomCode === ctx.roomCode) {
      const d = JSON.parse(o.data) as { kind: string; until: number };
      if (d.kind === 'blind') blindUntil = Math.max(blindUntil, d.until);
    }
    return { now: serverNowMs() / 1000, until: blindUntil, battle: true };
  });

  // Every press: local bounce + click. Vibration is reserved for received damage.
  const btn = ctx.el.querySelector<HTMLButtonElement>('#atk')!;
  let active = true;
  const hear = ctx.el.querySelector<HTMLButtonElement>('#hear-weapon')!;
  hear.onclick = async () => {
    const ready = resumeAudio();
    hear.disabled = true;
    hear.textContent = 'Listening…';
    const played = await ready && await ctx.audio?.announce(true);
    if (!active) return;
    hear.disabled = false;
    hear.textContent = played ? 'Hear weapon' : 'Tap to retry';
  };
  btn.onpointerdown = () => {
    btn.animate([{ scale: 1 }, { scale: 0.9 }, { scale: 1 }], { duration: 120 });
    click();
    void ctx.conn.reducers.pressAttack({});
  };

  const special = ctx.el.querySelector<HTMLButtonElement>('#special')!;
  const specialName = special.querySelector<HTMLElement>('.battle-special-name')!;
  const specialStatus = special.querySelector<HTMLElement>('.battle-special-status')!;
  const specialArt = special.querySelector<HTMLElement>('.battle-special-art')!;
  let displayedAbility = '';
  special.onpointerdown = () => {
    if (special.disabled) return;
    click(); // no vibration: vibration is reserved for damage you take
    void ctx.conn.reducers.pressAbility({});
  };

  // Cooldown ring + HP from our own fighter row.
  const ring = ctx.el.querySelector<SVGCircleElement>('#ring')!;
  const hpFill = ctx.el.querySelector<HTMLDivElement>('#hpfill')!;
  let raf = 0;
  const loop = () => {
    const f = ctx.conn.db.fighter.player.find(ctx.identity);
    const w = ctx.conn.db.weapon.player.find(ctx.identity);
    if (f) {
      const ability = isAbilityId(f.abilityId) ? ABILITIES[f.abilityId] : ABILITIES.flash;
      const abilityId = isAbilityId(f.abilityId) ? f.abilityId : 'flash';
      if (displayedAbility !== abilityId) {
        displayedAbility = abilityId;
        specialArt.innerHTML = abilityIcon(abilityId);
      }
      const abilityLeft = secondsLeft(f.abilityReadyAt);
      const effects = JSON.parse(f.effects) as Record<string, { until: number }>;
      const statusLocked = ['silenced', 'frozen'].some(key => effects[key] && secondsLeft(new Timestamp(BigInt(Math.round(effects[key]!.until * 1e6)))) > 0);
      special.disabled = f.hp <= 0 || f.abilityCharges === 0 || abilityLeft > 0 || statusLocked;
      special.style.opacity = special.disabled ? '0.5' : '1';
      specialName.textContent = ability.name;
      specialStatus.textContent = `${f.abilityCharges}/${ABILITY_TUNING.charges}${abilityLeft > 0 ? ` · ${Math.ceil(abilityLeft)}s` : statusLocked ? ' · Blocked' : ''}`;
      special.setAttribute('aria-label', `${ability.name}, ${specialStatus.textContent}`);
      hpFill.style.width = `${Math.max(0, (f.hp / MAX_HP) * 100)}%`;
      const rage = effects.rage && secondsLeft(new Timestamp(BigInt(Math.round(effects.rage.until * 1e6)))) > 0;
      const cd = (w?.spec ? (JSON.parse(w.spec) as StoredWeapon).stats.cooldown : 0.6) / (rage ? ABILITY_TUNING.attackSpeedMultiplier : 1);
      const left = secondsLeft(f.cooldownReadyAt);
      ring.style.strokeDashoffset = String(Math.min(1, left / cd));
    }
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    stopDamageFeedback();
    stopBlind();
    active = false;
    clearInterval(sender);
    cancelAnimationFrame(raf);
    stick.destroy();
    unhint();
    void ctx.conn.reducers.setInput({ dx: 0, dy: 0 });
  };
};
