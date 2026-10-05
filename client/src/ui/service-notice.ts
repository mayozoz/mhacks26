import type { DbConnection } from '../module_bindings';

// Host-facing notice for outside-service problems (out of credits, bad key, agent down...).
// Shown only on the shared-screen lobby, before a round, and in ?debug — never during play,
// so the "invisible middle" stays invisible to players.

export interface ServiceRow { service: string; provider: string; issue: string; detail: string; at: { toDate(): Date } }

const FEATURE: Record<string, string> = {
  weapon_design: 'Weapon design', weapon_art: 'Weapon art', weapon_sound: 'Weapon sounds',
  voice: 'Phone weapon announcer', commentator: 'Commentator',
};
const PROBLEM: Record<string, string> = {
  credits: 'out of credits', auth: 'API key rejected', rate_limit: 'rate limited',
  unconfigured: 'not set up', unreachable: "can't be reached", timeout: 'timing out',
  provider_down: 'service is down', error: 'failing',
};
const MEANWHILE: Record<string, string> = {
  weapon_design: "weapons come from the drawing's shape",
  weapon_art: 'players see their own doodles',
  weapon_sound: 'stock weapon sounds play',
  voice: 'phones skip the weapon announcement',
  commentator: 'the commentator stays quiet',
};

/** Who gets roasted when a service breaks, and how to reach her. */
const OWNER = 'Mei';
const DISCORD = '@nyxieeeee';

/** [what Mei hears, what everyone else should tell her to do]. Keeps the real fix in the joke. */
function roast(r: ServiceRow): [string, string] {
  const p = r.provider;
  switch (r.issue) {
    case 'credits': return [`${OWNER}, you're out of ${p} credits. Again. 💸`, `go feed the ${p} meter before the doodles riot`];
    case 'auth': return [`${OWNER}, ${p} says your API key is fake. Rude, but accurate.`, 'check her keys (the API ones, not the car ones) in .env and rerun set-secrets'];
    case 'rate_limit': return [`${OWNER}, ${p} needs a breather. You're asking too much (relatable).`, "touch grass for a minute; it'll recover on its own"];
    case 'unconfigured': return [`${OWNER}, you never actually set up ${p}. Bold strategy.`, 'add the missing line to .env and rerun set-secrets'];
    case 'unreachable': return p.includes('agent')
      ? [`${OWNER}, the Weapon Smith wandered off. Nobody can find him.`, 'restart the agent and put the new tunnel URL in AGENT_URL']
      : [`${OWNER}, ${p} has left the chat.`, 'check the internet (yes, really)'];
    case 'timeout': return [`${OWNER}, ${p} fell asleep mid-request.`, "chill — it's slow, not broken (probably)"];
    case 'provider_down': return [`${OWNER}, ${p} is on fire. Not the cool weapon kind.`, 'wait it out; it usually comes back'];
    default: return [`${OWNER}, ${FEATURE[r.service] ?? r.service} broke in a new and exciting way.`, 'open ?debug and read the scary text'];
  }
}

/** Mei's roast, the "not Mei? text her" line, and what players get meanwhile. */
export function describeService(r: ServiceRow, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - r.at.toDate().getTime()) / 60000));
  const [headline, ask] = roast(r);
  return {
    headline,
    feature: `${FEATURE[r.service] ?? r.service} (${r.provider}): ${PROBLEM[r.issue] ?? 'failing'}`,
    fix: `Not ${OWNER}? Text her on Discord ${DISCORD} and tell her to ${ask}.`,
    meanwhile: MEANWHILE[r.service] ? `Meanwhile, ${MEANWHILE[r.service]} (honestly iconic).` : '',
    when: mins < 1 ? 'just now' : `${mins} min ago`,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Mounts the lobby notice: a small red pill (top right) that expands to the details on click. */
export function mountServiceNotice(el: HTMLElement, conn: DbConnection): () => void {
  const box = document.createElement('details');
  box.className = 'service-notice';
  box.innerHTML = '<summary role="status"></summary><div class="service-list"></div>';
  el.appendChild(box);
  const summary = box.querySelector('summary')!, list = box.querySelector<HTMLDivElement>('.service-list')!;
  const render = () => {
    const rows = [...conn.db.serviceStatus.iter()] as ServiceRow[];
    box.hidden = rows.length === 0;
    if (!rows.length) { box.open = false; return; }
    summary.innerHTML = `<span aria-hidden="true">⚠</span> ${rows.length === 1 ? '1 service problem' : `${rows.length} service problems`}<span class="service-hint">host check</span>`;
    // Only the list is rebuilt, so an expanded notice stays expanded as rows update.
    list.innerHTML = rows.map((r) => {
      const d = describeService(r);
      return `<p><b>${esc(d.headline)}</b> <span class="when">${d.when}</span><br><span class="feature">${esc(d.feature)}</span><br>${esc(d.fix)} ${esc(d.meanwhile)}</p>`;
    }).join('');
  };
  conn.db.serviceStatus.onInsert(render); conn.db.serviceStatus.onUpdate(render); conn.db.serviceStatus.onDelete(render);
  const timer = window.setInterval(render, 30_000); // keep "x min ago" fresh
  render();
  return () => {
    clearInterval(timer); box.remove();
    conn.db.serviceStatus.removeOnInsert(render); conn.db.serviceStatus.removeOnUpdate(render); conn.db.serviceStatus.removeOnDelete(render);
  };
}
