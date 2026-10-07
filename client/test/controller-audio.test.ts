import { beforeEach, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({ playWeaponSound: vi.fn(), preloadWeaponSound: vi.fn(), playVoice: vi.fn(), onAudioReady: vi.fn() }));
vi.mock('../src/audio/sfx', () => audio);
vi.mock('../src/debug', () => ({ debug: { track: (_name: string, promise: Promise<string>) => promise, error: vi.fn() } }));
import { ControllerAudio } from '../src/routes/play/audio';
import type { PlayCtx } from '../src/routes/play/types';

beforeEach(() => { vi.clearAllMocks(); audio.playVoice.mockResolvedValue(vi.fn()); });
function setup() {
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const identity = { isEqual: (other: unknown) => other === identity };
  const room = { code: 'TEST', round: 1, phase: 'battle' };
  const weapon = { player: identity, sfxUrl: 'custom.mp3', spec: JSON.stringify({ spec: { name: 'Thunder Mallet', archetype: 'slam' } }) };
  const table = (name: string, row?: unknown) => ({
    onUpdate: (fn: (...args: any[]) => void) => { callbacks[`${name}Update`] = fn; },
    onInsert: (fn: (...args: any[]) => void) => { callbacks[`${name}Insert`] = fn; },
    player: { find: () => row }, code: { find: () => row },
  });
  const generate = vi.fn(async () => 'speech.mp3');
  const ctx = { identity, roomCode: 'TEST', conn: {
    db: { fighter: table('fighter'), weapon: table('weapon', weapon), room: table('room', room) },
    procedures: { genAnnouncement: generate },
  } } as unknown as PlayCtx;
  return { coordinator: new ControllerAudio(ctx), callbacks, room, weapon, generate, identity };
}

it('plays only the local player’s confirmed attack, using that weapon’s unique sound', () => {
  const { callbacks, identity } = setup();
  const old = { lastAttackAt: { microsSinceUnixEpoch: 1n } };
  const fighter = { player: identity, roomCode: 'TEST', lastAttackAt: { microsSinceUnixEpoch: 2n } };
  callbacks.fighterUpdate!(null, old, { ...fighter, player: { isEqual: () => false } });
  expect(audio.playWeaponSound).not.toHaveBeenCalled();
  callbacks.fighterUpdate!(null, old, fighter);
  expect(audio.playWeaponSound).toHaveBeenCalledWith('slam', 'custom.mp3');
  callbacks.fighterUpdate!(null, fighter, fighter);
  expect(audio.playWeaponSound).toHaveBeenCalledTimes(1);
});

it('announces once per round and replays from cache on request', async () => {
  const { coordinator, generate, room } = setup();
  room.phase = 'reveal';
  await coordinator.announce();
  await coordinator.announce();
  expect(audio.playVoice).toHaveBeenCalledTimes(1);
  await coordinator.announce(true);
  expect(audio.playVoice).toHaveBeenCalledTimes(2);
  expect(generate).toHaveBeenCalledTimes(1);
  room.round++;
  await coordinator.announce();
  expect(generate).toHaveBeenCalledTimes(2);
});

it('does not play a late announcement after the round ends', async () => {
  const { coordinator, generate, room } = setup();
  let resolve!: (url: string) => void;
  generate.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const pending = coordinator.announce();
  room.phase = 'results';
  resolve('speech.mp3');
  expect(await pending).toBe(false);
  expect(audio.playVoice).not.toHaveBeenCalled();
});

it('preloads the local weapon and stops narration outside reveal/battle', async () => {
  const { coordinator, room } = setup();
  const stop = vi.fn();
  audio.playVoice.mockResolvedValue(stop);
  await coordinator.announce();
  room.phase = 'results';
  coordinator.sync();
  expect(audio.preloadWeaponSound).toHaveBeenCalledWith('slam', 'custom.mp3');
  expect(stop).toHaveBeenCalledTimes(1);
});

it('retries cached speech when a phone gesture resumes audio', async () => {
  const { coordinator, generate, room } = setup();
  room.phase = 'reveal';
  audio.playVoice.mockResolvedValueOnce(null);
  expect(await coordinator.announce()).toBe(false);
  await audio.onAudioReady.mock.calls[0]![0]();
  await vi.waitFor(() => expect(audio.playVoice).toHaveBeenCalledTimes(2));
  expect(generate).toHaveBeenCalledTimes(1);
});

it('retries a failed Reveal request once when Battle begins', async () => {
  const { coordinator, generate, room } = setup();
  room.phase = 'reveal';
  generate.mockResolvedValueOnce('');
  expect(await coordinator.announce()).toBe(false);
  await coordinator.announce();
  expect(generate).toHaveBeenCalledTimes(1);
  room.phase = 'battle';
  expect(await coordinator.announce()).toBe(true);
  expect(generate).toHaveBeenCalledTimes(2);
});
it('announces on the weapon display during Drop and stops when deployment opens', async () => {
  const { coordinator, room, generate } = setup();
  room.phase = 'drop';
  coordinator.sync();
  expect(generate).not.toHaveBeenCalled();
  const stop = vi.fn();
  audio.playVoice.mockResolvedValue(stop);
  coordinator.setWeaponDisplay(true);
  await vi.waitFor(() => expect(audio.playVoice).toHaveBeenCalledTimes(1));
  coordinator.setWeaponDisplay(false);
  expect(stop).toHaveBeenCalledOnce();
  room.phase = 'reveal';
  await coordinator.announce();
  expect(generate).toHaveBeenCalledOnce();
  expect(audio.playVoice).toHaveBeenCalledOnce();
});
it('discards late speech after leaving the weapon display for deployment', async () => {
  const { coordinator, generate, room } = setup();
  room.phase = 'drop';
  let resolve!: (url: string) => void;
  generate.mockImplementation(() => new Promise(r => { resolve = r; }));
  coordinator.setWeaponDisplay(true);
  coordinator.setWeaponDisplay(false);
  resolve('speech.mp3');
  await Promise.resolve(); await Promise.resolve();
  expect(audio.playVoice).not.toHaveBeenCalled();
});
