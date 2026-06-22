// ============================================================
//  main.js — bootstrap, game loop, screen flow
//  RING of RED · engagement-layer prototype (Three.js)
// ============================================================
import { World } from './world.js';
import { Hud } from './hud.js';
import { bindControls } from './input.js';
import { audio } from './audio.js';
import { createState, update, tryFire, tryDodge, tryMove, trySkill, tryShell, tryHalt, setTarget, cycleTarget, cycleWeapon, PARTS, PART_CFG } from './combat.js';

const world = new World(document.getElementById('scene'));
const hud = new Hud();

let state = createState();
let running = false;

hud.onTarget = (part) => { if (running) setTarget(state, part); };

bindControls({
  fire: () => running && tryFire(state),
  dodge: () => running && tryDodge(state),
  move: () => { if (running) { audio.ui(); tryMove(state); } },
  skill: () => { if (running) { audio.ui(); trySkill(state); } },
  shell: () => { if (running) { audio.ui(); tryShell(state); } },
  target: () => { if (running) { audio.ui(); cycleTarget(state); } },
  weapon: () => { if (running) { audio.switchW(); cycleWeapon(state); } },
  halt: () => { if (running) { audio.ui(); tryHalt(state); } },
});

// ---- anime pilot cut-in (slides in on dramatic beats, with a cooldown) ----
const cutin = {
  el: document.getElementById('cutin'),
  nameEl: document.getElementById('cutin-name'),
  textEl: document.getElementById('cutin-text'),
  timer: 0, cool: 0,
  show(name, text, shout = false) {
    if (this.cool > 0) return;
    this.nameEl.textContent = name; this.textEl.textContent = text;
    this.el.classList.toggle('shout', shout);
    this.el.classList.add('shown'); this.el.classList.remove('out');
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.timer = 2.3; this.cool = 3.6;
  },
  hide() {
    this.el.classList.remove('in'); this.el.classList.add('out');
    setTimeout(() => { this.el.classList.remove('shown', 'out'); }, 320);
  },
  tick(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (this.timer > 0) { this.timer -= dt; if (this.timer <= 0) this.hide(); }
  },
};

// unlock audio on the first user gesture (mobile autoplay policy)
const unlock = () => audio.resume();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ---- screen flow ----
const titleEl = document.getElementById('title');
const resultEl = document.getElementById('result');

function startBattle() {
  audio.resume();
  state = createState();
  titleEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  document.getElementById('cine').classList.remove('show');
  document.body.classList.remove('ending');
  cutin.el.classList.remove('shown', 'in', 'out');
  cutin.timer = 0; cutin.cool = 0; prevMax = false; prevDodge = false;
  hud.show();
  running = true;
}

function finish() {
  running = false;
  const win = state.phase === 'win';
  win ? audio.win() : audio.lose();
  const tEl = document.getElementById('result-title');
  tEl.textContent = win ? 'TARGET DESTROYED' : (state.me.hp <= 0 ? 'AFW LOST' : 'TIME UP');
  tEl.className = 'result-title ' + (win ? 'win' : 'lose');
  document.getElementById('result-sub').textContent = win
    ? '敵 AFW 已擊毀 — 你在板機與過熱之間賭贏了這一場。'
    : (state.me.hp <= 0 ? '本機被擊毀。下次更早收手去迴避那記高命中。' : '時間耗盡 — 以殘存戰力判定，未能壓制敵機。');
  document.getElementById('battle-result').innerHTML = battleResult(state);
  document.getElementById('cine').classList.remove('show');
  document.body.classList.remove('ending');
  resultEl.classList.remove('hidden');
}

// Battle Result — wear ratios + final per-part damage status for both AFWs
function battleResult(state) {
  const partStatus = (co) => co <= 0 ? '<b class="st-dead">Destroyed</b>'
    : co < 50 ? '<b class="st-dmg">Damaged</b>' : '<b class="st-ok">Normal</b>';
  const supportRows = (u) => u.squad.map((s) => {
    const hp = Math.max(0, Math.ceil(s.hp));
    const cls = s.down || hp <= 0 ? 'st-dead' : hp / s.maxHp < 0.35 ? 'st-dmg' : 'st-ok';
    const txt = s.down || hp <= 0 ? 'Down' : `${hp}/${s.maxHp}`;
    return `<div class="br-row br-sup"><span>${s.zh}</span><b class="${cls}">${txt}</b><i>${s.role.replace('.Guard', '')}</i></div>`;
  }).join('');
  const side = (u, name) => {
    const hp = `${Math.ceil(u.hp)}/${u.maxHp}`;
    const wreck = Math.round((1 - u.hp / u.maxHp) * 100);
    const rows = PARTS.map((p) =>
      `<div class="br-row"><span>${PART_CFG[p].zh}</span>${partStatus(u.parts[p].co)}<i>${Math.round(u.parts[p].co)}%</i></div>`).join('');
    const hpCls = u.hp <= 0 ? 'br-hp dead' : (u.hp / u.maxHp < 0.35 ? 'br-hp low' : 'br-hp');
    return `<div class="br-col">
      <div class="br-name">${name}</div>
      <div class="${hpCls}">AFW Body <b>${hp}</b></div>
      <div class="br-wreck">耗損 ${wreck}%</div>
      ${rows}
      <div class="br-inf">步兵殘存 ${Math.ceil(u.infantry)}/${u.maxInf}</div>
      <div class="br-support">${supportRows(u)}</div>
    </div>`;
  };
  return `<div class="br-head">BATTLE RESULT</div>
    <div class="br-grid">${side(state.me, 'Weizegger')}<div class="br-vs">VS</div>${side(state.foe, 'Loyal Army')}</div>`;
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
const ENDING_DURATION = 10.0;  // bullet-time length for the killing blow (~10s)
const SLOW = 0.14;             // world time scale during the slow-mo finish
const cine = document.getElementById('cine');

const PILOT = '九鬼 隊長';
// fire dramatic pilot cut-ins from this frame's combat events
function pilotCutins() {
  if (!running) return;
  if (state.fx) {
    for (const e of state.fx) {
      if (e.type === 'shot' && e.side === 'me' && e.kill) cutin.show(PILOT, '結束了——！', true);
      else if (e.type === 'shot' && e.side === 'foe' && e.kill) cutin.show(PILOT, '到此為止…了嗎。', false);
      else if (e.type === 'shot' && e.side === 'me' && e.crit) cutin.show(PILOT, '正中要害！', true);
      else if (e.type === 'shot' && e.side === 'foe' && e.crit) cutin.show(PILOT, '可惡…裝甲被打穿！', true);
    }
  }
  if (state.me.maxArmed && !prevMax) cutin.show(PILOT, '必殺・全力一擊！', true);
  prevMax = state.me.maxArmed;
  if (state.dodge > 0 && !prevDodge) cutin.show(PILOT, '來了——迴避！', true);
  prevDodge = state.dodge > 0;
}

let last = performance.now();
let prevOverheat = false, prevMax = false, prevDodge = false;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05); // clamp after tab-switch / hitches

  if (running) {
    if (state.phase === 'battle') {
      update(state, dt);
      if (state.me.overheat && !prevOverheat) audio.overheat();
      prevOverheat = state.me.overheat;
      hud.render(state);
      // 'ending' (a gun finisher, possibly set from input or enemy AI) is
      // handled by the ending branch next frame; only immediate ends finish now
      if (state.phase !== 'battle' && state.phase !== 'ending') finish();
    } else if (state.phase === 'ending') {
      // killing blow in bullet-time: letterbox on, freeze sim, let the
      // finishing shell fly in slow motion, then resolve after ~5s wall-clock
      cine.classList.add('show');
      document.body.classList.add('ending');
      if (!state.endStart) state.endStart = now;
      hud.render(state);
      if (now - state.endStart >= ENDING_DURATION * 1000) { state.phase = state.endResult; finish(); }
    }
  }
  pilotCutins();          // read combat events before the world drains state.fx
  cutin.tick(dt);
  const worldDt = (running && state.phase === 'ending') ? dt * SLOW : dt;
  world.update(state, worldDt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
