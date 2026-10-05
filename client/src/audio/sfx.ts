import type { Archetype } from '@doodle/spec';

// Decode once, then create a source per attack so simultaneous sounds can overlap.
let context: AudioContext | undefined;
const cache = new Map<string, Promise<AudioBuffer | null>>();
let listening = false;
const readyListeners = new Set<() => void>();

/** Resume directly from a tap, before any network request or other await. */
export async function resumeAudio(): Promise<boolean> {
  try {
    const ctx = audioContext();
    const wasRunning = ctx.state === 'running';
    await ctx.resume();
    if (ctx.state !== 'running') return false;
    if (!wasRunning) for (const ready of readyListeners) ready();
    return true;
  } catch { return false; }
}

export function onAudioReady(ready: () => void) {
  readyListeners.add(ready);
  return () => readyListeners.delete(ready);
}

function audioContext() {
  return context ??= new AudioContext();
}

/** A controller gesture (Join, drawing, or joystick) enables phone audio. */
export function enableAudio() {
  if (listening) return;
  listening = true;
  const unlock = () => {
    void resumeAudio();
  };
  // touchend/click also cover mobile browsers that do not unlock on pointerdown.
  for (const event of ['pointerdown', 'touchend', 'click', 'keydown']) {
    document.addEventListener(event, unlock, { capture: true, passive: true });
  }
}

function load(src: string): Promise<AudioBuffer | null> {
  let pending = cache.get(src);
  if (!pending) {
    pending = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`Audio HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => audioContext().decodeAudioData(bytes))
      .catch(() => {
        // Permit a retry next round; never block gameplay on audio failure.
        cache.delete(src);
        return null;
      });
    cache.set(src, pending);
  }
  return pending;
}

const preset = (archetype: Archetype) => `/sfx/${archetype}.wav`;

export function preloadWeaponSound(archetype: Archetype, sfxUrl?: string) {
  void load(preset(archetype));
  if (sfxUrl) void load(sfxUrl);
}

function playBuffer(buffer: AudioBuffer, volume: number): (() => void) | null {
  const ctx = audioContext();
  // Do not queue attacks while autoplay is locked, then burst on the next tap.
  if (ctx.state !== 'running') return null;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start();
  return () => { try { source.stop(); } catch { /* already ended */ } };
}

/** Narration can be cancelled when the controller changes phase. */
export async function playVoice(src: string, stillRelevant: () => boolean): Promise<(() => void) | null> {
  const buffer = await load(src);
  if (!buffer || !stillRelevant()) return null;
  return playBuffer(buffer, 0.85);
}

export async function playWeaponSound(archetype: Archetype, sfxUrl?: string) {
  if (audioContext().state !== 'running') return;
  const buffer = (sfxUrl ? await load(sfxUrl) : null) ?? await load(preset(archetype));
  if (buffer) playBuffer(buffer, 0.65);
}

/** Local feedback on every controller button press, even during cooldown. */
export function click() {
  const ctx = audioContext();
  void ctx.resume().then(async () => {
    const buffer = await load('/sfx/click.wav');
    if (buffer) playBuffer(buffer, 0.4);
  }).catch(() => {});
}

export type CountdownCue = 'tick' | 'last' | 'go';

/**
 * Countdown cues, synthesized on the fly (no files): a short blip each second, a higher one on
 * the final second, and a bright chord when the fight starts. Silent until audio is unlocked.
 */
export function countdownCue(kind: CountdownCue) {
  const ctx = audioContext();
  if (ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const tone = (freq: number, start: number, dur: number, type: OscillatorType, vol: number) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(t0 + start); osc.stop(t0 + start + dur + 0.02);
  };
  if (kind === 'tick') tone(880, 0, 0.09, 'sine', 0.22);
  else if (kind === 'last') tone(1320, 0, 0.18, 'sine', 0.28);
  else {
    tone(523, 0, 0.55, 'square', 0.07); tone(659, 0, 0.55, 'square', 0.06);
    tone(784, 0.04, 0.6, 'square', 0.06); tone(1047, 0.08, 0.6, 'triangle', 0.16);
  }
}
