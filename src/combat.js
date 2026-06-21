// ============================================================
//  combat.js — engagement-layer state machine & math
//  A faithful-as-possible recreation of Ring of Red's ~90s AFW duel:
//  accuracy ramp × heat/overheat × timer × duel/dodge, plus pilot skill,
//  anti-armour/anti-personnel shells, Maximum Attacks, and the six
//  infantry classes (anti-soldier vs anti-mech) fighting automatically.
// ============================================================

export const RANGES = ['SHORT', 'MEDIUM', 'LONG'];

// per-range tuning: accuracy ceiling, ramp speed, AFW damage, aim sway
const RANGE_CFG = {
  SHORT:  { ceil: 98, ramp: 46, dmg: 96, sway: 0.5 },
  MEDIUM: { ceil: 92, ramp: 36, dmg: 64, sway: 1.0 },
  LONG:   { ceil: 82, ramp: 27, dmg: 44, sway: 1.7 },
};

const NIGHT_PENALTY = 10;   // night drops the accuracy ceiling
const HEAT_AIM = 13;        // heat/sec while holding aim
const HEAT_FIRE = 34;       // heat added per shot
const HEAT_COOL = 22;       // heat lost/sec when not aiming
const HEAT_RECOVER = 32;    // overheat clears below this
const RELOAD_TIME = 3.4;    // base seconds to reload main gun
const ENEMY_RELOAD = 2.9;   // enemy reloads a touch faster (keeps pressure)
const MOVE_TIME = 1.6;      // seconds to change range
const DODGE_WINDOW = 1.25;  // reaction window to evade
const ENEMY_FIRE_FLASH = 0.45;
const INF_INTERVAL = 1.0;   // seconds between infantry crossfire exchanges

// The six canonical infantry classes. side: AP = anti-soldier, AT = anti-mech.
const CLASS = {
  Infantry: { side: 'AP', role: 'F.Guard', zh: '步兵' },
  Recon:    { side: 'AP', role: 'F.Guard', zh: '偵察' },
  Medic:    { side: 'AP', role: 'R.Guard', zh: '醫療' },
  Shooter:  { side: 'AT', role: 'F.Guard', zh: '射手' },
  Supply:   { side: 'AT', role: 'R.Guard', zh: '補給' },
  Mechanic: { side: 'AT', role: 'R.Guard', zh: '工兵' },
};

// Player rides an anti-mech trio (a dedicated AFW-killer); the generic
// enemy fields an anti-personnel trio that chews your infantry.
const SQUADS = {
  me:  ['Shooter', 'Supply', 'Mechanic'],
  foe: ['Shooter', 'Infantry', 'Medic'],
};

const mkSquad = (names) => names.map((name) => ({
  name, zh: CLASS[name].zh, role: CLASS[name].role, side: CLASS[name].side, down: false,
}));

export function createState() {
  const night = Math.random() < 0.5;
  const land = [5, 10, 15][Math.floor(Math.random() * 3)];
  return {
    phase: 'battle',            // battle | win | lose
    time: 90,
    nextRangeDir: 'in',
    env: { range: 'MEDIUM', night, land },
    me: {
      hp: 374, maxHp: 374,
      acc: 0, heat: 0, overheat: false, reload: 0,
      infantry: 16, maxInf: 16, star: 3, pilot: 3,    // pilot skill ★
      squad: mkSquad(SQUADS.me),
      shell: 'AT',              // current ammo: AT (anti-armour) / AP (anti-personnel)
      max: 1, maxArmed: false,  // Maximum Attack charges
    },
    foe: {
      hp: 430, maxHp: 430,
      acc: 0, charge: 0, reload: 0,
      infantry: 16, maxInf: 16, star: 2, pilot: 2,
      squad: mkSquad(SQUADS.foe),
    },
    moving: 0,
    dodge: 0,
    pendingFoeAcc: 0,
    infTick: 0,
    flash: { me: 0, foe: 0 },
    banner: { text: '', kind: '', t: 0 },
    fx: [],
  };
}

// passive bonuses contributed by a unit's surviving squads
function passives(unit) {
  const has = (n) => unit.squad.some((s) => s.name === n && !s.down);
  return {
    afwDmg: has('Shooter') ? 1.18 : 1,     // Shooter: more power vs AFW
    reload: has('Supply') ? 0.72 : 1,      // Supply: faster reload
    afwRegen: has('Mechanic') ? 0.5 : 0,   // Mechanic: slowly repairs the AFW
    infRegen: has('Medic') ? 1.0 : 0,      // Medic: heals own infantry
    aim: has('Recon') ? 1.15 : 1,          // Recon: draws aim faster
    apPower: has('Infantry') ? 1.5 : 1,    // Infantry: stronger anti-soldier fire
  };
}

// how many anti-mech ground squads a unit still has (chip the enemy AFW)
const atSquads = (unit) => unit.squad.filter((s) => !s.down && s.side === 'AT').length;

function ceiling(env) {
  let c = RANGE_CFG[env.range].ceil + (env.land - 5) * 0.4;
  if (env.night) c -= NIGHT_PENALTY;
  return Math.max(20, Math.min(99, c));
}

export function rangeSway(state) {
  const base = RANGE_CFG[state.env.range].sway * (state.env.night ? 1.4 : 1);
  const c = ceiling(state.env);
  return base * (1 - 0.85 * (state.me.acc / c));
}

function setBanner(state, text, kind, t = 1.1) { state.banner = { text, kind, t }; }
const rand = (a, b) => a + Math.random() * (b - a);

// ---- player intents ----

export function tryFire(state) {
  const me = state.me;
  if (state.phase !== 'battle' || state.moving > 0) return;
  if (me.reload > 0 || me.overheat || me.acc < 1) return;

  const pas = passives(me);
  let acc = me.acc;
  let maxShot = false;
  if (me.maxArmed) { acc = Math.max(acc, 96); maxShot = true; me.maxArmed = false; }

  const hit = Math.random() * 100 < acc;
  state.flash.me = 0.12;
  state.fx.push({ type: 'fire', side: 'me', hit });
  setBanner(state, maxShot ? '必殺・直擊射撃！' : 'PLAYER AFW — VS AFW FIRE', 'me', maxShot ? 1.1 : 0.7);

  if (hit) {
    const base = RANGE_CFG[state.env.range].dmg * (0.85 + Math.random() * 0.3);
    if (me.shell === 'AT') {
      let dmg = Math.round(base * pas.afwDmg * (maxShot ? 1.7 : 1));
      state.foe.hp = Math.max(0, state.foe.hp - dmg);
      state.fx.push({ type: 'impact', side: 'foe', dmg });
      if (Math.random() < 0.3) knockSquad(state.foe);
    } else {
      // anti-personnel: shreds enemy infantry & squads, light vs armour
      const inf = Math.round(rand(5, 9) * (maxShot ? 1.8 : 1));
      state.foe.infantry = Math.max(0, state.foe.infantry - inf);
      const dmg = Math.round(base * 0.28);
      state.foe.hp = Math.max(0, state.foe.hp - dmg);
      state.fx.push({ type: 'impact', side: 'foe', dmg, shrapnel: true });
      if (Math.random() < 0.6) knockSquad(state.foe);
      setBanner(state, `對人彈命中 — 敵步兵 −${inf}`, 'me', 1.0);
    }
    if (state.foe.hp <= 0) endBattle(state, 'win');
  } else {
    state.fx.push({ type: 'miss', side: 'foe' });
  }
  me.acc = 0;
  me.reload = RELOAD_TIME * pas.reload;
  me.heat = Math.min(100, me.heat + HEAT_FIRE);
}

export function tryDodge(state) {
  if (state.phase !== 'battle' || state.dodge <= 0) return;
  state.dodge = 0;
  state.pendingFoeAcc = 0;
  state.foe.charge = 0;
  state.foe.reload = RELOAD_TIME;
  state.me.acc = 0;
  state.me.heat = Math.min(100, state.me.heat + 10);
  state.fx.push({ type: 'evade' });
  setBanner(state, '迴避成功 EVADED', 'evade', 1.0);
}

export function tryMove(state) {
  if (state.phase !== 'battle' || state.moving > 0 || state.me.reload > 0) return;
  const i = RANGES.indexOf(state.env.range);
  const next = state.nextRangeDir === 'in' ? Math.max(0, i - 1) : Math.min(2, i + 1);
  if (next === i) {
    state.nextRangeDir = state.nextRangeDir === 'in' ? 'out' : 'in';
    return tryMove(state);
  }
  state._moveTarget = RANGES[next];
  state.moving = MOVE_TIME;
  state.me.acc = 0;
}

// Maximum Attack — the pilot's signature: arm a near-certain, heavy shot.
export function trySkill(state) {
  const me = state.me;
  if (state.phase !== 'battle' || me.max <= 0 || me.maxArmed) return;
  me.max -= 1;
  me.maxArmed = true;
  setBanner(state, '必殺技 構え — 下一發必中重擊', 'me', 1.3);
}

// toggle ammunition between anti-armour and anti-personnel
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

// ---- main tick ----

export function update(state, dt) {
  if (state.phase !== 'battle') return;

  if (state.banner.t > 0) state.banner.t -= dt;

  state.time -= dt;
  if (state.time <= 0) {
    state.time = 0;
    const mine = state.me.hp / state.me.maxHp;
    const theirs = state.foe.hp / state.foe.maxHp;
    endBattle(state, mine >= theirs ? 'win' : 'lose');
    return;
  }

  const me = state.me, foe = state.foe, env = state.env;
  const mp = passives(me), fp = passives(foe);

  // squad regen (Mechanic repairs AFW, Medic heals infantry)
  if (mp.afwRegen) me.hp = Math.min(me.maxHp, me.hp + mp.afwRegen * dt);
  if (fp.afwRegen) foe.hp = Math.min(foe.maxHp, foe.hp + fp.afwRegen * dt);
  if (mp.infRegen) me.infantry = Math.min(me.maxInf, me.infantry + mp.infRegen * dt);
  if (fp.infRegen) foe.infantry = Math.min(foe.maxInf, foe.infantry + fp.infRegen * dt);

  // movement lockout
  if (state.moving > 0) {
    state.moving -= dt;
    if (state.moving <= 0) {
      state.moving = 0;
      env.range = state._moveTarget;
      const i = RANGES.indexOf(env.range);
      if (i === 0) state.nextRangeDir = 'out';
      else if (i === 2) state.nextRangeDir = 'in';
    }
  }

  if (me.reload > 0) me.reload = Math.max(0, me.reload - dt);

  // heat / aim — pilot skill and Recon speed up the aim draw
  const canAim = me.reload <= 0 && state.moving <= 0 && !me.overheat;
  if (me.overheat) {
    me.heat = Math.max(0, me.heat - HEAT_COOL * dt);
    me.acc = 0;
    if (me.heat <= HEAT_RECOVER) me.overheat = false;
  } else if (canAim) {
    const c = ceiling(env);
    const cfg = RANGE_CFG[env.range];
    const skill = 0.65 + 0.18 * me.pilot;          // ★ pilot skill
    const rate = cfg.ramp * (0.4 + 0.6 * (1 - me.acc / c)) * skill * mp.aim;
    me.acc = Math.min(c, me.acc + rate * dt);
    me.heat = Math.min(100, me.heat + HEAT_AIM * dt);
    if (me.heat >= 100) { me.overheat = true; me.acc = 0; }
  } else {
    me.heat = Math.max(0, me.heat - HEAT_COOL * dt);
  }

  updateEnemy(state, dt, fp);

  // infantry crossfire (the ground/crew squads fight automatically)
  state.infTick += dt;
  if (state.infTick >= INF_INTERVAL) {
    state.infTick -= INF_INTERVAL;
    infantryExchange(state, mp, fp);
  }

  if (state.dodge > 0) {
    state.dodge -= dt;
    if (state.dodge <= 0) { state.dodge = 0; resolveEnemyShot(state); }
  }
  if (state.flash.foe > 0) state.flash.foe = Math.max(0, state.flash.foe - dt);
  if (state.flash.me > 0) state.flash.me = Math.max(0, state.flash.me - dt);
}

function infantryExchange(state, mp, fp) {
  const me = state.me, foe = state.foe;
  // our infantry: attrite enemy soldiers; anti-mech squads chip the enemy AFW
  if (me.infantry > 0 && foe.hp > 0) {
    foe.infantry = Math.max(0, foe.infantry - rand(0.4, 1.0));
    const at = atSquads(me);
    if (at > 0) {
      const chip = at * rand(0.6, 1.4) * (me.infantry / me.maxInf);
      foe.hp = Math.max(0, foe.hp - chip);
      state.fx.push({ type: 'inffire', side: 'me' });
      if (foe.hp <= 0) return endBattle(state, 'win');
    }
  }
  // enemy infantry: their anti-personnel trio chews our soldiers harder
  if (foe.infantry > 0 && me.hp > 0) {
    me.infantry = Math.max(0, me.infantry - rand(0.6, 1.4) * fp.apPower);
    const at = atSquads(foe);
    if (at > 0) {
      const chip = at * rand(0.6, 1.2) * (foe.infantry / foe.maxInf);
      me.hp = Math.max(0, me.hp - chip);
      if (me.hp <= 0) return endBattle(state, 'lose');
    }
    state.fx.push({ type: 'inffire', side: 'foe' });
  }
}

function updateEnemy(state, dt, fp) {
  const foe = state.foe, env = state.env;
  if (foe.reload > 0) { foe.reload = Math.max(0, foe.reload - dt); return; }
  if (state.dodge > 0) return;

  const c = ceiling(env);
  const skill = 0.8 + 0.14 * foe.pilot;
  const speed = (18 + (RANGES.indexOf(env.range) === 0 ? 6 : 0)) * skill;
  foe.charge = Math.min(100, foe.charge + speed * dt);
  foe.acc = Math.min(c, (foe.charge / 100) * c);

  if (foe.charge >= 100) {
    foe.charge = 0;
    state.pendingFoeAcc = foe.acc;
    state.dodge = DODGE_WINDOW;
    state.flash.foe = ENEMY_FIRE_FLASH;
    setBanner(state, 'ENEMY AFW — VS AFW FIRE', 'foe', DODGE_WINDOW);
  }
}

function resolveEnemyShot(state) {
  const foe = state.foe;
  state.flash.foe = 0.12;
  state.fx.push({ type: 'fire', side: 'foe', hit: true });
  const hit = Math.random() * 100 < state.pendingFoeAcc;
  if (hit) {
    const dmg = Math.round(RANGE_CFG[state.env.range].dmg * 1.08 * (0.8 + Math.random() * 0.4));
    state.me.hp = Math.max(0, state.me.hp - dmg);
    state.fx.push({ type: 'impact', side: 'me', dmg });
    setBanner(state, `被命中 −${dmg}`, 'hit', 1.0);
    if (Math.random() < 0.35) knockSquad(state.me);
    if (state.me.hp <= 0) endBattle(state, 'lose');
  } else {
    state.fx.push({ type: 'miss', side: 'me' });
    setBanner(state, '對方失準 MISS', 'evade', 0.9);
  }
  state.pendingFoeAcc = 0;
  foe.reload = ENEMY_RELOAD;
}
