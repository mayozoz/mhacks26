import { TimeDuration } from 'spacetimedb';
import { t } from 'spacetimedb/server';
import type { StoredWeapon } from '@doodle/spec';
import spacetimedb from '../schema';
import { ENDPOINTS, MODELS, TIMEOUT_MS } from '../config';
import { toBase64 } from '../lib/base64';
import { logFail, serviceOk } from './common';
import { httpError } from '../lib/service-status';

const VOICE = { service: 'voice', provider: 'ElevenLabs' } as const;

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

/** Speak the caller's final weapon name, cache once per round, return audio only to that phone. */
export const genAnnouncement = spacetimedb.procedure(t.string(), (ctx) => {
  const job = ctx.withTx((tx) => {
    const p = tx.db.player.identity.find(ctx.sender);
    const r = p && tx.db.room.code.find(p.roomCode);
    const w = tx.db.weapon.player.find(ctx.sender);
    if (!p || !r || !w?.spec || !['reveal', 'battle'].includes(r.phase)) return null;
    let name: string;
    try { name = (JSON.parse(w.spec) as StoredWeapon).spec.name.trim().slice(0, 100); }
    catch { return null; }
    if (!name) return null;
    const old = tx.db.weaponVoice.player.find(ctx.sender);
    if (old?.roomCode === r.code && old.round === r.round && old.name === name) {
      if (old.status === 'ready') return { cached: old.audioUrl };
      // Prevent concurrent paid calls; permit retry after a failed/timed-out request.
      if (old.status === 'pending' && tx.timestamp.microsSinceUnixEpoch - old.requestedAt.microsSinceUnixEpoch < 20_000_000n) return null;
    }
    const key = tx.db.secrets.key.find('ELEVENLABS_API_KEY')?.value.trim();
    if (!key) {
      return { missingKey: r.code };
    }
    const voice = tx.db.secrets.key.find('ELEVENLABS_VOICE_ID')?.value.trim() || DEFAULT_VOICE;
    const row = { player: ctx.sender, roomCode: r.code, round: r.round, name, audioUrl: '', status: 'pending', requestedAt: tx.timestamp };
    if (old) tx.db.weaponVoice.player.update(row);
    else tx.db.weaponVoice.insert(row);
    return { key, voice, row };
  });
  if (!job) return '';
  if ('cached' in job) return job.cached ?? '';
  if ('missingKey' in job) {
    logFail(ctx, job.missingKey!, 'gen_announcement', new Error('ELEVENLABS_API_KEY is not configured'), VOICE);
    return '';
  }

  let audioUrl = '';
  try {
    const res = ctx.http.fetch(ENDPOINTS.elevenTts(job.voice, 'mp3_44100_128'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': job.key, Accept: 'audio/mpeg' },
      timeout: TimeDuration.fromMillis(TIMEOUT_MS.announcement),
      body: JSON.stringify({ text: `Your weapon is ${job.row.name}!`, model_id: MODELS.announcement }),
    });
    if (!res.ok) throw httpError('ElevenLabs', res);
    const bytes = res.bytes();
    if (!bytes.length || bytes.length > 256_000) throw new Error('Invalid speech response size');
    audioUrl = `data:audio/mpeg;base64,${toBase64(bytes)}`;
    serviceOk(ctx, 'voice');
  } catch (e) {
    logFail(ctx, job.row.roomCode, 'gen_announcement', e, VOICE);
  }

  return ctx.withTx((tx) => {
    const p = tx.db.player.identity.find(ctx.sender);
    const r = p && tx.db.room.code.find(p.roomCode);
    const row = tx.db.weaponVoice.player.find(ctx.sender);
    // Never attach an old response to a new round or replay it after Results.
    if (!r || r.code !== job.row.roomCode || r.round !== job.row.round || !['reveal', 'battle'].includes(r.phase)
      || !row || row.requestedAt.microsSinceUnixEpoch !== job.row.requestedAt.microsSinceUnixEpoch) return '';
    tx.db.weaponVoice.player.update({ ...row, audioUrl, status: audioUrl ? 'ready' : 'failed' });
    return audioUrl;
  });
});
