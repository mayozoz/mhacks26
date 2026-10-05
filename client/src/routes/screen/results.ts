import { colorForSlot, type StoredWeapon } from '@doodle/spec';
import type { DbConnection } from '../../module_bindings';
import { loadDoodle, weaponStage, type WeaponStage } from '../../ui/weapon-stage';
import { drawMarkerSvg } from '../../ui/marker-svg';

/**
 * Results: a top-3 podium (2nd · 1st · 3rd). Each step shows the player's color, marker, name,
 * weapon art and weapon name; the blocks rise 3rd → 2nd → 1st and the winner gets a crown and
 * a test swing. Fewer than 3 players → fewer steps.
 */
export function resultsOverlay(el: HTMLElement, conn: DbConnection, code: string): () => void {
  const r = conn.db.room.code.find(code);
  const doodles = new Map([...conn.db.doodle.iter()].filter((d) => d.roomCode === code).map((d) => [d.player.toHexString(), d.png]));
  const ranked = [...conn.db.player.iter()]
    .filter((p) => p.roomCode === code && p.placement > 0)
    .sort((a, b) =>
      a.placement - b.placement
      || Number(b.identity.toHexString() === r?.winner) - Number(a.identity.toHexString() === r?.winner)
      || a.colorSlot - b.colorSlot)
    .slice(0, 3);

  el.innerHTML = `
    <div class="center" style="pointer-events:auto">
      <div class="results">
        <div class="results-title">${ranked[0] ? `${esc(ranked[0].name)} wins!` : 'Draw!'}</div>
        <div class="podium"></div>
        <button id="again">Play again</button>
      </div>
    </div>`;
  const podium = el.querySelector<HTMLDivElement>('.podium')!;
  if (ranked[0]) el.querySelector<HTMLDivElement>('.results-title')!.style.color = colorForSlot(ranked[0].colorSlot).hex;

  const stages: WeaponStage[] = [];
  let alive = true;
  // visual order: 2nd, 1st, 3rd
  const order = [ranked[1], ranked[0], ranked[2]];
  const RISE_DELAY = [0.35, 0.7, 0]; // 3rd rises first, then 2nd, then 1st
  order.forEach((p, slot) => {
    if (!p) return;
    const place = slot === 1 ? 1 : slot === 0 ? 2 : 3;
    const c = colorForSlot(p.colorSlot);
    const w = conn.db.weapon.player.find(p.identity);
    const stored = w?.spec ? (JSON.parse(w.spec) as StoredWeapon) : null;

    const step = document.createElement('div');
    step.className = `podium-step place-${place}`;
    step.style.setProperty('--c', c.hex);
    step.style.animationDelay = `${RISE_DELAY[slot]}s`;
    step.innerHTML = `
      ${place === 1 ? '<div class="crown">👑</div>' : ''}
      <div class="art"></div>
      <div class="pname">${drawMarkerSvg(p.marker, c.hex)}<span>${esc(p.name)}</span></div>
      <div class="wname">${esc(stored?.spec.name ?? 'Mystery Stick')}</div>
      <div class="block"><span>${place}</span></div>
      <div class="podium-damage"><strong>${Math.round(p.totalDamage).toLocaleString()}</strong><span>Total damage</span></div>`;
    podium.appendChild(step);

    void (async () => {
      const doodle = await loadDoodle({ spriteUrl: w?.spriteUrl, png: doodles.get(p.identity.toHexString()) }).catch(() => null);
      // upgraded weapon, exactly as drawn (no rotation)
      const s = await weaponStage(doodle, stored?.spec ?? null, { size: place === 1 ? 210 : 150, orient: false });
      if (!alive) { s.destroy(); return; }
      stages.push(s);
      step.querySelector('.art')!.appendChild(s.el);
      // winner shows off once their block has risen
      if (place === 1) setTimeout(() => s.swing(), (RISE_DELAY[slot]! + 0.6) * 1000);
    })();
  });

  // Back to the QR-code lobby, so people can join or leave before the next round starts.
  el.querySelector<HTMLButtonElement>('#again')!.onclick = () => void conn.reducers.backToLobby({});
  return () => { alive = false; stages.forEach((s) => s.destroy()); };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
