/** An automatic reel with smooth acceleration, a long slowdown, and aligned tick feedback. */
export function spinAbilityReel(track: HTMLElement, selected: HTMLElement, pointer: HTMLElement, done: () => void) {
  const first = track.children[0] as HTMLElement;
  const distance = selected.offsetLeft - first.offsetLeft;
  const pitch = (track.children[1] as HTMLElement).offsetLeft - first.offsetLeft;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 250 : 4200;
  let frame = 0, active = true, started: number | undefined;
  let lastTicket = 0, lastPulse = -Infinity, vibrating = false;
  const vibrate = (pattern: number | number[]) => {
    if (document.hidden || typeof navigator.vibrate !== 'function') return;
    try { vibrating = navigator.vibrate(pattern); } catch { /* visual feedback remains */ }
  };
  const stopVibration = () => {
    if (vibrating && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(0); } catch { /* unsupported */ }
    }
    vibrating = false;
  };
  const visibility = () => { if (document.hidden) stopVibration(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', stopVibration);
  vibrate(18);
  const tick = (now: number) => {
    if (!active) return;
    started ??= now;
    const t = Math.min(1, (now - started) / duration);
    // Zero speed at both ends, with most of the travel early and a gentle final settle.
    const progress = reduced ? 1 : 1 - (1 - t) ** 3 * (1 + 3 * t);
    track.style.transform = `translate3d(${-distance * progress}px, 0, 0)`;
    const ticket = Math.round(distance * progress / Math.max(1, pitch));
    if (!reduced && ticket !== lastTicket && now - lastPulse >= 65 && !document.hidden) {
      lastPulse = now;
      pointer.animate([{ transform: 'translateX(-50%) rotate(-12deg)' }, { transform: 'translateX(-50%) rotate(0)' }], { duration: 110 });
      vibrate(t > .8 ? 18 : 8);
    }
    lastTicket = ticket;
    if (t < 1) frame = requestAnimationFrame(tick);
    else {
      selected.classList.add('is-selected');
      if (!reduced) selected.animate([{ scale: .96 }, { scale: 1.06 }, { scale: 1 }], { duration: 360, easing: 'ease-out' });
      vibrate([35, 45, 65]);
      done();
    }
  };
  frame = requestAnimationFrame(tick);
  return () => {
    active = false; cancelAnimationFrame(frame); stopVibration();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', stopVibration);
  };
}
