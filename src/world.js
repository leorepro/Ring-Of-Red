// ============================================================
//  world.js — procedural low-poly 3D battlefield (Three.js)
//  Gunner first-person scope onto a cold, grim AFW duel.
// ============================================================
import * as THREE from 'three';
import { rangeSway } from './combat.js';

const RANGE_DIST = { SHORT: 24, MEDIUM: 42, LONG: 66 };

// cold day vs night palettes
const DAY = {
  fog: 0x8a958f, sky: 0x9aa39a, ground: 0x5f6657,
  hemiSky: 0xb9c2b4, hemiGround: 0x33372f, key: 0xf2efe0, keyI: 1.05, ambI: 0.55,
};
const NIGHT = {
  fog: 0x12161c, sky: 0x0c0f14, ground: 0x232a26,
  hemiSky: 0x2a3340, hemiGround: 0x10130f, key: 0x9fb7d6, keyI: 0.45, ambI: 0.25,
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);

    this.dist = RANGE_DIST.MEDIUM;
    this.targetDist = this.dist;
    // Heavy spring-driven camera kick — gives recoil & impacts real mass:
    // they lurch the view out and let it swing back with inertia, instead
    // of a weightless per-frame jitter.
    this.kickPos = new THREE.Vector3();
    this.kickVel = new THREE.Vector3();
    this.kickRot = new THREE.Vector3();      // x = pitch, y = yaw, z = roll
    this.kickRotVel = new THREE.Vector3();
    this.trauma = 0;                          // brief metallic rattle on top
    this.barrelKick = 0;                      // foreground barrel recoiling back
    this.effects = [];
    this.t = 0;
    this.lastNight = null;

    this._buildLights();
    this._buildGround();
    this._enemy = this._buildAFW({ enemy: true });
    this.scene.add(this._enemy);
    this._buildPlayerBarrel();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- construction ----------
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.ambI);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(DAY.key, DAY.keyI);
    this.key.position.set(-30, 46, -10);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 1; this.key.shadow.camera.far = 200;
    const d = 80;
    Object.assign(this.key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    this.scene.add(this.key);
    this.scene.add(this.key.target);
  }

  _buildGround() {
    this.scene.fog = new THREE.Fog(DAY.fog, 30, 180);
    this.scene.background = new THREE.Color(DAY.sky);

    // low-poly displaced terrain
    const geo = new THREE.PlaneGeometry(600, 600, 60, 60);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const h = Math.sin(x * 0.06) * Math.cos(z * 0.05) * 1.6
              + Math.sin(x * 0.013 + z * 0.017) * 3.2
              - Math.max(0, 1 - r / 30) * 1.2; // slight bowl near the duel
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    this.groundMat = new THREE.MeshStandardMaterial({ color: DAY.ground, flatShading: true, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // scattered low-poly debris / ruins for depth
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4f47, flatShading: true, roughness: 1 });
    const ruinMat = new THREE.MeshStandardMaterial({ color: 0x3c3a36, flatShading: true, roughness: 1 });
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 26 + Math.random() * 150;
      const x = Math.cos(ang) * rad, z = -Math.abs(Math.sin(ang) * rad) - 6;
      let m;
      if (Math.random() < 0.35) {
        m = new THREE.Mesh(new THREE.BoxGeometry(2 + Math.random() * 5, 3 + Math.random() * 9, 2 + Math.random() * 4), ruinMat);
        m.position.set(x, m.geometry.parameters.height / 2 - 1, z);
        m.rotation.y = Math.random() * Math.PI;
        m.rotation.z = (Math.random() - 0.5) * 0.25;
      } else {
        const s = 0.8 + Math.random() * 2.4;
        m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
        m.position.set(x, s * 0.5 - 0.6, z);
        m.rotation.set(Math.random(), Math.random(), Math.random());
      }
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // a walking-tank AFW
  _buildAFW({ enemy }) {
    const g = new THREE.Group();
    const body = enemy ? 0x6b4a3a : 0x55603f;       // foe rusty / me olive
    const accent = enemy ? 0xc0443a : 0x8a9a5b;
    const steel = 0x3a3f3a;
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, metalness: 0.25 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.4, 8.2), mat(body));
    hull.position.y = 4.2; hull.castShadow = true;
    g.add(hull);

    // sloped front glacis
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.0, 2.4), mat(steel));
    glacis.position.set(0, 4.0, -4.4); glacis.rotation.x = -0.5; glacis.castShadow = true;
    g.add(glacis);

    const turret = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 2.0, 8), mat(body));
    turret.position.set(0, 5.9, 0.4); turret.castShadow = true;
    g.add(turret);

    // unit insignia plate
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 0.12), mat(accent));
    plate.position.set(0, 5.9, 2.7);
    g.add(plate);

    // main barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 7.6, 10), mat(steel));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 6.0, -3.6); barrel.castShadow = true;
    g.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.7, 10), mat(0x222));
    muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 6.0, -7.2);
    g.add(muzzle);
    g.userData.muzzleLocal = new THREE.Vector3(0, 6.0, -7.6);

    // walking legs
    const legMat = mat(steel);
    g.userData.legs = [];
    const legX = 3.6, legZ = 2.8;
    [[-legX, legZ], [legX, legZ], [-legX, -legZ], [legX, -legZ]].forEach(([x, z], i) => {
      const leg = new THREE.Group();
      leg.position.set(x, 3.4, z);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.0, 0.9), legMat);
      thigh.position.y = -1.3; thigh.castShadow = true;
      const knee = new THREE.Group(); knee.position.y = -2.7;
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.75, 3.0, 0.75), legMat);
      shin.position.y = -1.4; shin.castShadow = true;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), legMat);
      foot.position.y = -2.9;
      knee.add(shin, foot); leg.add(thigh, knee);
      leg.userData = { knee, phase: i * Math.PI / 2 };
      g.add(leg);
      g.userData.legs.push(leg);
    });

    // a few riding soldiers (boxes) on the hull back
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.7), mat(0x2f352c));
      s.position.set(-2.2 + i * 1.45, 5.6, 2.0); s.castShadow = true;
      g.add(s);
    }

    g.rotation.y = enemy ? Math.PI : 0; // enemy faces the camera
    return g;
  }

  _buildPlayerBarrel() {
    // foreground: our own gun barrel jutting into the lower frame, anchored to camera
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2f342f, flatShading: true, roughness: 0.7, metalness: 0.4 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 14, 12), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(1.7, -2.2, -5.5);
    this.rig.add(barrel);
    this.myBarrel = barrel;
    this.barrelBaseZ = barrel.position.z;
    this.myMuzzleLocal = new THREE.Vector3(1.7, -2.2, -12);
  }

  // ---------- per-frame ----------
  setEnv(night) {
    if (this.lastNight === night) return;
    this.lastNight = night;
    const p = night ? NIGHT : DAY;
    this.scene.fog.color.setHex(p.fog);
    this.scene.fog.near = night ? 22 : 30;
    this.scene.fog.far = night ? 130 : 180;
    this.scene.background.setHex(p.sky);
    this.groundMat.color.setHex(p.ground);
    this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.ambI;
    this.key.color.setHex(p.key); this.key.intensity = p.keyI;
  }

  update(state, dt) {
    this.t += dt;
    this.setEnv(state.env.night);

    // distance follows the current range
    this.targetDist = RANGE_DIST[state.env.range];
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 2.2);
    this._enemy.position.set(0, -0.4, -this.dist);

    // leg gait — fast while moving range, idle sway otherwise
    const gait = state.moving > 0 ? 9 : 1.4;
    const amp = state.moving > 0 ? 0.5 : 0.08;
    this._enemy.userData.legs.forEach((leg) => {
      const a = Math.sin(this.t * gait + leg.userData.phase) * amp;
      leg.rotation.x = a;
      leg.userData.knee.rotation.x = Math.max(0, -a) * 1.3;
    });
    this._enemy.position.y += Math.sin(this.t * gait * 2) * amp * 0.2;

    // gunner aim micro-sway (shrinks as accuracy climbs)
    const sway = state.phase === 'battle' ? rangeSway(state) * 0.010 : 0.004;
    const sx = Math.sin(this.t * 1.7) * sway;
    const sy = Math.cos(this.t * 1.3) * sway * 0.7;

    // ---- heavy walking-gait motion ----
    // The gunner rides a multi-ton walking tank: a slow, weighty cadence with
    // a side-to-side weight shift, an up-down footfall pound, a fore-aft surge
    // as it strides forward, plus the lean/nod that go with each step.
    const moving = state.moving > 0;
    const step = (moving ? 1.45 : 0.8) * Math.PI * 2;   // slow, heavy cadence
    const ph = this.t * step;
    const weight = moving ? 1 : 0.5;                     // idle still shifts mass
    const swayX  = Math.sin(ph) * 0.55 * weight;         // weight rolls L↔R
    const bobY   = Math.sin(ph * 2) * 0.24 * weight;     // footfall pound (2/stride)
    const lurchZ = moving
      ? (0.6 - Math.cos(ph * 2) * 0.6) * 1.5             // surges forward each stride
      : Math.sin(ph * 2) * 0.10;                         // idle fore-aft breathing
    const rollZ  = Math.sin(ph) * 0.032 * weight;        // leans into each step
    const pitchG = Math.sin(ph * 2 + 0.6) * 0.024 * weight; // nods on footfall

    // ---- heavy spring kick (recoil / impacts) + brief metallic rattle ----
    this._integrateKick(dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.barrelKick = Math.max(0, this.barrelKick - dt * 6);
    const tr = this.trauma * this.trauma;
    const rp = tr * 0.22, rr = tr * 0.018;
    const rnd = () => Math.random() - 0.5;

    this.camera.position.set(
      this.kickPos.x + swayX + rnd() * rp,
      7.6 + this.kickPos.y + bobY + rnd() * rp,
      6 + this.kickPos.z + lurchZ + rnd() * rp * 0.5,
    );
    this.camera.rotation.set(
      -0.04 + sy + pitchG + this.kickRot.x + rnd() * rr,
      sx + this.kickRot.y + rnd() * rr,
      rollZ + this.kickRot.z + rnd() * rr * 0.7,
    );
    this.rig.position.copy(this.camera.position);
    this.rig.rotation.copy(this.camera.rotation);
    // foreground barrel slams backward then settles
    if (this.myBarrel) this.myBarrel.position.z = this.barrelBaseZ + this.barrelKick * 2.2;

    this._consumeFx(state);
    this._updateEffects(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // Underdamped spring → an impulse throws the view out, then it swings
  // back and settles. Low stiffness = slow, heavy, armoured inertia.
  _integrateKick(dt) {
    const k = 55, c = 11;                       // stiffness / damping
    const steps = 3, h = Math.min(dt, 0.05) / steps;
    for (let i = 0; i < steps; i++) {
      this.kickVel.addScaledVector(this.kickPos, -k * h);
      this.kickVel.addScaledVector(this.kickVel, -c * h);
      this.kickPos.addScaledVector(this.kickVel, h);
      this.kickRotVel.addScaledVector(this.kickRot, -k * h);
      this.kickRotVel.addScaledVector(this.kickRotVel, -c * h);
      this.kickRot.addScaledVector(this.kickRotVel, h);
    }
  }

  // ---------- visual events ----------
  _consumeFx(state) {
    if (!state.fx || !state.fx.length) return;
    const rnd = () => Math.random() - 0.5;
    for (const e of state.fx) {
      if (e.type === 'fire' && e.side === 'me') {
        this._muzzleFlash(this._myMuzzleWorld(), 0xffd27a);
        // heavy artillery recoil: pitch up, heave, and shove the whole hull back
        this.kickRotVel.x += 1.0;                       // muzzle climbs
        this.kickRotVel.z += rnd() * 0.5;               // slight twist
        this.kickVel.y += 2.6;
        this.kickVel.z += 7.5;                          // recoils backward
        this.trauma = Math.max(this.trauma, 0.7);
        this.barrelKick = 1;
      } else if (e.type === 'fire' && e.side === 'foe') {
        this._muzzleFlash(this._foeMuzzleWorld(), 0xffae5a);
        this._tracer(this._foeMuzzleWorld(), this.camera.position.clone().add(new THREE.Vector3(0, -1, 2)), 0xff8855);
      } else if (e.type === 'impact' && e.side === 'foe') {
        this._explosion(this._enemy.position.clone().setY(5), e.dmg);
        // our hit lands downrange — modest feedback through the hull
        this.kickVel.z += 2;
        this.kickRotVel.x += 0.3;
        this.trauma = Math.max(this.trauma, 0.35);
      } else if (e.type === 'impact' && e.side === 'me') {
        // taking a shell: a violent, heavy lurch sideways + roll
        const d = Math.random() < 0.5 ? -1 : 1;
        this.kickVel.x += d * 10;
        this.kickVel.z += 6;
        this.kickVel.y += Math.abs(rnd()) * 5;
        this.kickRotVel.z += d * 1.7;                   // hull rolls from the blow
        this.kickRotVel.x += 0.9;
        this.trauma = 1;
        this._redFlash();
      } else if (e.type === 'miss' && e.side === 'foe') {
        this._tracer(this._myMuzzleWorld(), this._enemy.position.clone().add(new THREE.Vector3(8, 6, 4)), 0xffcc66);
      } else if (e.type === 'miss' && e.side === 'me') {
        this._dirt(this.camera.position.clone().add(new THREE.Vector3(6, -2, -8)));
      } else if (e.type === 'evade') {
        // a hard, weighty juke to the side to slip the incoming shell
        const d = Math.random() < 0.5 ? -1 : 1;
        this.kickVel.x += d * 12;
        this.kickRotVel.z += d * 1.5;
        this.trauma = Math.max(this.trauma, 0.5);
      }
      if (e.type === 'fire' && e.side === 'me') {
        this._tracer(this._myMuzzleWorld(), this._enemy.position.clone().setY(5.5), e.hit ? 0xfff0b0 : 0xffcc66, e.hit);
      }
    }
    state.fx.length = 0;
  }

  _myMuzzleWorld() { return this.myMuzzleLocal.clone().applyMatrix4(this.rig.matrixWorld); }
  _foeMuzzleWorld() {
    return this._enemy.userData.muzzleLocal.clone()
      .applyEuler(this._enemy.rotation).add(this._enemy.position);
  }

  _muzzleFlash(pos, color) {
    const light = new THREE.PointLight(color, 8, 40, 2);
    light.position.copy(pos); this.scene.add(light);
    const spr = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    spr.position.copy(pos); this.scene.add(spr);
    let life = 0.16;
    this.effects.push((dt) => {
      life -= dt; const k = Math.max(0, life / 0.16);
      light.intensity = 8 * k; spr.material.opacity = k; spr.scale.setScalar(1 + (1 - k) * 1.6);
      if (life <= 0) { this.scene.remove(light, spr); spr.geometry.dispose(); spr.material.dispose(); return false; }
      return true;
    });
  }

  _tracer(from, to, color, big = false) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(big ? 0.16 : 0.1, big ? 0.16 : 0.1, len, 6);
    geo.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(m);
    let life = 0.18;
    this.effects.push((dt) => {
      life -= dt; m.material.opacity = Math.max(0, life / 0.18) * 0.9;
      if (life <= 0) { this.scene.remove(m); geo.dispose(); m.material.dispose(); return false; }
      return true;
    });
  }

  _explosion(pos, dmg = 50) {
    const light = new THREE.PointLight(0xff7a3a, 12, 60, 2);
    light.position.copy(pos); this.scene.add(light);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1 }));
    core.position.copy(pos); this.scene.add(core);
    // sparks
    const sparks = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffb04a }));
      s.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 1.2, (Math.random() - 0.5)).multiplyScalar(14 + Math.random() * 10);
      this.scene.add(s); sparks.push({ s, v });
    }
    let life = 0.6;
    this.effects.push((dt) => {
      life -= dt; const k = Math.max(0, life / 0.6);
      light.intensity = 12 * k;
      core.material.opacity = k; core.scale.setScalar(1 + (1 - k) * (1 + dmg / 60) * 3);
      sparks.forEach((p) => { p.v.y -= 30 * dt; p.s.position.addScaledVector(p.v, dt); });
      if (life <= 0) {
        this.scene.remove(light, core); core.geometry.dispose(); core.material.dispose();
        sparks.forEach((p) => { this.scene.remove(p.s); p.s.geometry.dispose(); p.s.material.dispose(); });
        return false;
      }
      return true;
    });
  }

  _dirt(pos) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x6b6357, transparent: true, opacity: 0.7 }));
    m.position.copy(pos); this.scene.add(m);
    let life = 0.5;
    this.effects.push((dt) => {
      life -= dt; m.material.opacity = Math.max(0, life / 0.5) * 0.7; m.scale.setScalar(1 + (1 - life / 0.5) * 2);
      if (life <= 0) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
      return true;
    });
  }

  _redFlash() {
    if (!this._red) {
      this._red = document.createElement('div');
      this._red.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;background:radial-gradient(circle,transparent 40%,rgba(180,30,20,.55));opacity:0;transition:opacity .08s';
      document.body.appendChild(this._red);
    }
    this._red.style.opacity = '1';
    setTimeout(() => { if (this._red) this._red.style.opacity = '0'; }, 90);
  }

  _updateEffects(dt) {
    this.effects = this.effects.filter((fn) => fn(dt));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Portrait: widen the vertical FOV so the enemy AFW and our barrel
    // both stay framed on a tall, narrow screen.
    this.camera.fov = aspect < 1 ? Math.min(74, 46 / Math.max(aspect, 0.45)) : 46;
    this.camera.updateProjectionMatrix();
  }
}
