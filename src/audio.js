// ============================================================
//  audio.js — procedural sound effects via Web Audio (no assets)
//  Synthesises weapon fire, impacts, crits, UI and stingers.
//  Must be resumed from a user gesture (mobile autoplay policy).
// ============================================================

class Sfx {
  constructor() { this.ctx = null; this.master = null; this.noiseBuf = null; this.muted = false; }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // 1s of white noise, looped, for bursts/explosions
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get t() { return this.ctx.currentTime; }

  // filtered noise burst with an exponential decay
  noise(dur, { freq = 800, q = 1, gain = 0.5, type = 'lowpass', at = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = (at || this.t);
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // oscillator tone with optional pitch slide
  tone(freq, dur, { type = 'sine', gain = 0.3, to = null, at = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = (at || this.t);
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---- weapon fire ----
  fire(weapon = 'cannon') {
    if (!this.ctx) return;
    switch (weapon) {
      case 'sniper':
        this.noise(0.18, { freq: 2600, q: 1.2, gain: 0.6, type: 'bandpass' });
        this.tone(820, 0.09, { type: 'square', gain: 0.25, to: 180 });
        this.noise(0.4, { freq: 220, gain: 0.4 }); break;
      case 'mg': {
        const t0 = this.t;
        for (let i = 0; i < 11; i++) {
          this.noise(0.05, { freq: 1700, q: 1, gain: 0.32, type: 'bandpass', at: t0 + i * 0.055 });
          this.tone(420, 0.03, { type: 'square', gain: 0.1, at: t0 + i * 0.055 });
        } break;
      }
      case 'missile':
        this.tone(220, 0.5, { type: 'sawtooth', gain: 0.28, to: 700 });
        this.noise(0.6, { freq: 900, gain: 0.35, type: 'lowpass' }); break;
      case 'shrap':
        this.noise(0.3, { freq: 1600, q: 0.7, gain: 0.6, type: 'highpass' });
        this.tone(160, 0.25, { type: 'square', gain: 0.3, to: 70 }); break;
      case 'rail':
        this.tone(180, 0.45, { type: 'sawtooth', gain: 0.3, to: 1400 });        // charge whine
        this.noise(0.5, { freq: 3000, q: 2, gain: 0.5, type: 'bandpass', at: this.t + 0.38 });
        this.tone(90, 0.5, { type: 'sine', gain: 0.5, to: 35, at: this.t + 0.38 }); break;
      default: // cannon
        this.noise(0.38, { freq: 320, gain: 0.85 });
        this.tone(120, 0.32, { type: 'sine', gain: 0.55, to: 46 });
        this.tone(70, 0.4, { type: 'triangle', gain: 0.4, to: 30 });
    }
  }

  enemyFire() { this.noise(0.34, { freq: 280, gain: 0.5 }); this.tone(100, 0.3, { type: 'sine', gain: 0.32, to: 42 }); }

  explosion(big = false) {
    this.noise(big ? 0.8 : 0.5, { freq: big ? 160 : 240, gain: big ? 1.0 : 0.7 });
    this.tone(big ? 70 : 90, big ? 0.6 : 0.4, { type: 'sine', gain: big ? 0.6 : 0.4, to: 28 });
  }
  crit() { this.explosion(true); this.tone(1300, 0.3, { type: 'square', gain: 0.22, to: 320 }); this.noise(0.25, { freq: 4000, q: 2, gain: 0.3, type: 'bandpass' }); }
  hitTaken() { this.noise(0.28, { freq: 180, gain: 0.8 }); this.tone(85, 0.22, { type: 'square', gain: 0.4, to: 40 }); }
  dodge() { this.noise(0.3, { freq: 1400, q: 1.5, gain: 0.3, type: 'bandpass' }); this.tone(500, 0.28, { type: 'sine', gain: 0.18, to: 1300 }); }

  // ---- UI / state ----
  ui() { this.tone(600, 0.05, { type: 'square', gain: 0.12 }); }
  switchW() { this.tone(420, 0.06, { type: 'square', gain: 0.14 }); this.tone(680, 0.08, { type: 'square', gain: 0.14, at: this.t + 0.06 }); }
  overheat() { this.tone(900, 0.12, { type: 'square', gain: 0.2 }); this.tone(900, 0.12, { type: 'square', gain: 0.2, at: this.t + 0.18 }); }
  win() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.22, at: this.t + i * 0.13 })); }
  lose() { [392, 311, 247, 175].forEach((f, i) => this.tone(f, 0.3, { type: 'sawtooth', gain: 0.2, at: this.t + i * 0.16 })); }
}

export const audio = new Sfx();
