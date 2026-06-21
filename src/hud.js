// ============================================================
//  hud.js — gunner dashboard (DOM overlay), driven by state
// ============================================================

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'),
      hpMe: $('hp-me'), hpFoe: $('hp-foe'),
      hpnumMe: $('hpnum-me'), hpnumFoe: $('hpnum-foe'), infFoe: $('inf-foe'),
      timer: $('timer'), range: $('range'), time: $('time'), land: $('land'),
      banner: $('banner'),
      reticle: $('reticle'), acc: $('acc'),
      heat: $('heat'), charge: $('charge'), heatwarn: $('heatwarn'),
      squadMe: $('squad-me'), infMe: $('inf-me'), starMe: $('star-me'),
      fire: $('btn-fire'), dodge: $('btn-dodge'), move: $('btn-move'),
      skill: $('btn-skill'), skillUses: $('skill-uses'), moveLbl: $('move-lbl'),
      shell: $('btn-shell'), shellLbl: $('shell-lbl'),
    };
    this._squadBuilt = false;
  }

  show() { this.el.root.classList.remove('hidden'); }

  _buildSquad(state) {
    this.el.squadMe.innerHTML = '';
    state.me.squad.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'sq';
      d.dataset.name = s.name;
      d.textContent = `${s.role.replace('.Guard', '')} · ${s.name}`;
      this.el.squadMe.appendChild(d);
    });
    this.el.starMe.textContent = state.me.star;
    this._squadBuilt = true;
  }

  render(state) {
    if (!this._squadBuilt) this._buildSquad(state);
    const { me, foe, env } = state;

    // HP
    this.el.hpMe.style.width = (me.hp / me.maxHp * 100) + '%';
    this.el.hpFoe.style.width = (foe.hp / foe.maxHp * 100) + '%';
    this.el.hpnumMe.textContent = Math.ceil(me.hp);
    this.el.hpnumFoe.textContent = Math.ceil(foe.hp);
    this.el.infFoe.textContent = Math.ceil(foe.infantry);

    // timer
    const t = Math.ceil(state.time);
    this.el.timer.textContent = t;
    this.el.timer.classList.toggle('low', t <= 15);

    // env chips
    this.el.range.textContent = env.range;
    this.el.time.textContent = env.night ? 'NIGHT' : 'DAY';
    this.el.land.textContent = 'LAND ' + env.land + '%';

    // accuracy readout in scope
    const acc = this.el.acc;
    if (me.overheat) {
      acc.textContent = 'OVERHEAT'; acc.className = 'acc locked';
    } else if (me.reload > 0) {
      acc.innerHTML = 'RELOAD ' + me.reload.toFixed(1) + '<small>s</small>';
      acc.className = 'acc locked';
    } else if (state.moving > 0) {
      acc.textContent = 'MOVING…'; acc.className = 'acc locked';
    } else {
      acc.innerHTML = me.acc.toFixed(2) + '<small>%</small>';
      acc.className = 'acc' + (me.acc >= 75 ? ' ready' : '');
    }
    // reticle tightens as accuracy climbs
    const tighten = me.overheat || me.reload > 0 ? 1 : (1 - me.acc / 100);
    this.el.reticle.style.transform = `scale(${0.62 + tighten * 0.5})`;
    this.el.reticle.style.borderColor = me.maxArmed ? 'rgba(230,90,90,.85)' : '';

    // gauges
    this.el.heat.style.width = me.heat + '%';
    this.el.heat.classList.toggle('danger', me.heat > 75 || me.overheat);
    this.el.charge.style.width = (state.dodge > 0 ? 100 : foe.charge) + '%';
    this.el.heatwarn.classList.toggle('hidden', !(me.heat > 80 || me.overheat));

    // squad knockouts
    [...this.el.squadMe.children].forEach((d, i) => {
      d.classList.toggle('down', state.me.squad[i].down);
    });
    this.el.infMe.textContent = me.infantry;

    // banner
    const b = this.el.banner;
    if (state.banner.t > 0 && state.banner.text) {
      b.textContent = state.banner.text;
      b.className = 'banner show ' + state.banner.kind;
    } else {
      b.className = 'banner';
    }

    // buttons
    const canFire = state.phase === 'battle' && me.reload <= 0 && !me.overheat && state.moving <= 0 && me.acc >= 1;
    this.el.fire.disabled = !canFire;
    this.el.fire.classList.toggle('max', me.maxArmed);
    this.el.dodge.classList.toggle('armed', state.dodge > 0);
    this.el.skill.disabled = !(me.max > 0 && !me.maxArmed && state.phase === 'battle');
    this.el.skillUses.textContent = '×' + me.max;
    this.el.skill.classList.toggle('armed', me.maxArmed);
    this.el.shell.disabled = state.phase !== 'battle';
    this.el.shellLbl.textContent = me.shell === 'AT' ? '對甲' : '對人';
    this.el.shell.classList.toggle('ap', me.shell === 'AP');
    this.el.move.disabled = !(state.phase === 'battle' && state.moving <= 0 && me.reload <= 0);
    this.el.moveLbl.textContent = state.nextRangeDir === 'in' ? '前進' : '後退';
  }
}
