import './style.css';
import { debug } from './debug';

debug.mount(); // no-op unless ?debug / VITE_DEBUG=1

// Tiny path router — one app, two player-facing views plus the dev playground.
const routes: Record<string, () => Promise<{ mount(el: HTMLElement): void | Promise<void> }>> = {
  '': () => import('./routes/title'),
  '/play': () => import('./routes/play'),
  '/screen': () => import('./routes/screen'),
  '/dev/weapons': () => import('./routes/dev-weapons'),
};

// Only the title page belongs in search results; controller, screen and dev pages are noindex.
if (location.pathname.replace(/\/$/, '') !== '') {
  const robots = document.createElement('meta');
  robots.name = 'robots'; robots.content = 'noindex';
  document.head.appendChild(robots);
}

const el = document.getElementById('app')!;
const load = routes[location.pathname.replace(/\/$/, '')];
const showFailure = (error: unknown) => {
  el.innerHTML = '<div class="center"><div><h1>Could not open the game</h1><p class="startup-error"></p><button id="retry-game">Retry</button><p><a href="/">Back to Doodle FFA</a></p></div></div>';
  el.querySelector('.startup-error')!.textContent = error instanceof Error ? error.message : 'Please reload and try again.';
  el.querySelector<HTMLButtonElement>('#retry-game')!.onclick = () => location.reload();
};
el.innerHTML = '<div class="center" role="status"><h1>Doodle FFA</h1><p>Opening your game…</p></div>';
void (load ?? (() => import('./routes/title')))().then(m => m.mount(el)).catch(showFailure);
