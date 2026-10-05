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

function fix(r: ServiceRow): string {
  switch (r.issue) {
    case 'credits': return `Add credits to the ${r.provider} account.`;
    case 'auth': return `Check the ${r.provider} key in .env, then rerun scripts/set-secrets.ts.`;
    case 'rate_limit': return 'Wait a minute; it should recover.';
    case 'unconfigured': return 'Add the missing setting to .env, then rerun scripts/set-secrets.ts.';
    case 'unreachable': return r.provider.includes('agent') ? 'Check the agent is running and AGENT_URL is its current public (tunnel) URL.' : 'Check the network connection.';
    case 'timeout': case 'provider_down': return 'The provider is having trouble; it may recover on its own.';
    default: return 'Open ?debug for details.';
  }
}

/** "Weapon art (Gemini): out of credits — players see their own doodles." + how to fix. */
export function describeService(r: ServiceRow, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - r.at.toDate().getTime()) / 60000));
  return {
    headline: `${FEATURE[r.service] ?? r.service} (${r.provider}): ${PROBLEM[r.issue] ?? 'failing'}`,
    meanwhile: MEANWHILE[r.service] ? `Until then, ${MEANWHILE[r.service]}.` : '',
    fix: fix(r),
    when: mins < 1 ? 'just now' : `${mins} min ago`,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Mounts the lobby notice; it hides itself when every service is healthy. */
export function mountServiceNotice(el: HTMLElement, conn: DbConnection): () => void {
  const box = document.createElement('aside');
  box.className = 'service-notice';
  box.setAttribute('role', 'status');
  el.appendChild(box);
  const render = () => {
    const rows = [...conn.db.serviceStatus.iter()] as ServiceRow[];
    box.hidden = rows.length === 0;
    box.innerHTML = rows.length ? `<strong>Host check · lobby only</strong>${rows.map((r) => {
      const d = describeService(r);
      return `<p><b>${esc(d.headline)}</b> <span class="when">${d.when}</span><br>${esc(d.meanwhile)} ${esc(d.fix)}</p>`;
    }).join('')}` : '';
  };
  conn.db.serviceStatus.onInsert(render); conn.db.serviceStatus.onUpdate(render); conn.db.serviceStatus.onDelete(render);
  const timer = window.setInterval(render, 30_000); // keep "x min ago" fresh
  render();
  return () => {
    clearInterval(timer); box.remove();
    conn.db.serviceStatus.removeOnInsert(render); conn.db.serviceStatus.removeOnUpdate(render); conn.db.serviceStatus.removeOnDelete(render);
  };
}
