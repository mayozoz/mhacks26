import { mountMenuMusic } from '../audio/menu-music';
import { mount as mountModes } from './modes';
import './title.css';

export function mount(el: HTMLElement) {
  document.title = 'Doodle FFA — Draw. Roll. Brawl.';
  el.innerHTML = `<main class="title-page">
    <header class="title-nav"><a class="title-brand" href="/" aria-label="Doodle FFA home"><span aria-hidden="true">✳</span> DOODLE FFA</a><div class="title-nav-actions"><button class="title-help">How to play</button><button class="title-music" aria-pressed="false">Music off</button></div></header>
    <section class="title-stage" aria-labelledby="game-title">
      <div class="title-copy"><span class="title-kicker"><i></i> A LITTLE DOODLE. A LOT OF CHAOS.</span><h1 id="game-title"><span>Doodle</span><strong>FFA<span class="title-spark" aria-hidden="true">✶</span></strong></h1><p class="title-tagline">Your doodle. Your weapon.<br>Everyone’s problem.</p><button class="title-start">Start game <span aria-hidden="true">↗</span></button><span class="title-enter">or press <kbd>Enter</kbd></span></div>
      <figure class="title-art"><div class="title-art-orbit" aria-hidden="true"></div><img src="/menu/ghost-squad.png" alt="Three colorful ghost fighters carrying a blaster, a giant sword, and a hammer" fetchpriority="high"><figcaption>draw something dangerous.</figcaption></figure>
    </section>
    <section class="title-modes" hidden aria-label="Choose a game mode"></section>
    <footer class="title-footer"><div class="title-steps"><span><b>01</b> DRAW</span><i>→</i><span><b>02</b> ROLL</span><i>→</i><span><b>03</b> BRAWL</span></div><span class="title-footer-note">One doodle. Endless possibilities.</span></footer>
    <dialog class="title-instructions"><button class="title-close" aria-label="Close instructions">✕</button><span class="title-kicker">THE RULES ARE SIMPLE</span><h2>Make a mess.<br>Win the fight.</h2><ol><li><strong>Draw your weapon.</strong> You have 20 seconds. A sword? A banana? Make it yours.</li><li><strong>Roll your special.</strong> Learn your ability and weapon, then pick your deployment spot.</li><li><strong>Be the last one standing.</strong> Move, attack, and use your special before the arena closes in.</li></ol><p>Scan the QR code or open the room link on your phone.<br>Draw on your phone, then use its joystick and attack buttons to play.</p><button class="title-got-it">Got it. Let’s play.</button></dialog>
  </main>`;
  const page = el.querySelector<HTMLElement>('.title-page')!;
  const music = mountMenuMusic(el.querySelector<HTMLButtonElement>('.title-music')!);
  const dialog = el.querySelector<HTMLDialogElement>('dialog')!;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    music.start();
    el.querySelector<HTMLElement>('.title-stage')!.hidden = true;
    const modes = el.querySelector<HTMLElement>('.title-modes')!;
    modes.hidden = false;
    mountModes(modes);
    page.classList.add('has-started');
    modes.querySelector<HTMLAnchorElement>('.mode-card')?.focus();
  };
  el.querySelector<HTMLButtonElement>('.title-start')!.onclick = start;
  el.querySelector<HTMLButtonElement>('.title-help')!.onclick = () => dialog.showModal();
  el.querySelector<HTMLButtonElement>('.title-close')!.onclick = () => dialog.close();
  el.querySelector<HTMLButtonElement>('.title-got-it')!.onclick = () => { dialog.close(); start(); };
  const enter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.repeat || dialog.open || (event.target instanceof Element && event.target.closest('a, button, input'))) return;
    event.preventDefault(); start();
  };
  document.addEventListener('keydown', enter);
}
