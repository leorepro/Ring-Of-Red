// ============================================================
//  combat.js — engagement-layer state machine & math
//  Models the "four pressures" of Ring of Red's artillery duel:
//  accuracy ramp × heat limit × timer × duel/dodge.
// ============================================================

export const RANGES = ['SHORT', 'MEDIUM', 'LONG'];

// per-range tuning: accuracy ceiling, ramp speed, damage
const RANGE_CFG = {
  SHORT:  { ceil: 92, ramp: 34, dmg: 96, sway: 0.5 },
  MEDIUM: { ceil: 80, ramp: 24, dmg: 64, sway: 1.0 },
  LONG:   { ceil: 64, ramp: 16, dmg: 44, sway: 1.7 },
};

const NIGHT_PENALTY = 18;   // night drops the accuracy ceiling
const HEAT_AIM = 13;        // heat/sec while holding aim
const HEAT_FIRE = 34;       // heat added per shot
const HEAT_COOL = 22;       // heat lost/sec when not aiming
const HEAT_RECOVER = 32;    // overheat clears below this
const RELOAD_TIME = 3.4;    // seconds to reload main gun
const MOVE_TIME = 1.6;      // seconds to change range
const DODGE_WINDOW = 1.25;  // reaction window to evade
const ENEMY_FIRE_FLASH = 0.45;

const SQUADS = {
  me: [
    { name: 'Repair',   role: 'F.Guard' },
    { name: 'Shrapnel', role: 'F.Guard' },
    { name: 'Homing Shot', role: 'R.Guard' },
  ],
  foe: [
    { name: 'G.Rcn',  role: 'F.Guard' },
    { name: 'G.Med',  role: 'R.Guard' },
    { name: 'G.Mech', role: 'R.Guard' },
  ],
};

export function createState() {
  const night = Math.random() < 0.5;
  const land = [5, 10, 15][Math.floor(Math.random() * 3)];
  return {
    phase: 'battle',            // battle | win | lose
    time: 90,
    nextRangeDir: 'in',         // which way the next MOVE shifts range
    env: { range: 'MEDIUM', night, land },
    me: {
      hp: 374, maxHp: 374,
      acc: 0, heat: 0, overheat: false, reload: 0,
      infantry: 16, star: 3,
      squad: SQUADS.me.map(s => ({ ...s, down: false })),
      homing: 2,                // "Homing Shot" skill uses
      homingArmed: false,
    },
    foe: {
      hp: 340, maxHp: 340,
      acc: 0, charge: 0, reload: 0,
      infantry: 16, star: 2,
      squad: SQUADS.foe.map(s => ({ ...s, down: false })),
    },
    moving: 0,                  // >0: changing range (locked out)
    dodge: 0,                   // >0: dodge window open
    pendingFoeAcc: 0,           // accuracy enemy fires at
    flash: { me: 0, foe: 0 },   // muzzle-flash request timers (consumed by scene)
    banner: { text: '', kind: '', t: 0 },
    fx: [],                     // queued visual events for the scene
  };
}

// accuracy ceiling for whoever is aiming, given environment
function ceiling(env) {
  let c = RANGE_CFG[env.range].ceil + (env.land - 5) * 0.4;
  if (env.night) c -= NIGHT_PENALTY;
  return Math.max(20, Math.min(99, c));
}

export function rangeSway(state) {
  // residual aim wobble shrinks as accuracy approaches its ceiling
  const base = RANGE_CFG[state.env.range].sway * (state.env.night ? 1.4 : 1);
  const c = ceiling(state.env);
  return base * (1 - 0.85 * (state.me.acc / c));
}

function setBanner(state, text, kind, t = 1.1) {
  state.banner = { text, kind, t };
}

// ---- player intents (called from input) ----

export function tryFire(state) {
  const me = state.me;
  if (state.phase !== 'battle' || state.moving > 0) return;
  if (me.reload > 0 || me.overheat || me.acc < 1) return;

  let acc = me.acc;
  if (me.homingArmed) { acc = Math.max(acc, 90); me.homingArmed = false; }

  const hit = Math.random() * 100 < acc;
  state.flash.me = 0.12;
  state.fx.push({ type: 'fire', side: 'me', hit });
  setBanner(state, 'PLAYER AFW — VS AFW FIRE', 'me', 0.7);

  if (hit) {
    const dmg = Math.round(RANGE_CFG[state.env.range].dmg * (0.85 + Math.random() * 0.3));
    state.foe.hp = Math.max(0, state.foe.hp - dmg);
    state.fx.push({ type: 'impact', side: 'foe', dmg });
    if (Math.random() < 0.4) knockSquad(state.foe);
    if (state.foe.hp <= 0) endBattle(state, 'win');
  } else {
    state.fx.push({ type: 'miss', side: 'foe' });
  }
  me.acc = 0;
  me.reload = RELOAD_TIME;
  me.heat = Math.min(100, me.heat + HEAT_FIRE);
}

export function tryDodge(state) {
  if (state.phase !== 'battle') return;
  if (state.dodge > 0) {
    // success — negate the incoming shot, but it costs your aim
    state.dodge = 0;
    state.pendingFoeAcc = 0;
    state.foe.charge = 0;
    state.foe.reload = RELOAD_TIME;
    state.me.acc = 0;
    state.me.heat = Math.min(100, state.me.heat + 10);
    state.fx.push({ type: 'evade' });
    setBanner(state, '迴避成功 EVADED', 'evade', 1.0);
  }
}

export function tryMove(state) {
  if (state.phase !== 'battle' || state.moving > 0 || state.me.reload > 0) return;
  // cycle SHORT <-> MEDIUM <-> LONG, toward whichever we aren't at the edge of
  const i = RANGES.indexOf(state.env.range);
  const next = state.nextRangeDir === 'in'
    ? Math.max(0, i - 1)
    : Math.min(2, i + 1);
  if (next === i) {
    state.nextRangeDir = state.nextRangeDir === 'in' ? 'out' : 'in';
    return tryMove(state);
  }
  state._moveTarget = RANGES[next];
  state.moving = MOVE_TIME;
  state.me.acc = 0;
}

export function trySkill(state) {
  const me = state.me;
  if (state.phase !== 'battle' || me.homing <= 0 || me.homingArmed) return;
  if (me.squad[2].down) return;     // Homing Shot soldier knocked out
  me.homing -= 1;
  me.homingArmed = true;
  setBanner(state, '導向彈 裝填 — 下一發鎖定', 'me', 1.2);
}

function knockSquad(unit) {
  const alive = unit.squad.filter(s => !s.down);
  if (alive.length) {
    alive[Math.floor(Math.random() * alive.length)].down = true;
    unit.infantry = Math.max(0, unit.infantry - (3 + Math.floor(Math.random() * 4)));
  }
}

function endBattle(state, outcome) {
  state.phase = outcome;
  state.dodge = 0;
}

// ---- main tick ----

export function update(state, dt) {
  if (state.phase !== 'battle') return;

  // banner fade
  if (state.banner.t > 0) state.banner.t -= dt;

  // timer
  state.time -= dt;
  if (state.time <= 0) {
    state.time = 0;
    const mine = state.me.hp / state.me.maxHp;
    const theirs = state.foe.hp / state.foe.maxHp;
    endBattle(state, mine >= theirs ? 'win' : 'lose');
    return;
  }

  const me = state.me, foe = state.foe, env = state.env;

  // movement lockout
  if (state.moving > 0) {
    state.moving -= dt;
    if (state.moving <= 0) {
      state.moving = 0;
      env.range = state._moveTarget;
      // keep the MOVE button pointing somewhere valid
      const i = RANGES.indexOf(env.range);
      if (i === 0) state.nextRangeDir = 'out';
      else if (i === 2) state.nextRangeDir = 'in';
    }
  }

  // player reload
  if (me.reload > 0) me.reload = Math.max(0, me.reload - dt);

  // heat / aim
  const canAim = me.reload <= 0 && state.moving <= 0 && !me.overheat;
  if (me.overheat) {
    me.heat = Math.max(0, me.heat - HEAT_COOL * dt);
    me.acc = 0;
    if (me.heat <= HEAT_RECOVER) me.overheat = false;
  } else if (canAim) {
    const c = ceiling(env);
    const cfg = RANGE_CFG[env.range];
    const rate = cfg.ramp * (0.4 + 0.6 * (1 - me.acc / c));
    me.acc = Math.min(c, me.acc + rate * dt);
    me.heat = Math.min(100, me.heat + HEAT_AIM * dt);
    if (me.heat >= 100) { me.overheat = true; me.acc = 0; }
  } else {
    me.heat = Math.max(0, me.heat - HEAT_COOL * dt);
  }

  // ---- enemy AI ----
  updateEnemy(state, dt);

  // dodge window countdown -> resolve incoming shot
  if (state.dodge > 0) {
    state.dodge -= dt;
    if (state.dodge <= 0) {
      state.dodge = 0;
      resolveEnemyShot(state);
    }
  }
  if (state.flash.foe > 0) state.flash.foe = Math.max(0, state.flash.foe - dt);
  if (state.flash.me > 0) state.flash.me = Math.max(0, state.flash.me - dt);
}

function updateEnemy(state, dt) {
  const foe = state.foe, env = state.env;
  if (foe.reload > 0) { foe.reload = Math.max(0, foe.reload - dt); return; }
  if (state.dodge > 0) return; // already committed to a shot

  // enemy charges its shot; speed scales with how close it is + difficulty
  const c = ceiling(env);
  const speed = 14 + (RANGES.indexOf(env.range) === 0 ? 5 : 0); // %/sec of charge
  foe.charge = Math.min(100, foe.charge + speed * dt);
  foe.acc = Math.min(c, (foe.charge / 100) * c);

  if (foe.charge >= 100) {
    // commit: open the dodge window for the player
    foe.charge = 0;
    state.pendingFoeAcc = foe.acc;
    state.dodge = DODGE_WINDOW;
    state.flash.foe = ENEMY_FIRE_FLASH; // wind-up tell
    setBanner(state, 'ENEMY AFW — VS AFW FIRE', 'foe', DODGE_WINDOW);
  }
}

function resolveEnemyShot(state) {
  const foe = state.foe;
  state.flash.foe = 0.12;
  state.fx.push({ type: 'fire', side: 'foe', hit: true });
  const hit = Math.random() * 100 < state.pendingFoeAcc;
  if (hit) {
    const dmg = Math.round(RANGE_CFG[state.env.range].dmg * 0.95 * (0.8 + Math.random() * 0.4));
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
  foe.reload = RELOAD_TIME;
}
