// ============================================================
//  hud.js — gunner dashboard + locational-targeting overlay
// ============================================================
import { PARTS, PART_POS, PART_CFG, caps, weaponDef, currentHitPart } from './combat.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'),
      hpMe: $('hp-me'), hpFoe: $('hp-foe'),
      hpnumMe: $('hpnum-me'), hpnumFoe: $('hpnum-foe'), infFoe: $('inf-foe'),
      timer: $('timer'), range: $('range'), time: $('time'), land: $('land'),
      banner: $('banner'),
      tzone: $('tzone'), reticle: $('reticle'), acc: $('acc'),
      rangeTop: $('range-top'), loadMe: $('load-me'), loadFoe: $('load-foe'),
      heat: $('heat'), charge: $('charge'), heatwarn: $('heatwarn'),
      squadMe: $('squad-me'), infMe: $('inf-me'), starMe: $('star-me'),
      selfParts: $('self-parts'),
      fire: $('btn-fire'), dodge: $('btn-dodge'), move: $('btn-move'),
      skill: $('btn-skill'), skillUses: $('skill-uses'), moveLbl: $('move-lbl'),
      shell: $('btn-shell'), shellLbl: $('shell-lbl'),
      weapon: $('btn-weapon'), weaponLbl: $('weapon-lbl'), weaponAmmo: $('weapon-ammo'),
    };
    this._built = false;
    this.onTarget = null;        // set by main.js: (part) => ...
  }

  show() { this.el.root.classList.remove('hidden'); }

  _build(state) {
    // enemy part markers (tap to target)
    this.markers = {};
    for (const p of PARTS) {
      const m = document.createElement('button');
      m.className = 'pmark';
      m.innerHTML = `<span class="pdot"></span><span class="plbl">${PART_CFG[p].zh}</span><span class="pco">100</span>`;
      m.addEventListener('pointerdown', (e) => { e.preventDefault(); if (this.onTarget) this.onTarget(p); });
      this.el.tzone.appendChild(m);
      this.markers[p] = m;
    }
    // our own coordination strip
    this.el.selfParts.innerHTML = '<div class="sp-title">本機協調</div>'
      + PARTS.map((p) => `<div class="sp-row" data-p="${p}"><span>${PART_CFG[p].zh}</span><i><b></b></i></div>`).join('');
    this.selfRows = {};
    [...this.el.selfParts.querySelectorAll('.sp-row')].forEach((r) => { this.selfRows[r.dataset.p] = r.querySelector('b'); });

    // squad strip
    this.el.squadMe.innerHTML = '';
    state.me.squad.forEach((s) => {
      const d = document.createElement('div'); d.className = 'sq';
      d.textContent = `${s.role.replace('.Guard', '')} · ${s.zh}`;
      this.el.squadMe.appendChild(d);
    });
    this.el.starMe.textContent = state.me.star;
    this._built = true;
  }

  render(state) {
    if (!this._built) this._build(state);
    const { me, foe, env } = state;

    this.el.hpMe.style.width = (me.hp / me.maxHp * 100) + '%';
    this.el.hpFoe.style.width = (foe.hp / foe.maxHp * 100) + '%';
    this.el.hpnumMe.textContent = Math.ceil(me.hp);
    this.el.hpnumFoe.textContent = Math.ceil(foe.hp);
    this.el.infFoe.textContent = Math.ceil(foe.infantry);

    const t = Math.ceil(state.time);
    this.el.timer.textContent = t;
    this.el.timer.classList.toggle('low', t <= 15);

    this.el.range.textContent = env.range;
    this.el.time.textContent = env.night ? 'NIGHT' : 'DAY';
    this.el.land.textContent = 'LAND ' + env.land + '%';

    // scope range box + blue(player)/red(enemy) loading markers
    this.el.rangeTop.textContent = env.range;
    this.el.loadMe.style.left = Math.max(0, Math.min(100, me.acc)) + '%';
    this.el.loadFoe.style.left = (state.dodge > 0 ? 100 : Math.max(0, Math.min(100, foe.charge))) + '%';

    // accuracy readout (turns cyan at high accuracy, like the original)
    const acc = this.el.acc;
    if (me.overheat) { acc.textContent = 'OVERHEAT'; acc.className = 'acc locked'; }
    else if (me.reload > 0) { acc.innerHTML = 'RELOAD ' + me.reload.toFixed(1) + '<small>s</small>'; acc.className = 'acc locked'; }
    else if (state.moving > 0) { acc.textContent = 'MOVING…'; acc.className = 'acc locked'; }
    else {
      acc.innerHTML = me.acc.toFixed(2) + '<small>%</small>';
      acc.className = 'acc' + (me.acc >= 60 ? ' hi' : '');
    }

    // place markers + reticle on the projected enemy (tracks the real AFW).
    // The enemy is a small distant figure, so expand the marker cluster around
    // its centre to a readable minimum size while staying centred on it.
    const scr = state.screen;
    if (scr) {
      const ps = scr.parts;
      let cx = 0, cy = 0;
      for (const p of PARTS) { cx += ps[p].x; cy += ps[p].y; }
      cx /= PARTS.length; cy /= PARTS.length;
      const extent = Math.max(ps.legL.y, ps.legR.y) - Math.min(ps.head.y, ps.torso.y);
      const k = Math.max(1, 105 / Math.max(8, extent));
      const place = (x, y) => ({ x: cx + (x - cx) * k, y: cy + (y - cy) * k });
      for (const p of PARTS) {
        const q = place(ps[p].x, ps[p].y);
        this.markers[p].style.left = q.x + 'px';
        this.markers[p].style.top = q.y + 'px';
      }
      const r = place(
        scr.torso.x + scr.dr.x * state.aim.x + scr.du.x * (state.aim.y - 0.45),
        scr.torso.y + scr.dr.y * state.aim.x + scr.du.y * (state.aim.y - 0.45),
      );
      this.el.reticle.style.left = r.x + 'px';
      this.el.reticle.style.top = r.y + 'px';
    }
    const tighten = me.overheat || me.reload > 0 ? 1 : (1 - me.acc / 100);
    this.el.reticle.style.setProperty('--rs', (0.7 + tighten * 0.7).toFixed(2));
    this.el.reticle.classList.toggle('armed', me.maxArmed);

    // enemy part markers: coordination, selected target, and the part the
    // reticle is currently over (lights up = will be hit)
    const live = state.phase === 'battle' ? currentHitPart(state) : null;
    for (const p of PARTS) {
      const mk = this.markers[p];
      const co = Math.round(foe.parts[p].co);
      mk.querySelector('.pco').textContent = co;
      mk.classList.toggle('sel', me.targetPart === p);
      mk.classList.toggle('live', p === live && co > 0);
      mk.classList.toggle('dead', co <= 0);
    }
    // our own coordination
    for (const p of PARTS) {
      const co = Math.max(0, Math.round(me.parts[p].co));
      const b = this.selfRows[p];
      b.style.width = co + '%';
      b.parentElement.parentElement.classList.toggle('dead', co <= 0);
    }

    // gauges
    this.el.heat.style.width = me.heat + '%';
    this.el.heat.classList.toggle('danger', me.heat > 75 || me.overheat);
    this.el.charge.style.width = (state.dodge > 0 ? 100 : foe.charge) + '%';
    this.el.heatwarn.classList.toggle('hidden', !(me.heat > 80 || me.overheat));

    [...this.el.squadMe.children].forEach((d, i) => d.classList.toggle('down', state.me.squad[i].down));
    this.el.infMe.textContent = Math.ceil(me.infantry);

    const b = this.el.banner;
    if (state.banner.t > 0 && state.banner.text) { b.textContent = state.banner.text; b.className = 'banner show ' + state.banner.kind; }
    else b.className = 'banner';

    // buttons
    const c = caps(me);
    this.el.fire.disabled = !(state.phase === 'battle' && me.reload <= 0 && !me.overheat && state.moving <= 0 && me.acc >= 1 && c.canFire);
    this.el.fire.classList.toggle('max', me.maxArmed);
    this.el.dodge.classList.toggle('armed', state.dodge > 0);
    this.el.skill.disabled = !(me.max > 0 && !me.maxArmed && state.phase === 'battle');
    this.el.skillUses.textContent = '×' + me.max;
    this.el.skill.classList.toggle('armed', me.maxArmed);
    this.el.shell.disabled = state.phase !== 'battle' || me.weapon !== 'cannon';
    this.el.shellLbl.textContent = me.shell === 'AT' ? '對甲' : '對人';
    this.el.shell.classList.toggle('ap', me.shell === 'AP');
    // weapon selector: current weapon + remaining ammo
    const W = weaponDef(me.weapon);
    this.el.weaponLbl.textContent = W.zh;
    this.el.weaponAmmo.textContent = W.ammo === Infinity ? '∞' : ('×' + (me.ammo[W.id] || 0));
    this.el.weapon.disabled = state.phase !== 'battle';
    this.el.weapon.classList.toggle('armed', me.weapon !== 'cannon');
    this.el.move.disabled = !(state.phase === 'battle' && state.moving <= 0 && me.reload <= 0 && c.canMove);
    this.el.moveLbl.textContent = state.nextRangeDir === 'in' ? '前進' : '後退';
  }
}
