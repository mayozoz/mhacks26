/** Full white until authoritative expiry; only the recovery fades. Scoped to battle views. */
export function blindOpacity(now: number, until: number) {
  return until > 0 ? Math.min(1, Math.max(0, 1 + (until - now) / 0.25)) : 0;
}

export function mountAbilityBlindness(
  host: HTMLElement,
  read: () => { now: number; until: number; battle: boolean },
) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: '#fff',
    pointerEvents: 'none',
    zIndex: '9999',
    opacity: '0',
  });
  overlay.setAttribute('aria-hidden', 'true');
  host.appendChild(overlay);
  let raf = 0;
  const frame = () => {
    const s = read();
    overlay.style.opacity = String(s.battle ? blindOpacity(s.now, s.until) : 0);
    raf = requestAnimationFrame(frame);
  };
  frame();
  return () => {
    cancelAnimationFrame(raf);
    overlay.remove();
  };
}
