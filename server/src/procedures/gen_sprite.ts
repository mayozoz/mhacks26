import { TimeDuration } from 'spacetimedb';
import { t } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { ENDPOINTS, MODELS, TIMEOUT_MS } from '../config';
import { toBase64 } from '../lib/base64';
import { SPRITE_PROMPT } from '../prompts/sprite.v1';
import { loadJob, logFail, writeIfStillPending } from './common';

/** Bound the inline art sent to every subscriber; no public bucket is required. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function spriteDataUrl(json: unknown): string {
  const response = json as { data?: { b64_json?: string; mime_type?: string }[] } | null;
  const data = response?.data?.[0]?.b64_json;
  if (!data) throw new Error('Image provider returned no sprite');
  if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error('Invalid sprite image response');
  }
  // xAI returns JPEG; sniff the magic bytes rather than trusting a label
  const mimeType = data.startsWith('/9j/') ? 'image/jpeg' : data.startsWith('iVBOR') ? 'image/png' : data.startsWith('UklGR') ? 'image/webp' : null;
  if (!mimeType) throw new Error('Invalid sprite image response');
  return `data:${mimeType};base64,${data}`;
}

/** Doodle PNG → xAI image editing → weapon art. Missing/failed art keeps the doodle. */
export const genSprite = spacetimedb.procedure(t.unit(), (ctx) => {
  const job = loadJob(ctx, 'spriteUrl');
  if (!job || !job.png.length || job.features?.isEmpty) return {};
  const key = job.secrets.XAI_API_KEY?.trim();
  if (!key) {
    logFail(ctx, job.roomCode, 'gen_sprite', new Error('XAI_API_KEY is not configured'));
    return {};
  }
  try {
    const res = ctx.http.fetch(ENDPOINTS.xaiImageEdit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      timeout: TimeDuration.fromMillis(TIMEOUT_MS.sprite),
      body: JSON.stringify({
        model: MODELS.sprite,
        prompt: SPRITE_PROMPT,
        image: { type: 'image_url', url: `data:image/png;base64,${toBase64(job.png)}` },
        response_format: 'b64_json',
      }),
    });
    if (!res.ok) throw new Error(`Image provider HTTP ${res.status}`);
    writeIfStillPending(ctx, 'spriteUrl', spriteDataUrl(res.json()), false, job);
  } catch (e) {
    logFail(ctx, job.roomCode, 'gen_sprite', e);
  }
  return {};
});
