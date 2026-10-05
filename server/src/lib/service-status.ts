import { MODELS } from '../config';

// What's wrong with an outside service, in a form the shared-screen lobby can explain to the host
// ("Weapon art: out of credits → players will see their doodles"). Shared by every procedure.

/** One row per game feature that depends on an outside service. */
export type Service = 'weapon_design' | 'weapon_art' | 'weapon_sound' | 'voice' | 'commentator';
export type ServiceIssue = 'credits' | 'auth' | 'rate_limit' | 'unconfigured' | 'unreachable' | 'timeout' | 'provider_down' | 'error';

/** Error text → issue kind. Credits first: providers report empty balances as 401/402/403/429. */
export function classifyFailure(message: string): ServiceIssue {
  const m = message.toLowerCase();
  if (/credit|quota|billing|prepay|spending limit|insufficient|payment|balance|depleted/.test(m) || /\bhttp 402\b/.test(m)) return 'credits';
  if (/not configured|not set|missing key|unconfigured/.test(m)) return 'unconfigured';
  if (/\bhttp 429\b|rate.?limit|too many requests/.test(m)) return 'rate_limit';
  if (/\bhttp 40[13]\b|unauthori[sz]ed|forbidden|(incorrect|invalid|wrong|bad) api.?key|api.?key (is )?(invalid|incorrect)|permission/.test(m)) return 'auth';
  if (/timed? ?out|timeout|deadline/.test(m)) return 'timeout';
  if (/refusing to connect|private or special-purpose|connect|dns|resolve|unreachable|econn|enotfound|network/.test(m)) return 'unreachable';
  if (/\bhttp 5\d\d\b/.test(m)) return 'provider_down';
  return 'error';
}

/** Anything that looks like an API key never reaches the public table. */
export function redactKeys(s: string): string {
  return s.replace(/\b(sk|xai|AIza|ABSK|sk_)[-_A-Za-z0-9+/=]{12,}/g, '<redacted>').slice(0, 240);
}

/** Error for a non-OK provider response, with a short body snippet (tells "no credits" apart). */
export function httpError(label: string, res: { status: number; text(): string }): Error {
  let body = '';
  try { body = res.text().replace(/\s+/g, ' ').trim().slice(0, 200); } catch { /* no body */ }
  return new Error(`${label} HTTP ${res.status}${body ? `: ${body}` : ''}`);
}

/** Which company makes the weapon art, from the configured model id. */
export const ART_PROVIDER = MODELS.sprite.startsWith('gemini') ? 'Gemini' : 'xAI';
