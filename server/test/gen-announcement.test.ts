import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('spacetimedb/server', () => ({ t: { string: () => ({}) } }));
vi.mock('../src/schema', () => ({ default: { procedure: (_type: unknown, fn: unknown) => fn } }));
vi.mock('../src/procedures/common', () => ({ logFail: vi.fn() }));
import { genAnnouncement } from '../src/procedures/gen_announcement';
const run = genAnnouncement as unknown as (ctx: unknown) => string;
let room: any;
let voiceRow: any;
let ctx: any;
const fetch = vi.fn();
const keyFind = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  room = { code: 'TEST', phase: 'reveal', round: 1 };
  voiceRow = undefined;
  keyFind.mockImplementation((key) => key === 'ELEVENLABS_API_KEY' ? { value: 'test-key' } : undefined);
  const tx = { timestamp: { microsSinceUnixEpoch: 1n }, db: {
    player: { identity: { find: () => ({ roomCode: 'TEST' }) } },
    room: { code: { find: () => room } },
    weapon: { player: { find: () => ({ spec: JSON.stringify({ spec: { name: 'Thunder Mallet' } }) }) } },
    weaponVoice: { player: { find: () => voiceRow, update: (row: unknown) => { voiceRow = row; } }, insert: (row: unknown) => { voiceRow = row; } },
    secrets: { key: { find: keyFind } },
  } };
  ctx = { sender: 'self', withTx: (fn: (tx: unknown) => unknown) => fn(tx), http: { fetch } };
  fetch.mockReturnValue({ ok: true, bytes: () => new Uint8Array([73, 68, 51]) });
});

it('speaks the server-owned weapon name and caches the result for replay', () => {
  expect(run(ctx)).toBe('data:audio/mpeg;base64,SUQz');
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ text: 'Your weapon is Thunder Mallet!', model_id: 'eleven_flash_v2_5' });
  expect(run(ctx)).toBe('data:audio/mpeg;base64,SUQz');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects announcements before reveal without calling the provider', () => {
  room.phase = 'draw';
  expect(run(ctx)).toBe('');
  expect(fetch).not.toHaveBeenCalled();
});
it('prevents concurrent generation for a pending request', () => {
  voiceRow = { roomCode: 'TEST', round: 1, name: 'Thunder Mallet', status: 'pending', requestedAt: { microsSinceUnixEpoch: 1n } };
  expect(run(ctx)).toBe('');
  expect(fetch).not.toHaveBeenCalled();
});
it('discards a response when the round changed during generation', () => {
  fetch.mockImplementation(() => { room.round++; return { ok: true, bytes: () => new Uint8Array([1]) }; });
  expect(run(ctx)).toBe('');
  expect(voiceRow.status).toBe('pending');
});
it('supports a configured voice and recovers from a failed request', () => {
  keyFind.mockImplementation((key) => ({ value: key === 'ELEVENLABS_API_KEY' ? 'test-key' : 'custom-voice' }));
  fetch.mockReturnValueOnce({ ok: false, status: 401 });
  expect(run(ctx)).toBe('');
  expect(voiceRow.status).toBe('failed');
  expect(run(ctx)).toBe('data:audio/mpeg;base64,SUQz');
  expect(fetch.mock.calls[0]![0]).toContain('/text-to-speech/custom-voice?');
});
it('strips whitespace from the key and configured voice', () => {
  keyFind.mockImplementation((key) => ({ value: key === 'ELEVENLABS_API_KEY' ? 'test-key\t ' : 'custom-voice\t ' }));
  run(ctx);
  expect(fetch.mock.calls[0]![1].headers['xi-api-key']).toBe('test-key');
  expect(fetch.mock.calls[0]![0]).toContain('/text-to-speech/custom-voice?');
});
it('supports announcements during the phone weapon display in Drop', () => {
  room.phase = 'drop';
  expect(run(ctx)).toBe('data:audio/mpeg;base64,SUQz');
  room.phase = 'reveal';
  expect(run(ctx)).toBe('data:audio/mpeg;base64,SUQz');
  expect(fetch).toHaveBeenCalledOnce();
});
