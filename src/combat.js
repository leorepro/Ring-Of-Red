// ============================================================
//  combat.js — engagement-layer state machine & math
//  Ring of Red-style ~90s AFW duel with locational damage:
//  aim at 6 body parts (head / torso / arms / legs), each with its own
//  "coordination", different damage & consequences. The reticle sways
//  across the parts (torso lingers most); arms fire the guns, legs move,
//  head is lethal. Plus heat, timer, dodge, shells, pilot skill, infantry.
// ============================================================

export const RANGES = ['SHORT', 'MEDIUM', 'LONG'];
export const PARTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];

// normalized aim layout (x = right, y = up); also drives the HUD markers
export const PART_POS = {
  head:  { x: 0.00, y: 1.30 },
  torso: { x: 0.00, y: 0.45 },
  armL:  { x: -0.98, y: 0.60 },
  armR:  { x: 0.98, y: 0.60 },
  legL:  { x: -0.42, y: -0.75 },
  legR:  { x: 0.42, y: -0.75 },
};

// per-part: label, AFW-HP multiplier, coordination damage, hit radius
// (radii kept tight, with gaps between parts, so off-aim shots actually miss)
export const PART_CFG = {
  head:  { zh: '頭部', mult: 2.2, coDmg: 60, size: 0.26 },
  torso: { zh: '軀幹', mult: 1.0, coDmg: 20, size: 0.50 },
  armL:  { zh: '左手', mult: 0.55, coDmg: 48, size: 0.38 },
  armR:  { zh: '右手', mult: 0.55, coDmg: 48, size: 0.38 },
  legL:  { zh: '左腳', mult: 0.6, coDmg: 45, size: 0.42 },
  legR:  { zh: '右腳', mult: 0.6, coDmg: 45, size: 0.42 },
};

const RANGE_CFG = {
  SHORT:  { ceil: 98, ramp: 46, dmg: 40, sway: 0.5 },
  MEDIUM: { ceil: 92, ramp: 36, dmg: 28, sway: 1.0 },
  LONG:   { ceil: 82, ramp: 27, dmg: 20, sway: 1.7 },
};

// switchable weapons; main cannon is unlimited, specials carry limited ammo.
// kind: how the shot resolves; mods tweak aim/heat/reload; dmg is a multiplier
// on the range base damage.
export const WEAPONS = [
  { id: 'cannon',  zh: '主砲', proj: 'shell',   ammo: Infinity, kind: 'single', dmg: 1.0, reload: 3.4, heat: 34, ramp: 1.0, ceil: 0,   zoom: 0 },
  { id: 'sniper',  zh: '狙擊', proj: 'shell',   ammo: 6,        kind: 'sniper', dmg: 2.4, reload: 4.4, heat: 26, ramp: 1.7, ceil: 6,   zoom: 0.28 },
  { id: 'mg',      zh: '機槍', proj: 'mg',      ammo: 4,        kind: 'burst',  dmg: 0.16, reload: 2.2, heat: 12, ramp: 1.0, ceil: -28, zoom: 0 },
  { id: 'missile', zh: '飛彈', proj: 'missile', ammo: 4,        kind: 'splash', dmg: 1.3, reload: 4.6, heat: 22, ramp: 0.85, ceil: -4, zoom: 0 },
  { id: 'shrap',   zh: '榴散', proj: 'shrap',   ammo: 5,        kind: 'multi',  dmg: 0.7, reload: 3.4, heat: 24, ramp: 1.1, ceil: -12, zoom: 0 },
  { id: 'rail',    zh: '軌道', proj: 'rail',    ammo: 2,        kind: 'pierce', dmg: 3.6, reload: 6.0, heat: 42, ramp: 1.3, ceil: 10,  zoom: 0.34 },
];
const WEP = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const weaponDef = (id) => WEP[id] || WEP.cannon;
const ADJ = {
  head: ['torso'], torso: ['armL', 'armR', 'head'], armL: ['torso'], armR: ['torso'],
  legL: ['torso', 'legR'], legR: ['torso', 'legL'],
};
const initAmmo = () => ({ sniper: 6, mg: 4, missile: 4, shrap: 5, rail: 2 });

const NIGHT_PENALTY = 10;
const HEAT_AIM = 13, HEAT_FIRE = 34, HEAT_COOL = 22, HEAT_RECOVER = 32;
const RELOAD_TIME = 3.4, ENEMY_RELOAD = 2.9, MOVE_TIME = 1.6;
const DODGE_WINDOW = 1.25, ENEMY_FIRE_FLASH = 0.45, INF_INTERVAL = 1.0;

const CLASS = {
  Infantry: { side: 'AP', role: 'F.Guard', zh: '步兵' },
  Recon:    { side: 'AP', role: 'F.Guard', zh: '偵察' },
  Medic:    { side: 'AP', role: 'R.Guard', zh: '醫療' },
  Shooter:  { side: 'AT', role: 'F.Guard', zh: '射手' },
  Supply:   { side: 'AT', role: 'R.Guard', zh: '補給' },
  Mechanic: { side: 'AT', role: 'R.Guard', zh: '工兵' },
};
const SQUADS = { me: ['Shooter', 'Supply', 'Mechanic'], foe: ['Shooter', 'Infantry', 'Medic'] };
const mkSquad = (names) => names.map((name) => ({
  name, zh: CLASS[name].zh, role: CLASS[name].role, side: CLASS[name].side, down: false,
}));

const mkParts = () => ({
  head: { co: 100 }, torso: { co: 100 },
  armL: { co: 100 }, armR: { co: 100 }, legL: { co: 100 }, legR: { co: 100 },
});

export function createState() {
  const night = false;          // daytime only
  const land = [5, 10, 15][Math.floor(Math.random() * 3)];
  return {
    phase: 'battle',
    time: 90, t: 0,
    nextRangeDir: 'in',
    env: { range: 'MEDIUM', night, land },
    aim: { x: 0, y: 0.45 },        // current reticle position (over enemy)
    me: {
      hp: 300, maxHp: 300,
      acc: 0, heat: 0, overheat: false, reload: 0,
      infantry: 16, maxInf: 16, star: 3, pilot: 3,
      squad: mkSquad(SQUADS.me), parts: mkParts(),
      shell: 'AT', max: 1, maxArmed: false,
      targetPart: 'torso',         // which enemy part we're aiming at
      weapon: 'cannon', ammo: initAmmo(),
    },
    foe: {
      hp: 200, maxHp: 200,
      acc: 0, charge: 0, reload: 0,
      infantry: 16, maxInf: 16, star: 2, pilot: 2,
      squad: mkSquad(SQUADS.foe), parts: mkParts(),
    },
    moving: 0, dodge: 0, pendingFoeAcc: 0, infTick: 0,
    flash: { me: 0, foe: 0 },
    banner: { text: '', kind: '', t: 0 },
    fx: [],
  };
}

// ---- capabilities gated by part coordination ----
export function caps(unit) {
  const p = unit.parts;
  return {
    canMove: !(p.legL.co <= 0 && p.legR.co <= 0),
    canFire: !(p.armL.co <= 0 && p.armR.co <= 0),
    armsDown: (p.armL.co <= 0 ? 1 : 0) + (p.armR.co <= 0 ? 1 : 0),
    legsDown: (p.legL.co <= 0 ? 1 : 0) + (p.legR.co <= 0 ? 1 : 0),
  };
}

function passives(unit) {
  const has = (n) => unit.squad.some((s) => s.name === n && !s.down);
  return {
    afwDmg: has('Shooter') ? 1.18 : 1,
    reload: has('Supply') ? 0.72 : 1,
    afwRegen: has('Mechanic') ? 0.5 : 0,
    infRegen: has('Medic') ? 1.0 : 0,
    aim: has('Recon') ? 1.15 : 1,
    apPower: has('Infantry') ? 1.5 : 1,
  };
}
const atSquads = (unit) => unit.squad.filter((s) => !s.down && s.side === 'AT').length;

function ceiling(env, unit) {
  let c = RANGE_CFG[env.range].ceil + (env.land - 5) * 0.4;
  if (env.night) c -= NIGHT_PENALTY;
  if (unit && caps(unit).armsDown === 1) c -= 12;   // one good arm = shakier aim
  return Math.max(20, Math.min(99, c));
}
// player accuracy ceiling, including the current weapon's modifier
function meCeil(state) {
  return Math.max(20, Math.min(99, ceiling(state.env, state.me) + weaponDef(state.me.weapon).ceil));
}

export function rangeSway(state) {
  const base = RANGE_CFG[state.env.range].sway * (state.env.night ? 1.4 : 1);
  const c = meCeil(state);
  return base * (1 - 0.85 * (state.me.acc / c));
}

function setBanner(state, text, kind, t = 1.1) { state.banner = { text, kind, t }; }
const rand = (a, b) => a + Math.random() * (b - a);

// which part the reticle is currently over (null = clean miss)
function hitPart(aim) {
  let best = null, bestScore = Infinity;
  for (const p of PARTS) {
    const pp = PART_POS[p];
    const score = Math.hypot(aim.x - pp.x, aim.y - pp.y) - PART_CFG[p].size;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return bestScore <= 0 ? best : null;
}

function damagePart(unit, part, baseDmg, acc01, maxShot) {
  const cfg = PART_CFG[part];
  unit.parts[part].co = Math.max(0, unit.parts[part].co - cfg.coDmg * (0.7 + Math.random() * 0.6));
  const hpDmg = Math.round(baseDmg * cfg.mult);
  unit.hp = Math.max(0, unit.hp - hpDmg);
  if (part === 'head' && (unit.parts.head.co <= 0 || Math.random() < (maxShot ? 0.6 : 0.22 * acc01))) {
    unit.hp = 0;   // decapitation / cockpit kill
  }
  return hpDmg;
}

// ---- player intents ----

export function setTarget(state, part) {
  if (state.phase === 'battle' && PART_CFG[part]) state.me.targetPart = part;
}
export function cycleTarget(state) {
  const i = PARTS.indexOf(state.me.targetPart);
  state.me.targetPart = PARTS[(i + 1) % PARTS.length];
}

export function cycleWeapon(state) {
  if (state.phase !== 'battle') return;
  const me = state.me;
  const avail = WEAPONS.filter((w) => w.ammo === Infinity || (me.ammo[w.id] || 0) > 0);
  const i = avail.findIndex((w) => w.id === me.weapon);
  me.weapon = avail[(i + 1) % avail.length].id;
  me.acc = 0;                                   // re-acquire after switching
  setBanner(state, `切換武器 — ${weaponDef(me.weapon).zh}`, 'me', 0.9);
}
function switchToCannon(state) {
  state.me.weapon = 'cannon';
  setBanner(state, '彈藥用罄 — 切回主砲', 'hit', 1.0);
}

export function tryFire(state) {
  const me = state.me;
  if (state.phase !== 'battle' || state.moving > 0) return;
  const cap = caps(me);
  if (!cap.canFire) { setBanner(state, '雙臂損壞 — 無法射擊', 'hit', 1.1); return; }
  if (me.reload > 0 || me.overheat || me.acc < 1) return;
  const W = weaponDef(me.weapon);
  if (W.ammo !== Infinity && (me.ammo[W.id] || 0) <= 0) { switchToCannon(state); return; }

  const pas = passives(me);
  const acc01 = me.acc / meCeil(state);
  const baseR = RANGE_CFG[state.env.range].dmg;
  let maxShot = false;
  if (me.maxArmed) { maxShot = true; me.maxArmed = false; }

  state.flash.me = 0.12;
  state.fx.push({ type: 'fire', side: 'me', weapon: W.id });
  if (W.ammo !== Infinity) me.ammo[W.id] = Math.max(0, me.ammo[W.id] - 1);

  let shotFx = null;
  if (W.id === 'cannon' && me.shell === 'AP') {
    const inf = Math.round(rand(5, 9) * (maxShot ? 1.8 : 1));
    state.foe.infantry = Math.max(0, state.foe.infantry - inf);
    state.foe.hp = Math.max(0, state.foe.hp - Math.round(baseR * 0.25));
    if (Math.random() < 0.6) knockSquad(state.foe);
    shotFx = { type: 'shot', side: 'me', weapon: 'cannon', part: 'torso', hit: true, shrapnel: true };
    state.fx.push(shotFx);
    setBanner(state, `對人彈命中 — 敵步兵 −${inf}`, 'me', 1.0);
  } else if (W.kind === 'burst') {
    // machine gun: a spray of pellets scattered across the silhouette
    let total = 0, last = null;
    for (let i = 0; i < 9; i++) {
      const part = hitPart({ x: state.aim.x + (Math.random() - 0.5) * 0.9, y: state.aim.y + (Math.random() - 0.5) * 0.9 });
      if (part) { total += damagePart(state.foe, part, baseR * W.dmg * pas.afwDmg, acc01, false); last = part; }
    }
    state.foe.infantry = Math.max(0, state.foe.infantry - rand(3, 6));
    shotFx = { type: 'shot', side: 'me', weapon: 'mg', part: last, hit: total > 0, burst: true };
    state.fx.push(shotFx);
    setBanner(state, total > 0 ? `機槍掃射 −${total}` : '機槍掃射 — 落空', 'me', 1.0);
  } else if (W.kind === 'multi') {
    // shrapnel: aim part + a couple of nearby parts at once
    const set = new Set(); const a = hitPart(state.aim); if (a) set.add(a);
    set.add(PARTS[Math.floor(Math.random() * PARTS.length)]);
    set.add(PARTS[Math.floor(Math.random() * PARTS.length)]);
    let total = 0;
    for (const part of set) total += damagePart(state.foe, part, baseR * W.dmg * pas.afwDmg, acc01, false);
    state.foe.infantry = Math.max(0, state.foe.infantry - rand(4, 8));
    shotFx = { type: 'shot', side: 'me', weapon: 'shrap', part: a || 'torso', hit: set.size > 0, multi: true };
    state.fx.push(shotFx);
    setBanner(state, `榴散彈 −${total}（${set.size} 部位）`, 'me', 1.0);
  } else {
    // single-target: cannon / sniper / missile(splash) / rail(pierce)
    const part = maxShot ? me.targetPart : hitPart(state.aim);
    if (part) {
      const crit = W.kind === 'pierce' || part === 'head' || maxShot
        || (W.id === 'sniper' && Math.random() < 0.6) || Math.random() < 0.1;
      const base = baseR * (0.85 + Math.random() * 0.3) * pas.afwDmg * W.dmg * (crit ? 1.6 : 1);
      let dmg = damagePart(state.foe, part, base, acc01, maxShot);
      if (W.kind === 'splash') for (const ap of (ADJ[part] || [])) dmg += damagePart(state.foe, ap, base * 0.4, acc01, false);
      if (W.kind === 'pierce' && part !== 'torso') dmg += damagePart(state.foe, 'torso', base * 0.5, acc01, false);
      shotFx = { type: 'shot', side: 'me', weapon: W.id, part, hit: true, crit };
      state.fx.push(shotFx);
      if (Math.random() < 0.25) knockSquad(state.foe);
      const co = Math.round(state.foe.parts[part].co);
      setBanner(state, `${crit ? '爆擊！' : '命中'} ${PART_CFG[part].zh} −${dmg}（協調 ${co}%）`, 'me', 1.0);
    } else {
      state.fx.push({ type: 'shot', side: 'me', weapon: W.id, part: null, hit: false });
      setBanner(state, '失準 — 擦過', 'evade', 0.8);
    }
  }

  if (state.foe.hp <= 0 && state.phase === 'battle') { if (shotFx) shotFx.kill = true; finisher(state, 'win'); }

  me.acc = 0;
  me.reload = W.reload * pas.reload * (cap.armsDown === 1 ? 1.4 : 1);
  me.heat = Math.min(100, me.heat + W.heat);
  if (W.ammo !== Infinity && me.ammo[W.id] <= 0 && state.phase === 'battle') switchToCannon(state);
}

export function tryDodge(state) {
  if (state.phase !== 'battle' || state.dodge <= 0) return;
  state.dodge = 0;
  state.pendingFoeAcc = 0;
  state.foe.charge = 0;
  state.foe.reload = ENEMY_RELOAD;
  state.me.acc = 0;
  state.me.heat = Math.min(100, state.me.heat + 10);
  state.fx.push({ type: 'evade' });
  setBanner(state, '迴避成功 EVADED', 'evade', 1.0);
}

export function tryMove(state) {
  if (state.phase !== 'battle' || state.moving > 0 || state.me.reload > 0) return;
  if (!caps(state.me).canMove) { setBanner(state, '雙腿損壞 — 無法移動', 'hit', 1.1); return; }
  const i = RANGES.indexOf(state.env.range);
  const next = state.nextRangeDir === 'in' ? Math.max(0, i - 1) : Math.min(2, i + 1);
  if (next === i) { state.nextRangeDir = state.nextRangeDir === 'in' ? 'out' : 'in'; return tryMove(state); }
  state._moveTarget = RANGES[next];
  state.moving = MOVE_TIME;
  state.me.acc = 0;
}

export function trySkill(state) {
  const me = state.me;
  if (state.phase !== 'battle' || me.max <= 0 || me.maxArmed) return;
  me.max -= 1; me.maxArmed = true;
  setBanner(state, '必殺技 構え — 鎖定 ' + PART_CFG[me.targetPart].zh, 'me', 1.3);
}

export function tryShell(state) {
  if (state.phase !== 'battle') return;
  const me = state.me;
  me.shell = me.shell === 'AT' ? 'AP' : 'AT';
  setBanner(state, me.shell === 'AT' ? '切換・對甲彈' : '切換・對人彈', 'me', 0.8);
}

function knockSquad(unit) {
  const alive = unit.squad.filter((s) => !s.down);
  if (alive.length) {
    alive[Math.floor(Math.random() * alive.length)].down = true;
    unit.infantry = Math.max(0, unit.infantry - (3 + Math.floor(Math.random() * 4)));
  }
}

function endBattle(state, outcome) { state.phase = outcome; state.dodge = 0; }

// The killing blow plays out in bullet-time: freeze the sim into an 'ending'
// phase and let the finishing shell fly in slow motion before the result.
function finisher(state, outcome) {
  state.phase = 'ending';
  state.endResult = outcome;
  state.killLanded = false;
  state.endStart = 0;          // set to wall-clock when the ending branch begins
  state.dodge = 0;
}

// ---- main tick ----

export function update(state, dt) {
  if (state.phase !== 'battle') return;
  state.t += dt;
  if (state.banner.t > 0) state.banner.t -= dt;

  state.time -= dt;
  if (state.time <= 0) {
    state.time = 0;
    const mine = state.me.hp / state.me.maxHp, theirs = state.foe.hp / state.foe.maxHp;
    endBattle(state, mine >= theirs ? 'win' : 'lose');
    return;
  }

  const me = state.me, foe = state.foe, env = state.env;
  const mp = passives(me), fp = passives(foe);

  if (mp.afwRegen) me.hp = Math.min(me.maxHp, me.hp + mp.afwRegen * dt);
  if (fp.afwRegen) foe.hp = Math.min(foe.maxHp, foe.hp + fp.afwRegen * dt);
  if (mp.infRegen) me.infantry = Math.min(me.maxInf, me.infantry + mp.infRegen * dt);
  if (fp.infRegen) foe.infantry = Math.min(foe.maxInf, foe.infantry + fp.infRegen * dt);

  if (state.moving > 0) {
    state.moving -= dt;
    if (state.moving <= 0) {
      state.moving = 0; env.range = state._moveTarget;
      const i = RANGES.indexOf(env.range);
      if (i === 0) state.nextRangeDir = 'out'; else if (i === 2) state.nextRangeDir = 'in';
    }
  }

  if (me.reload > 0) me.reload = Math.max(0, me.reload - dt);

  const canAim = me.reload <= 0 && state.moving <= 0 && !me.overheat && caps(me).canFire;
  if (me.overheat) {
    me.heat = Math.max(0, me.heat - HEAT_COOL * dt);
    me.acc = 0;
    if (me.heat <= HEAT_RECOVER) me.overheat = false;
  } else if (canAim) {
    const c = meCeil(state);
    const cfg = RANGE_CFG[env.range];
    const skill = 0.65 + 0.18 * me.pilot;
    const rate = cfg.ramp * (0.4 + 0.6 * (1 - me.acc / c)) * skill * mp.aim * weaponDef(me.weapon).ramp;
    me.acc = Math.min(c, me.acc + rate * dt);
    me.heat = Math.min(100, me.heat + HEAT_AIM * dt);
    if (me.heat >= 100) { me.overheat = true; me.acc = 0; }
  } else {
    me.heat = Math.max(0, me.heat - HEAT_COOL * dt);
  }

  updateAim(state, dt);
  updateEnemy(state, dt);

  state.infTick += dt;
  if (state.infTick >= INF_INTERVAL) { state.infTick -= INF_INTERVAL; infantryExchange(state, mp, fp); }

  if (state.dodge > 0) {
    state.dodge -= dt;
    if (state.dodge <= 0) { state.dodge = 0; resolveEnemyShot(state); }
  }
  if (state.flash.foe > 0) state.flash.foe = Math.max(0, state.flash.foe - dt);
  if (state.flash.me > 0) state.flash.me = Math.max(0, state.flash.me - dt);
}

// reticle drift: springs toward the chosen part, but a marching, low-accuracy
// gun lets the sway wander across head / arms / legs — with a torso bias so it
// lingers on the body most.
function updateAim(state, dt) {
  const me = state.me, env = state.env;
  const c = meCeil(state);
  const acc01 = Math.min(1, me.acc / c);
  const tgt = PART_POS[me.targetPart];
  const cx = tgt.x * 0.72 + PART_POS.torso.x * 0.28;     // torso bias
  const cy = tgt.y * 0.72 + PART_POS.torso.y * 0.28;
  let amp = 0.7 - 0.6 * acc01;                            // gentler aim wander
  if (state.moving > 0) amp *= 1.4;                       // advancing spreads the aim
  if (me.overheat || me.reload > 0) amp *= 1.15;
  if (me.maxArmed) amp *= 0.22;                           // Maximum Attack steadies aim
  const T = state.t;
  const sx = (Math.sin(T * 1.9) + 0.5 * Math.sin(T * 3.3 + 1)) * amp;
  const sy = (Math.cos(T * 1.5) + 0.5 * Math.sin(T * 3.9)) * amp * 0.82;
  state.aim.x = cx + sx;
  state.aim.y = cy + sy;
}

// the part the reticle is currently over (what would be hit) — for HUD hinting
export function currentHitPart(state) { return hitPart(state.aim); }

function infantryExchange(state, mp, fp) {
  const me = state.me, foe = state.foe;
  if (me.infantry > 0 && foe.hp > 0) {
    foe.infantry = Math.max(0, foe.infantry - rand(0.4, 1.0));
    const at = atSquads(me);
    if (at > 0) {
      foe.hp = Math.max(0, foe.hp - at * rand(0.6, 1.4) * (me.infantry / me.maxInf));
      state.fx.push({ type: 'inffire', side: 'me' });
      if (foe.hp <= 0) return endBattle(state, 'win');
    }
  }
  if (foe.infantry > 0 && me.hp > 0) {
    me.infantry = Math.max(0, me.infantry - rand(0.6, 1.4) * fp.apPower);
    const at = atSquads(foe);
    if (at > 0) {
      me.hp = Math.max(0, me.hp - at * rand(0.6, 1.2) * (foe.infantry / foe.maxInf));
      if (me.hp <= 0) return endBattle(state, 'lose');
    }
    state.fx.push({ type: 'inffire', side: 'foe' });
  }
}

function updateEnemy(state, dt) {
  const foe = state.foe, env = state.env;
  if (!caps(foe).canFire) return;                 // both enemy arms destroyed
  if (foe.reload > 0) { foe.reload = Math.max(0, foe.reload - dt); return; }
  if (state.dodge > 0) return;

  const c = ceiling(env, foe);
  const skill = 0.8 + 0.14 * foe.pilot;
  const speed = (18 + (RANGES.indexOf(env.range) === 0 ? 6 : 0)) * skill;
  foe.charge = Math.min(100, foe.charge + speed * dt);
  foe.acc = Math.min(c, (foe.charge / 100) * c);

  if (foe.charge >= 100) {
    foe.charge = 0;
    state.pendingFoeAcc = foe.acc;
    state.dodge = DODGE_WINDOW;
    state.flash.foe = ENEMY_FIRE_FLASH;
    setBanner(state, 'ENEMY AFW — FIRE', 'foe', DODGE_WINDOW);
  }
}

// enemy targets one of OUR parts (torso most often, head rarely)
function enemyTargetPart() {
  const r = Math.random();
  if (r < 0.45) return 'torso';
  if (r < 0.58) return 'legL';
  if (r < 0.71) return 'legR';
  if (r < 0.83) return 'armL';
  if (r < 0.94) return 'armR';
  return 'head';
}

function resolveEnemyShot(state) {
  const foe = state.foe;
  state.flash.foe = 0.12;
  const hit = Math.random() * 100 < state.pendingFoeAcc;
  const part = enemyTargetPart();
  const shotFx = { type: 'shot', side: 'foe', part, hit };
  state.fx.push(shotFx);
  if (hit) {
    const crit = part === 'head' || Math.random() < 0.07;
    const base = RANGE_CFG[state.env.range].dmg * 1.08 * (0.8 + Math.random() * 0.4) * (crit ? 1.5 : 1);
    const acc01 = state.pendingFoeAcc / 100;
    const dmg = damagePart(state.me, part, base, acc01, false);
    shotFx.crit = crit;
    setBanner(state, `${crit ? '爆擊！' : ''}${PART_CFG[part].zh}被命中 −${dmg}`, 'hit', 1.0);
    if (Math.random() < 0.3) knockSquad(state.me);
    if (state.me.hp <= 0) { shotFx.kill = true; finisher(state, 'lose'); }
  } else {
    setBanner(state, '對方失準 MISS', 'evade', 0.9);
  }
  state.pendingFoeAcc = 0;
  foe.reload = ENEMY_RELOAD;
}
