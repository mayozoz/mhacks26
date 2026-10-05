import type { Identity } from 'spacetimedb';
import type { ProcedureCtx } from 'spacetimedb/server';
import type { DrawingFeatures } from '@doodle/spec';
import { SECRET_KEYS, type SecretKey } from '../config';
import { classifyFailure, redactKeys, type Service } from '../lib/service-status';
import type spacetimedb from '../schema';
import type { InferSchema } from 'spacetimedb/server';

export type PCtx = ProcedureCtx<InferSchema<typeof spacetimedb>>;
type WeaponField = 'spec' | 'spriteUrl' | 'sfxUrl';

export interface GenJob {
  player: Identity;
  playerHex: string;
  roomCode: string;
  seed: number;
  round: number;
  epoch: string;
  png: Uint8Array;
  features: DrawingFeatures | null;
  /** current weapon.spec JSON ('' if not ready) */
  specJson: string;
  secrets: Partial<Record<SecretKey, string>>;
}

/**
 * Idempotency gate shared by all gen_* procedures: the caller must be in a room that is in
 * draw/drop, must have submitted a drawing, and the target field must still be empty.
 */
export function loadJob(ctx: PCtx, field: WeaponField): GenJob | null {
  return ctx.withTx((tx) => {
    const p = tx.db.player.identity.find(ctx.sender);
    if (!p) return null;
    const r = tx.db.room.code.find(p.roomCode);
    if (!r || (r.phase !== 'draw' && r.phase !== 'drop')) return null;
    const d = tx.db.drawing.player.find(ctx.sender);
    const w = tx.db.weapon.player.find(ctx.sender);
    if (!d || !w || w[field] !== '' || (field === 'spec' && w.status !== 'pending')) return null;
    const epoch = `${r.code}:${r.round}:${r.seed}:${r.phaseStartedAt.microsSinceUnixEpoch}`;
    // Draw -> drop changes phaseStartedAt, so retain the original claim through preparation.
    const old = tx.db.generation.player.find(ctx.sender);
    if (old?.[field]) return null;
    const claim = old ?? { player: ctx.sender, epoch, spec: false, spriteUrl: false, sfxUrl: false };
    if (old) tx.db.generation.player.update({ ...claim, [field]: true });
    else tx.db.generation.insert({ ...claim, [field]: true });
    // Tell Drop's early-exit there's a spec on the way (it only waits for requested work).
    if (field === 'spec' && w.status === 'pending') tx.db.weapon.player.update({ ...w, status: 'generating' });

    const secrets: Partial<Record<SecretKey, string>> = {};
    for (const k of SECRET_KEYS) {
      const s = tx.db.secrets.key.find(k);
      if (s) secrets[k] = s.value;
    }
    let features: DrawingFeatures | null = null;
    try { features = JSON.parse(d.features) as DrawingFeatures; } catch { /* null */ }

    return {
      player: ctx.sender, playerHex: ctx.sender.toHexString(), roomCode: p.roomCode, seed: r.seed, round: r.round,
      epoch: claim.epoch, png: d.png, features, specJson: w.spec, secrets,
    };
  });
}

/**
 * Write one weapon field if it's still empty and it isn't too late:
 *  - spec: only during draw/drop — Reveal applies fallbacks the moment it starts.
 *  - sprite / sfx: also during Reveal (Drop can end after 5 s now; a 3–5 s sound or a slower
 *    sprite still makes it into the showcase and the fight). Anything later is discarded.
 */
export function writeIfStillPending(ctx: PCtx, field: WeaponField, value: string, markReady = false, job?: GenJob) {
  return ctx.withTx((tx) => {
    const w = tx.db.weapon.player.find(ctx.sender);
    const p = tx.db.player.identity.find(ctx.sender);
    const r = p && tx.db.room.code.find(p.roomCode);
    const open = field === 'spec' ? ['draw', 'drop'] : ['draw', 'drop', 'reveal'];
    if (!w || !r || !open.includes(r.phase) || w[field] !== '' || (field === 'spec' && w.status !== 'generating')) return;
    if (job) {
      const d = tx.db.drawing.player.find(ctx.sender);
      if (tx.db.generation.player.find(ctx.sender)?.epoch !== job.epoch) return;
      if (r.code !== job.roomCode || r.round !== job.round || r.seed !== job.seed ||
          !d || d.png.length !== job.png.length || d.png.some((byte, i) => byte !== job.png[i])) return;
    }
    tx.db.weapon.player.update({ ...w, [field]: value, ...(markReady ? { status: 'ready' } : {}) });
    return true;
  });
}

/**
 * Log a failed generation step: server log + a short debug_event for the ?debug overlay.
 * Never include prompts or raw model output in anything clients can read.
 */
export function logFail(ctx: PCtx, roomCode: string, what: string, err: unknown, svc?: { service: Service; provider: string }) {
  const msg = redactKeys(err instanceof Error ? err.message : String(err));
  console.warn(`[gen] ${what} failed: ${msg}`);
  try {
    ctx.withTx((tx) => {
      tx.db.debugEvent.insert({ id: 0n, roomCode, source: what, message: `failed: ${msg}`.slice(0, 300), createdAt: tx.timestamp });
      if (!svc) return;
      const row = { service: svc.service, provider: svc.provider, issue: classifyFailure(msg), detail: msg, at: tx.timestamp };
      if (tx.db.serviceStatus.service.find(svc.service)) tx.db.serviceStatus.service.update(row);
      else tx.db.serviceStatus.insert(row);
    });
  } catch { /* never break the procedure over a debug row */ }
}

/** A service worked again: clear its lobby notice. */
export function serviceOk(ctx: PCtx, service: Service) {
  try {
    ctx.withTx((tx) => { if (tx.db.serviceStatus.service.find(service)) tx.db.serviceStatus.service.delete(service); });
  } catch { /* status is best-effort */ }
}

/** Failure may clear only this request's in-flight marker, never a later round's. */
export function resetSpecJob(ctx: PCtx, job: GenJob) {
  ctx.withTx(tx => {
    const w = tx.db.weapon.player.find(ctx.sender);
    const p = tx.db.player.identity.find(ctx.sender);
    const r = p && tx.db.room.code.find(p.roomCode);
    if (w?.status === 'generating' && !w.spec && r?.code === job.roomCode && r.round === job.round && r.seed === job.seed &&
        tx.db.generation.player.find(ctx.sender)?.epoch === job.epoch) {
      tx.db.weapon.player.update({ ...w, status: 'pending' });
    }
  });
}

/** Error text with private values (key, agent URL and its host) removed. */
export function scrub(err: unknown, secrets: (string | undefined)[]): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const v of secrets) {
    if (!v) continue;
    const host = /^https?:\/\/([^/:]+)/.exec(v)?.[1];
    for (const s of [v, host]) if (s) msg = msg.split(s).join('<private>');
  }
  return msg || 'unknown error';
}
