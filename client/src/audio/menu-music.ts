const TRACK = '/music/doodle-ffa-menu.mp3';
const PREFERENCE = 'doodle.menu-music';

/**
 * Music defaults to on. Browsers only allow sound after the first tap or key press, so the
 * button shows the setting ("Music on"), and playback starts on the first gesture anywhere.
 */
export function mountMenuMusic(button: HTMLButtonElement) {
  let enabled = true;
  try { enabled = localStorage.getItem(PREFERENCE) !== 'off'; } catch { /* private browsing */ }
  const audio = new Audio(TRACK);
  audio.loop = true;
  audio.volume = .26;
  audio.preload = 'none';
  let active = true, resumeWhenVisible = false;
  const update = () => {
    button.setAttribute('aria-pressed', String(enabled));
    button.innerHTML = `<span class="music-bars" aria-hidden="true"><i></i><i></i><i></i></span><span>Music ${enabled ? 'on' : 'off'}</span>`;
    button.title = enabled ? 'Mute menu music' : 'Play menu music';
  };
  const play = () => {
    if (!enabled || !active) return;
    void audio.play().then(() => { if (!active || !enabled || document.hidden) audio.pause(); update(); }).catch(() => {
      if (active) { update(); button.title = 'Tap to retry menu music'; }
    });
  };
  const toggle = () => {
    enabled = !enabled;
    try { localStorage.setItem(PREFERENCE, enabled ? 'on' : 'off'); } catch { /* private browsing */ }
    if (enabled) play(); else audio.pause();
    update();
  };
  const visibility = () => {
    if (document.hidden) { resumeWhenVisible = !audio.paused; audio.pause(); }
    else if (resumeWhenVisible) { resumeWhenVisible = false; play(); }
  };
  // First tap/key anywhere starts the music (the music button itself toggles instead).
  let heardGesture = false;
  const firstGesture = (e: Event) => {
    if (heardGesture) return;
    heardGesture = true; removeGesture();
    if (!button.contains(e.target as Node)) play();
  };
  const gestures = ['pointerdown', 'keydown', 'touchend'] as const;
  const removeGesture = () => gestures.forEach((g) => document.removeEventListener(g, firstGesture, true));
  gestures.forEach((g) => document.addEventListener(g, firstGesture, true));
  button.addEventListener('click', toggle);
  audio.addEventListener('play', update);
  audio.addEventListener('pause', update);
  document.addEventListener('visibilitychange', visibility);
  update();
  play(); // works right away when the browser already allows sound for this site
  return {
    start: play,
    destroy() {
      active = false; removeGesture(); audio.pause(); audio.removeAttribute('src'); audio.load();
      button.removeEventListener('click', toggle);
      document.removeEventListener('visibilitychange', visibility);
      audio.removeEventListener('play', update); audio.removeEventListener('pause', update);
    },
  };
}
