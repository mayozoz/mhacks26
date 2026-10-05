import { TimeDuration } from 'spacetimedb';
import { t } from 'spacetimedb/server';
import type { StoredWeapon } from '@doodle/spec';
import { MAX_HP } from '@doodle/spec';
import spacetimedb from '../schema';
import { COMMENTARY, ENDPOINTS } from '../config';
import { COMMENTARY_SYSTEM_PROMPT } from '../prompts/commentary.v1';
import { secondsBetween } from '../lib/time';
import { logFail, serviceOk, type PCtx } from './common';
import { httpError } from '../lib/service-status';

/**
 * weapon: Reveal intro — just "<player>'s <weapon name>!" for focus `a`, spoken as-is (no LLM),
 *         one per weapon as it comes on stage.
 * others: an LLM-written play-by-play line.
 */
const KINDS = ['weapon', 'color', 'ko', 'final', 'winner'] as const;
type Kind = (typeof KINDS)[number];
const EMPTY = { text: '', audio: new Uint8Array() };

/** Words that would break "the middle is invisible" — drop the line if the model says them. */
const FORBIDDEN = /\b(ai|a\.i\.|generated|generate|prompt|model|hp|damage|percent|stats?)\b|\d/i;

/**
 * One announcer line for the shared screen: snapshot → ASI:One writes it → ElevenLabs speaks it.
 * Returns the line's text (for on-screen captions) and its MP3 bytes (empty = nothing to play).
 * Host-only, throttled per room, never throws.
 * `a`/`b` are optional player identities (hex) to focus on, e.g. killer/victim for a KO.
 */
export const genCommentary = spacetimedb.procedure(
  { kind: t.string(), a: t.string(), b: t.string() },
  t.object('CommentaryLine', { text: t.string(), audio: t.byteArray() }),
  (ctx, { kind, a, b }) => {
    if (!COMMENTARY.enabled || !(KINDS as readonly string[]).includes(kind)) return EMPTY;
    const job = load(ctx, kind as Kind, a, b);
    if (!job) return EMPTY;
    try {
      const line = kind === 'weapon' ? job.weaponLine : writeLine(ctx, job.asiKey, job.snapshot);
      if (!line) return EMPTY;
      const audio = speak(ctx, job.elevenKey, line);
      serviceOk(ctx, 'commentator');
      return { text: line, audio };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[commentary] ${kind} failed: ${msg}`);
      logFail(ctx, job.roomCode, `gen_commentary (${kind})`, e, { service: 'commentator', provider: msg.startsWith('ASI:One') ? 'ASI:One' : 'ElevenLabs' });
      return EMPTY;
    }
  },
);

function load(ctx: PCtx, kind: Kind, a: string, b: string) {
  return ctx.withTx((tx) => {
    const r = [...tx.db.room.iter()].find((x) => x.host.isEqual(ctx.sender));
    if (!r || r.phase === 'lobby' || r.phase === 'draw') return null;
    const asiKey = tx.db.secrets.key.find('ASI_ONE_API_KEY')?.value;
    const elevenKey = tx.db.secrets.key.find('ELEVENLABS_API_KEY')?.value;
    if (!asiKey || !elevenKey) return null;

    const players = [...tx.db.player.roomCode.filter(r.code)];

    // Reveal intro: only "<player>'s <weapon name>!", read verbatim. Cheap (speech only, no
    // LLM), so it's outside the per-round line budget; only during Reveal, only for this room.
    if (kind === 'weapon') {
      const p = players.find((x) => x.identity.toHexString() === a);
      const w = p && tx.db.weapon.player.find(p.identity);
      if (r.phase !== 'reveal' || !p || !w?.spec) return null;
      const weapon = (JSON.parse(w.spec) as StoredWeapon).spec.name;
      return { roomCode: r.code, asiKey, elevenKey, snapshot: null, weaponLine: `${p.name}'s ${weapon}!` };
    }

    // throttle: min gap + max lines per round (cost guard)
    const c = tx.db.commentary.roomCode.find(r.code);
    const fresh = !c || c.round !== r.round;
    if (!fresh && c) {
      if (c.lines >= COMMENTARY.maxLinesPerRound) return null;
      if (secondsBetween(c.lastAt, tx.timestamp) < COMMENTARY.minGapS && kind === 'color') return null;
    }
    const row = { roomCode: r.code, round: r.round, lines: (fresh ? 0 : c!.lines) + 1, lastAt: tx.timestamp };
    if (c) tx.db.commentary.roomCode.update(row);
    else tx.db.commentary.insert(row);

    const name = (hex: string) => players.find((p) => p.identity.toHexString() === hex)?.name ?? '';
    const snapshot = {
      event: kind,
      focus: { a: name(a), b: name(b) },
      players: players.map((p) => {
        const w = tx.db.weapon.player.find(p.identity);
        const spec = w?.spec ? (JSON.parse(w.spec) as StoredWeapon).spec : null;
        const f = tx.db.fighter.player.find(p.identity);
        const hp = f ? f.hp / MAX_HP : 1;
        return {
          name: p.name,
          weapon: spec?.name ?? 'a mystery stick',
          style: spec?.archetype ?? 'swing',
          effects: spec?.vfx.map((v) => v.type) ?? [],
          // words, not numbers — the model must never read out stats
          condition: !p.alive || hp <= 0 ? 'knocked out' : hp > 0.66 ? 'fresh' : hp > 0.33 ? 'bruised' : 'hanging on',
        };
      }),
    };
    return { roomCode: r.code, asiKey, elevenKey, snapshot, weaponLine: '' };
  });
}

function writeLine(ctx: PCtx, key: string, snapshot: unknown): string | null {
  const res = ctx.http.fetch(ENDPOINTS.asi1, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    timeout: TimeDuration.fromMillis(COMMENTARY.timeoutMs),
    body: JSON.stringify({
      model: COMMENTARY.lineModel,
      temperature: 1.1,
      max_tokens: 60,
      messages: [
        { role: 'system', content: COMMENTARY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(snapshot) },
      ],
    }),
  });
  if (!res.ok) throw httpError('ASI:One', res);
  const raw: unknown = res.json()?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') return null;
  const line = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/["“”*_#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!line) return null;
  // Check the line with player/weapon names blanked out, so "bot2" or "Blaster 3000" in a name
  // doesn't count as the model reading out a number.
  const names = (snapshot as { players: { name: string; weapon: string }[] }).players.flatMap((p) => [p.name, p.weapon]).filter(Boolean);
  let scrubbed = line;
  for (const n of names.sort((x, y) => y.length - x.length)) scrubbed = scrubbed.split(n).join(' ').replace(new RegExp(escapeRe(n), 'gi'), ' ');
  if (FORBIDDEN.test(scrubbed)) {
    console.info(`[commentary] dropped (filter): ${line}`);
    return null;
  }
  console.info(`[commentary] ${(snapshot as { event: string }).event}: ${line}`);
  return line;
}

function speak(ctx: PCtx, key: string, text: string): Uint8Array {
  const res = ctx.http.fetch(ENDPOINTS.elevenTts(COMMENTARY.voiceId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
    timeout: TimeDuration.fromMillis(COMMENTARY.timeoutMs),
    body: JSON.stringify({
      text,
      model_id: COMMENTARY.ttsModel,
      voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw httpError('ElevenLabs', res);
  return res.bytes();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
