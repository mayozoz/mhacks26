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
  let allowed = true;
  const update = () => {
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('data-playing', String(!audio.paused));
    button.innerHTML = `<span class="music-bars" aria-hidden="true"><i></i><i></i><i></i></span><span>Music ${enabled ? 'on' : 'off'}</span>`;
    button.title = enabled ? 'Mute menu music' : 'Play menu music';
  };
  const play = () => {
    if (!enabled || !active || !allowed || document.hidden) return;
    void audio.play().then(() => { if (!active || !enabled || !allowed || document.hidden) audio.pause(); update(); }).catch(() => {
      if (active) { update(); button.title = 'Tap to retry menu music'; }
    });
  };
  const toggle = () => {
    // If autoplay was blocked, an enabled button should retry on this tap.
    if (enabled && allowed && audio.paused) { play(); return; }
    enabled = !enabled;
    try { localStorage.setItem(PREFERENCE, enabled ? 'on' : 'off'); } catch { /* private browsing */ }
    if (enabled) play(); else audio.pause();
    update();
  };
  const visibility = () => {
    if (document.hidden) { resumeWhenVisible = !audio.paused; audio.pause(); }
    else if (resumeWhenVisible) { resumeWhenVisible = false; play(); }
  };
  // Back/forward cache restores the existing page, so keep its player and listeners alive.
  const pageHide = () => audio.pause();
  const pageShow = () => play();
  // First tap/key anywhere starts the music (the music button itself toggles instead).
  const firstGesture = (e: Event) => {
    if (audio.paused && !button.contains(e.target as Node)) play();
  };
  const gestures = ['pointerdown', 'keydown', 'touchend'] as const;
  const removeGesture = () => gestures.forEach((g) => document.removeEventListener(g, firstGesture, true));
  const playing = () => { removeGesture(); update(); };
  gestures.forEach((g) => document.addEventListener(g, firstGesture, true));
  button.addEventListener('click', toggle);
  audio.addEventListener('play', playing);
  audio.addEventListener('pause', update);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  update();
  play(); // works right away when the browser already allows sound for this site
  return {
    start: play,
    setAllowed(value: boolean) {
      allowed = value;
      if (allowed) play(); else audio.pause();
    },
    destroy() {
      active = false; removeGesture(); audio.pause(); audio.removeAttribute('src'); audio.load();
      button.removeEventListener('click', toggle);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('pageshow', pageShow);
      audio.removeEventListener('play', playing); audio.removeEventListener('pause', update);
    },
  };
}
