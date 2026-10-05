import { describe, expect, it, vi } from 'vitest';
import { classifyFailure, httpError, redactKeys } from '../src/lib/service-status';
import { logFail, serviceOk, type PCtx } from '../src/procedures/common';

describe('service failure classification', () => {
  it.each([
    ['Image provider HTTP 402: Your prepayment credits are depleted.', 'credits'],
    ['Image provider HTTP 403: {"code":"permission-denied","error":"Your team has either used all available credits"}', 'credits'],
    ['ElevenLabs HTTP 401: {"detail":{"status":"quota_exceeded"}}', 'credits'],
    ['Image provider HTTP 429: RESOURCE_EXHAUSTED quota limit 0', 'credits'],
    ['asi1 HTTP 429: Too Many Requests', 'rate_limit'],
    ['asi1 HTTP 401: invalid api key', 'auth'],
    ['Image provider HTTP 400: {"code":"invalid-argument","error":"Incorrect API key provided."}', 'auth'],
    ['XAI_API_KEY is not configured', 'unconfigured'],
    ['refusing to connect to private or special-purpose addresses', 'unreachable'],
    ['request timed out', 'timeout'],
    ['ElevenLabs HTTP 503: upstream', 'provider_down'],
    ['Invalid sprite image response', 'error'],
  ])('%s → %s', (msg, kind) => expect(classifyFailure(msg)).toBe(kind));

  it('keeps a body snippet and never a key', () => {
    const err = httpError('xAI', { status: 403, text: () => '  team blocked:\n no credits  ' });
    expect(err.message).toBe('xAI HTTP 403: team blocked: no credits');
    expect(redactKeys('bad key xai-AbCdEfGhIjKlMnOpQrSt and sk_0123456789abcdef0123')).toBe('bad key <redacted> and <redacted>');
  });
});

describe('service_status rows', () => {
  function ctx() {
    const rows = new Map<string, any>();
    const tx = { timestamp: 't', db: {
      debugEvent: { insert: vi.fn() },
      serviceStatus: { service: {
        find: (k: string) => rows.get(k), update: (r: any) => rows.set(r.service, r), delete: (k: string) => rows.delete(k),
      }, insert: (r: any) => rows.set(r.service, r) },
    } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return { rows, ctx: { withTx: (fn: any) => fn(tx) } as unknown as PCtx };
  }
  it('records the latest problem per service and clears it on success', () => {
    const s = ctx();
    logFail(s.ctx, 'ROOM', 'gen_sprite', new Error('Image provider HTTP 402: credits depleted'), { service: 'weapon_art', provider: 'Gemini' });
    expect(s.rows.get('weapon_art')).toMatchObject({ provider: 'Gemini', issue: 'credits' });
    logFail(s.ctx, 'ROOM', 'gen_sprite', new Error('request timed out'), { service: 'weapon_art', provider: 'Gemini' });
    expect(s.rows.get('weapon_art').issue).toBe('timeout');
    serviceOk(s.ctx, 'weapon_art');
    expect(s.rows.has('weapon_art')).toBe(false);
  });
  it('leaves the status table alone for plain debug failures', () => {
    const s = ctx();
    logFail(s.ctx, 'ROOM', 'gen_sprite', new Error('Invalid sprite image response'));
    expect(s.rows.size).toBe(0);
  });
});
