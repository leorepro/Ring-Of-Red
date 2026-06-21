// ============================================================
//  main.js — bootstrap, game loop, screen flow
//  RING of RED · engagement-layer prototype (Three.js)
// ============================================================
import { World } from './world.js';
import { Hud } from './hud.js';
import { bindControls } from './input.js';
import { createState, update, tryFire, tryDodge, tryMove, trySkill } from './combat.js';

const world = new World(document.getElementById('scene'));
const hud = new Hud();

let state = createState();
let running = false;

bindControls({
  fire: () => running && tryFire(state),
  dodge: () => running && tryDodge(state),
  move: () => running && tryMove(state),
  skill: () => running && trySkill(state),
});

// ---- screen flow ----
const titleEl = document.getElementById('title');
const resultEl = document.getElementById('result');

function startBattle() {
  state = createState();
  titleEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  hud.show();
  running = true;
}

function finish() {
  running = false;
  const win = state.phase === 'win';
  const tEl = document.getElementById('result-title');
  tEl.textContent = win ? 'TARGET DESTROYED' : (state.me.hp <= 0 ? 'AFW LOST' : 'TIME UP');
  tEl.className = 'result-title ' + (win ? 'win' : 'lose');
  document.getElementById('result-sub').textContent = win
    ? '敵 AFW 已擊毀 — 你在板機與過熱之間賭贏了這一場。'
    : (state.me.hp <= 0 ? '本機被擊毀。下次更早收手去迴避那記高命中。' : '時間耗盡 — 以殘存戰力判定，未能壓制敵機。');
  resultEl.classList.remove('hidden');
}

document.getElementById('start').addEventListener('click', startBattle);
document.getElementById('again').addEventListener('click', startBattle);

// orientation hint — this game is designed for portrait, so nudge
// phone players who are holding the device in landscape.
const rotateEl = document.getElementById('rotate');
function checkOrient() {
  const landscape = window.innerWidth > window.innerHeight;
  const phone = Math.min(window.innerWidth, window.innerHeight) < 520;
  rotateEl.classList.toggle('hidden', !(landscape && phone));
}
window.addEventListener('resize', checkOrient);
window.addEventListener('orientationchange', checkOrient);
checkOrient();

// ---- main loop ----
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05); // clamp after tab-switch / hitches

  if (running) {
    update(state, dt);
    hud.render(state);
    if (state.phase !== 'battle') finish();
  }
  world.update(state, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
