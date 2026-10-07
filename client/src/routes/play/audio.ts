import { type StoredWeapon } from '@doodle/spec';
import { onAudioReady, playVoice, playWeaponSound, preloadWeaponSound } from '../../audio/sfx';
import { debug } from '../../debug';
import type { PlayCtx } from './types';

/** One controller owns one audio stream; the shared monitor has no weapon audio. */
export class ControllerAudio {
  private requested = '';
  private requestedPhase = '';
  private played = '';
  private cached: { key: string; url: string } | null = null;
  private pending: { key: string; promise: Promise<string> } | null = null;
  private stopVoice: (() => void) | null = null;
  private voiceVersion = 0;
  private weaponDisplay = false;

  setWeaponDisplay(visible: boolean) {
    this.weaponDisplay = visible;
    this.sync();
  }

  private canAnnounce(phase: string) {
    return ['reveal', 'battle'].includes(phase) || (phase === 'drop' && this.weaponDisplay);
  }

  constructor(private ctx: PlayCtx) {
    const { conn, identity } = ctx;
    onAudioReady(() => {
      // A suspended context can skip Reveal speech. Replay the cached clip on
      // the next phone gesture, without generating another announcement.
      if (this.cached && this.cached.key !== this.played && !this.pending) void this.announce(true);
    });
    conn.db.fighter.onUpdate((_e, old, f) => {
      if (!f.player.isEqual(identity) || f.roomCode !== ctx.roomCode) return;
      if (conn.db.room.code.find(ctx.roomCode)?.phase !== 'battle') return;
      if (f.lastAttackAt.microsSinceUnixEpoch === old.lastAttackAt.microsSinceUnixEpoch) return;
      const w = conn.db.weapon.player.find(identity);
      if (w?.spec) {
        const stored = JSON.parse(w.spec) as StoredWeapon;
        void playWeaponSound(stored.spec.archetype, w.sfxUrl);
      }
    });
    conn.db.weapon.onInsert((_e, w) => { if (w.player.isEqual(identity)) this.sync(); });
    conn.db.weapon.onUpdate((_e, _old, w) => { if (w.player.isEqual(identity)) this.sync(); });
    conn.db.room.onUpdate((_e, _old, r) => { if (r.code === ctx.roomCode) this.sync(); });
  }

  sync() {
    const { conn, identity, roomCode } = this.ctx;
    const r = conn.db.room.code.find(roomCode);
    const w = conn.db.weapon.player.find(identity);
    if (w?.spec) {
      const stored = JSON.parse(w.spec) as StoredWeapon;
      preloadWeaponSound(stored.spec.archetype, w.sfxUrl);
    } else if (w?.sfxUrl) {
      preloadWeaponSound('swing', w.sfxUrl);
    }
    if (r && this.canAnnounce(r.phase)) void this.announce();
    else {
      this.voiceVersion++;
      this.stopVoice?.();
      this.stopVoice = null;
    }
  }

  async announce(replay = false): Promise<boolean> {
    const { conn, identity, roomCode } = this.ctx;
    const room = conn.db.room.code.find(roomCode);
    const w = conn.db.weapon.player.find(identity);
    if (!room || !w?.spec || !this.canAnnounce(room.phase)) return false;
    const name = (JSON.parse(w.spec) as StoredWeapon).spec.name;
    const key = `${roomCode}:${room.round}:${name}`;
    if (!replay && this.played === key) return true;
    if (!replay && this.requested === key && (this.pending || this.requestedPhase === room.phase)) return false;
    this.requested = key;
    this.requestedPhase = room.phase;
    const version = ++this.voiceVersion;
    const relevant = () => {
      const r = conn.db.room.code.find(roomCode);
      return this.voiceVersion === version && r?.round === room.round && r.code === this.ctx.roomCode
        && this.canAnnounce(r.phase);
    };
    this.stopVoice?.();
    this.stopVoice = null;
    try {
      let url = this.cached?.key === key ? this.cached.url : '';
      if (!url) {
        if (this.pending?.key !== key) {
          this.pending = { key, promise: debug.track('gen_announcement', conn.procedures.genAnnouncement({})) };
        }
        const pending = this.pending;
        try { url = await pending.promise; }
        finally { if (this.pending === pending) this.pending = null; }
        if (url) this.cached = { key, url };
      }
      if (!url) {
        debug.error('weapon announcement', 'No speech returned. Tap Hear weapon to retry.');
        return false;
      }
      if (!relevant()) return false;
      const stop = await playVoice(url, relevant);
      if (!stop) {
        debug.error('weapon announcement', 'Phone audio is paused or speech could not be decoded. Tap Hear weapon.');
        return false;
      }
      this.stopVoice = stop;
      this.played = key;
      return true;
    } catch (e) {
      debug.error('weapon announcement', e instanceof Error ? e.message : String(e));
      return false;
    }
  }
}
