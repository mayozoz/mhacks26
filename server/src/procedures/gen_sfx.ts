import { TimeDuration } from 'spacetimedb';
import { t } from 'spacetimedb/server';
import type { StoredWeapon } from '@doodle/spec';
import spacetimedb from '../schema';
import { ENDPOINTS, TIMEOUT_MS } from '../config';
import { GENERIC_SFX_BY_ARCHETYPE } from '../prompts/sfx.v1';
import { toBase64 } from '../lib/base64';
import { loadJob, logFail, serviceOk, writeIfStillPending } from './common';
import { httpError } from '../lib/service-status';

const SOUND = { service: 'weapon_sound', provider: 'ElevenLabs' } as const;

/** Short ElevenLabs MP3 → inline audio URL. No S3 credentials or public bucket needed. */
export const genSfx = spacetimedb.procedure(t.unit(), (ctx) => {
  const job = loadJob(ctx, 'sfxUrl');
  if (!job) return {};
  const key = job.secrets.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    logFail(ctx, job.roomCode, 'gen_sfx', new Error('ELEVENLABS_API_KEY is not configured'), SOUND);
    return {};
  }

  // Use the spec's prompt if gen_spec already finished; otherwise a generic one.
  let prompt = GENERIC_SFX_BY_ARCHETYPE.swing;
  if (job.specJson) {
    try {
      const spec = (JSON.parse(job.specJson) as StoredWeapon).spec;
      prompt = spec.sfx_prompt || GENERIC_SFX_BY_ARCHETYPE[spec.archetype] || prompt;
    } catch { /* generic */ }
  }

  try {
    const res = ctx.http.fetch(`${ENDPOINTS.elevenSfx}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key, Accept: 'audio/mpeg' },
      timeout: TimeDuration.fromMillis(TIMEOUT_MS.sfx),
      body: JSON.stringify({ text: prompt, duration_seconds: 1.0, prompt_influence: 0.6, model_id: 'eleven_text_to_sound_v2' }),
    });
    if (!res.ok) throw httpError('ElevenLabs', res);
    const bytes = res.bytes();
    if (!bytes.length || bytes.length > 64_000) throw new Error('Invalid sound response size');
    const url = `data:audio/mpeg;base64,${toBase64(bytes)}`;
    writeIfStillPending(ctx, 'sfxUrl', url, false, job);
    serviceOk(ctx, 'weapon_sound');
  } catch (e) {
    logFail(ctx, job.roomCode, 'gen_sfx', e, SOUND);
  }
  return {};
});
