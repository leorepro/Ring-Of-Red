// ============================================================
//  world.js — procedural low-poly 3D battlefield (Three.js)
//  Gunner first-person scope onto a cold, grim AFW duel.
// ============================================================
import * as THREE from 'three';
import { rangeSway, PART_POS } from './combat.js';

// engagement distances pulled far out — at this range a tiny aim wobble
// walks the point of impact from the head down to the legs (sniper feel)
const RANGE_DIST = { SHORT: 200, MEDIUM: 360, LONG: 520 };
const ENEMY_SCALE = 0.48;              // tiny, distant figure (30% — long sniper range)
const ENEMY_BASE_Y = -1.0;             // biped model is built with feet at y≈0

// cold day vs night palettes
const DAY = {
  fog: 0xbcbaa6, sky: 0xc9c4ac, ground: 0x646a58,
  hemiSky: 0xc2ccbe, hemiGround: 0x363b30, key: 0xfff0d6, keyI: 1.28, ambI: 0.5,
  skyTop: 0x6f8aa6, skyHorizon: 0xcbc6ae, sun: 0xffe6ad, sunCore: 0xfff4da,
  sunScale: 500, sunOp: 0.95, cloud: 0xf3efe2, cloudOp: 0.55,
};
const NIGHT = {
  // moonlit, cool-blue night — clearly readable, not pitch black
  fog: 0x2c3744, sky: 0x1b2330, ground: 0x3c473f,
  hemiSky: 0x6f8198, hemiGround: 0x2a302c, key: 0xc2d4ee, keyI: 0.8, ambI: 0.55,
  skyTop: 0x0d1320, skyHorizon: 0x2b3643, sun: 0xb6c6dc, sunCore: 0xe6eefa,
  sunScale: 280, sunOp: 0.62, cloud: 0x3a4757, cloudOp: 0.35,
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 2500);

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
    this.rumble = 0;                           // sustained post-fire hull shudder
    this.barrelKick = 0;                      // foreground barrel recoiling back
    this.effects = [];
    this.t = 0;
    this.lastNight = null;

    this._buildLights();
    this._buildSky();
    this._buildGround();
    this._enemy = this._buildAFW({ enemy: true });
    this._enemy.scale.setScalar(ENEMY_SCALE);
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

  _radialTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.28, 'rgba(255,255,255,0.65)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  _buildSky() {
    // gradient dome (top → hazy horizon), recoloured per time of day
    this.skyU = {
      top: { value: new THREE.Color(DAY.skyTop) },
      horizon: { value: new THREE.Color(DAY.skyHorizon) },
      offset: { value: 0.06 }, exponent: { value: 0.85 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1600, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyU,
        vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform float offset; uniform float exponent; varying vec3 vD; void main(){ float h=clamp(vD.y+offset,0.0,1.0); gl_FragColor=vec4(mix(horizon,top,pow(h,exponent)),1.0); }',
      }));
    dome.renderOrder = -2;
    this.scene.add(dome);

    // sun / moon glow toward the key light
    const tex = this._radialTexture();
    this._glowTex = tex;
    const dir = new THREE.Vector3(-30, 46, -10).normalize().multiplyScalar(1000);
    const sprite = (size, color, op) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: op,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      s.position.copy(dir); s.scale.setScalar(size); s.renderOrder = -1;
      this.scene.add(s); return s;
    };
    this.sunGlow = sprite(DAY.sunScale, DAY.sun, DAY.sunOp);
    this.sunCore = sprite(DAY.sunScale * 0.3, DAY.sunCore, 1);

    // soft drifting clouds near the horizon (normal-blended haze puffs)
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: DAY.cloud, transparent: true, opacity: DAY.cloudOp,
        depthWrite: false,
      }));
      const ang = (i / 6) * Math.PI * 2 + Math.random();
      const r = 850 + Math.random() * 250;
      m.position.set(Math.cos(ang) * r, 160 + Math.random() * 220, -Math.abs(Math.sin(ang)) * r - 120);
      m.scale.set(420 + Math.random() * 360, 130 + Math.random() * 80, 1);
      m.renderOrder = -1; m.userData.spd = 4 + Math.random() * 5;
      this.clouds.push(m); this.scene.add(m);
    }
  }

  _buildGround() {
    this.scene.fog = new THREE.Fog(DAY.fog, 80, 560);
    this.scene.background = new THREE.Color(DAY.sky);

    // large low-poly displaced terrain (battlefield is long now)
    const geo = new THREE.PlaneGeometry(2600, 2600, 110, 110);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const h = Math.sin(x * 0.045) * Math.cos(z * 0.04) * 2.0
              + Math.sin(x * 0.011 + z * 0.014) * 4.0
              - Math.max(0, 1 - r / 60) * 1.2; // gentle bowl near the duel
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    this.groundMat = new THREE.MeshStandardMaterial({ color: DAY.ground, flatShading: true, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // scattered low-poly debris / ruins spread across the long battlefield.
    // Kept in a list so they can scroll toward the camera (forward-march cue).
    this.debris = [];
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4f47, flatShading: true, roughness: 1 });
    const ruinMat = new THREE.MeshStandardMaterial({ color: 0x3c3a36, flatShading: true, roughness: 1 });
    this._zNear = 30; this._zFar = -950;          // scroll wrap band
    for (let i = 0; i < 190; i++) {
      const x = (Math.random() - 0.5) * 760;
      const z = this._zFar + Math.random() * (this._zNear - this._zFar);
      let m;
      if (Math.random() < 0.35) {
        m = new THREE.Mesh(new THREE.BoxGeometry(2 + Math.random() * 7, 3 + Math.random() * 12, 2 + Math.random() * 5), ruinMat);
        m.position.set(x, m.geometry.parameters.height / 2 - 1, z);
        m.rotation.y = Math.random() * Math.PI;
        m.rotation.z = (Math.random() - 0.5) * 0.22;
      } else {
        const s = 0.9 + Math.random() * 3.0;
        m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
        m.position.set(x, s * 0.5 - 0.6, z);
        m.rotation.set(Math.random(), Math.random(), Math.random());
      }
      m.castShadow = true; m.receiveShadow = true;
      this.debris.push(m); this.scene.add(m);
    }
  }

  // a bipedal AFW: head, torso, two arm-cannons (the "hands" that fire),
  // and two walking legs. Parts are kept in userData for locational damage.
  _buildAFW({ enemy }) {
    const g = new THREE.Group();
    const body = enemy ? 0x6b5a3a : 0x55603f;
    const accent = enemy ? 0xc0443a : 0x8a9a5b;
    const steel = 0x3a3f3a;
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, metalness: 0.28 });

    // pelvis
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.0, 2.8), mat(steel));
    pelvis.position.y = 6.0; pelvis.castShadow = true; g.add(pelvis);

    // torso
    const torso = new THREE.Group(); torso.position.y = 9.2;
    const chest = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.8, 3.2), mat(body)); chest.castShadow = true;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.2), mat(accent)); plate.position.set(0, 0.4, 1.7);
    torso.add(chest, plate); g.add(torso);

    // head
    const head = new THREE.Group(); head.position.y = 12.4;
    const skull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.6, 1.9), mat(body)); skull.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.2), mat(0x20242a)); visor.position.set(0, 0.1, 1.0);
    head.add(skull, visor); g.add(head);

    // arm cannons — the AFW fires from its hands
    const buildArm = (side) => {           // side: -1 / +1
      const arm = new THREE.Group(); arm.position.set(side * 3.2, 10.6, 0);
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.9, 1.9), mat(steel)); shoulder.castShadow = true;
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 7.2, 10), mat(steel));
      cannon.rotation.x = Math.PI / 2; cannon.position.set(0, -0.2, -3.6); cannon.castShadow = true;
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.8, 10), mat(0x222));
      muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.2, -7.2);
      const tip = new THREE.Object3D(); tip.position.set(0, -0.2, -7.7); arm.userData.tip = tip;
      arm.add(shoulder, cannon, muzzle, tip);
      return arm;
    };
    const armL = buildArm(-1), armR = buildArm(1); g.add(armL, armR);

    // walking legs (two)
    const buildLeg = (side) => {
      const leg = new THREE.Group(); leg.position.set(side * 1.5, 6.0, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.4, 1.6), mat(body)); thigh.position.y = -1.6; thigh.castShadow = true;
      const knee = new THREE.Group(); knee.position.y = -3.2;
      const shin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.4, 1.3), mat(steel)); shin.position.y = -1.6; shin.castShadow = true;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 3.0), mat(steel)); foot.position.set(0, -3.2, 0.4);
      knee.add(shin, foot); leg.add(thigh, knee); leg.userData.knee = knee;
      return leg;
    };
    const legL = buildLeg(-1), legR = buildLeg(1); g.add(legL, legR);

    g.userData.parts = { head, torso, armL, armR, legL, legR };
    g.userData.legs = [{ grp: legL, phase: 0 }, { grp: legR, phase: Math.PI }];
    g.rotation.y = enemy ? Math.PI : 0;    // enemy faces the camera
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
    this.scene.fog.near = night ? 90 : 130;
    this.scene.fog.far = night ? 760 : 980;
    this.scene.background.setHex(p.sky);
    this.groundMat.color.setHex(p.ground);
    this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.ambI;
    this.key.color.setHex(p.key); this.key.intensity = p.keyI;
    // sky dome + sun/moon + clouds
    this.skyU.top.value.setHex(p.skyTop);
    this.skyU.horizon.value.setHex(p.skyHorizon);
    this.sunGlow.material.color.setHex(p.sun); this.sunGlow.material.opacity = p.sunOp;
    this.sunGlow.scale.setScalar(p.sunScale);
    this.sunCore.material.color.setHex(p.sunCore); this.sunCore.scale.setScalar(p.sunScale * 0.3);
    this.clouds.forEach((c) => { c.material.color.setHex(p.cloud); c.material.opacity = p.cloudOp; });
  }

  update(state, dt) {
    this.t += dt;
    this.setEnv(state.env.night);

    // slow cloud drift
    for (const c of this.clouds) {
      c.position.x += c.userData.spd * dt;
      if (c.position.x > 1100) c.position.x = -1100;
    }

    // Both AFWs are constantly marching forward: scroll the battlefield
    // toward the camera (faster while relocating range) so the ground and
    // debris flow past, selling the advance without breaking the range system.
    const marching = state.moving > 0;
    const scroll = (marching ? 40 : 12) * dt;
    if (this.debris) {
      for (const m of this.debris) {
        m.position.z += scroll;
        if (m.position.z > this._zNear) {
          m.position.z = this._zFar;
          m.position.x = (Math.random() - 0.5) * 760;
        }
      }
    }

    // distance follows the current range
    this.targetDist = RANGE_DIST[state.env.range];
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 2.2);
    this._enemy.position.set(0, ENEMY_BASE_Y, -this.dist);

    // walking gait — the two legs stride in alternation, always marching
    const gait = marching ? 8 : 3.6;
    const amp = marching ? 0.6 : 0.34;
    this._enemy.userData.legs.forEach((leg) => {
      const a = Math.sin(this.t * gait + leg.phase) * amp;
      leg.grp.rotation.x = a;
      leg.grp.userData.knee.rotation.x = Math.max(0, -a) * 1.4;
    });
    this._enemy.position.y += Math.abs(Math.sin(this.t * gait)) * amp * 0.5;

    // reflect locational damage: destroyed parts char and sag
    if (state.foe && state.foe.parts) this._reflectDamage(this._enemy, state.foe.parts);

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

    // Post-fire shudder: the muzzle blast's shockwave keeps the heavy hull
    // vibrating for ~1.8s, fading steadily (linear) so the after-shake stays
    // clearly felt well after the initial recoil has settled.
    this.rumble = Math.max(0, this.rumble - dt * 0.55);
    const rb = this.rumble;                              // linear fade = sustained
    const T = this.t;
    const rumX = (Math.sin(T * 45) + 0.5 * Math.sin(T * 74)) * 0.30 * rb;
    const rumY = (Math.sin(T * 53 + 1) + 0.5 * Math.sin(T * 83)) * 0.34 * rb;
    const rumRoll  = Math.sin(T * 61 + 2) * 0.017 * rb;
    const rumPitch = Math.sin(T * 69) * 0.014 * rb;

    this.camera.position.set(
      this.kickPos.x + swayX + rumX + rnd() * rp,
      7.6 + this.kickPos.y + bobY + rumY + rnd() * rp,
      6 + this.kickPos.z + lurchZ + rnd() * rp * 0.5,
    );
    this.camera.rotation.set(
      -0.04 + sy + pitchG + this.kickRot.x + rumPitch + rnd() * rr,
      sx + this.kickRot.y + rnd() * rr,
      rollZ + this.kickRot.z + rumRoll + rnd() * rr * 0.7,
    );
    this.rig.position.copy(this.camera.position);
    this.rig.rotation.copy(this.camera.rotation);
    // foreground barrel slams backward then settles, shuddering as it does
    if (this.myBarrel) {
      this.myBarrel.position.z = this.barrelBaseZ + this.barrelKick * 2.2
        + Math.sin(T * 70) * 0.09 * rb;
    }

    // ---- scope zoom: tighten FOV as accuracy passes ~55% (sniper zoom-in) ----
    const acc = state.phase === 'battle' ? state.me.acc : 0;
    const zoom = Math.max(0, Math.min(1, (acc - 55) / 38));   // 55%→95%
    const targetFov = this._baseFov * (1 - 0.42 * zoom);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
      this.camera.updateProjectionMatrix();
    }

    this._consumeFx(state);
    this._updateEffects(dt);
    this._project(state);
    this.renderer.render(this.scene, this.camera);
  }

  // Project the enemy's part positions to screen so the HUD reticle and part
  // markers track the real AFW behind them (through zoom, march and sway).
  _project(state) {
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    const P = this._enemy.userData.parts;
    const pr = (node) => {
      node.getWorldPosition(v); v.project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    };
    const s = {};
    for (const k in P) s[k] = pr(P[k]);
    const dy = (PART_POS.head.y - PART_POS.torso.y) || 1;
    const dx = (PART_POS.armR.x - PART_POS.armL.x) || 1;
    state.screen = {
      parts: s, torso: s.torso, W, H,
      du: { x: (s.head.x - s.torso.x) / dy, y: (s.head.y - s.torso.y) / dy },
      dr: { x: (s.armR.x - s.armL.x) / dx, y: (s.armR.y - s.armL.y) / dx },
    };
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
        // our hand-cannon recoil: muzzle flash + heavy kick + after-shudder
        this._muzzleFlash(this._myMuzzleWorld(), 0xffd27a);
        this.kickRotVel.x += 1.0; this.kickRotVel.z += rnd() * 0.5;
        this.kickVel.y += 2.6; this.kickVel.z += 7.5;
        this.trauma = Math.max(this.trauma, 0.7);
        this.rumble = 1; this.barrelKick = 1;
      } else if (e.type === 'shot' && e.side === 'me') {
        // shell flies from our hand to the targeted enemy part (or wide on a miss)
        const from = this._myMuzzleWorld();
        const target = e.hit && e.part
          ? this._enemyPartWorld(e.part)
          : this._enemyPartWorld('torso').add(new THREE.Vector3((rnd() < 0 ? -1 : 1) * (14 + Math.random() * 14), 6 + Math.random() * 10, 0));
        const col = e.shrapnel ? 0xffd27a : (e.hit ? 0xfff0b0 : 0xffcc66);
        this._projectile(from, target, col, (p) => {
          if (e.hit) {
            this._explosion(p, e.kill ? 150 : (e.shrapnel ? 30 : 60));
            this.kickVel.z += 1.5; this.trauma = Math.max(this.trauma, e.kill ? 0.8 : 0.3);
            if (e.kill) { this._explosion(p, 90); state.killLanded = true; }
          } else this._dirt(p);
        });
      } else if (e.type === 'shot' && e.side === 'foe') {
        // enemy fires from its hand toward us; impact reaction on arrival
        const from = this._foeMuzzleWorld();
        const aimAt = this.camera.position.clone().add(new THREE.Vector3(rnd() * 2, -1, 2));
        const target = e.hit ? aimAt : aimAt.add(new THREE.Vector3((rnd() < 0 ? -1 : 1) * 18, 6 + Math.random() * 8, 0));
        this._muzzleFlash(from, 0xffae5a);
        this._projectile(from, target, e.hit ? 0xff8855 : 0xffcc66, (p) => {
          if (e.hit) {
            const d = Math.random() < 0.5 ? -1 : 1;
            this.kickVel.x += d * 10; this.kickVel.z += 6; this.kickVel.y += Math.abs(rnd()) * 5;
            this.kickRotVel.z += d * 1.7; this.kickRotVel.x += 0.9;
            this.trauma = 1; this.rumble = Math.max(this.rumble, 0.85); this._redFlash();
            if (e.kill) { this._explosion(p, 120); state.killLanded = true; }
          } else { this.kickVel.x += (Math.random() < 0.5 ? -1 : 1) * 3; this.trauma = Math.max(this.trauma, 0.25); }
        });
      } else if (e.type === 'evade') {
        const d = Math.random() < 0.5 ? -1 : 1;
        this.kickVel.x += d * 12; this.kickRotVel.z += d * 1.5;
        this.trauma = Math.max(this.trauma, 0.5);
      } else if (e.type === 'inffire') {
        this._infFlicker(e.side);
      }
    }
    state.fx.length = 0;
  }

  _myMuzzleWorld() { return this.myMuzzleLocal.clone().applyMatrix4(this.rig.matrixWorld); }
  _foeMuzzleWorld() {
    const arm = this._enemy.userData.parts.armR;
    return arm.userData.tip.getWorldPosition(new THREE.Vector3());
  }
  _enemyPartWorld(part) {
    const node = this._enemy.userData.parts[part] || this._enemy.userData.parts.torso;
    return node.getWorldPosition(new THREE.Vector3());
  }

  // char + sag destroyed parts (applied once when a part's coordination hits 0)
  _reflectDamage(mech, parts) {
    const P = mech.userData.parts;
    for (const name in parts) {
      const broken = parts[name].co <= 0;
      const node = P[name];
      if (!node || node.userData.broken === broken) continue;
      node.userData.broken = broken;
      if (broken) {
        node.traverse((o) => { if (o.material) o.material.color.setHex(0x241f1b); });
        if (name === 'armL') node.rotation.z = 0.6;
        else if (name === 'armR') node.rotation.z = -0.6;
        else if (name === 'legL' || name === 'legR') node.rotation.x = 0.5;
        else if (name === 'head') node.rotation.z = 0.5;
      }
    }
  }

  // a shell that visibly flies from -> to, then triggers onArrive at impact
  _projectile(from, to, color, onArrive) {
    const dir = to.clone().sub(from);
    const dist = dir.length(); dir.normalize();
    const dur = Math.max(0.08, Math.min(1.3, dist / 430));
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(2.0, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const light = new THREE.PointLight(color, 3, 70, 2);
    bolt.position.copy(from); light.position.copy(from);
    this.scene.add(bolt, light);
    let t = 0;
    this.effects.push((dt) => {
      t += dt; const k = Math.min(1, t / dur);
      const p = from.clone().addScaledVector(dir, dist * k);
      bolt.position.copy(p); light.position.copy(p);
      if (k >= 1) {
        this.scene.remove(bolt, light); bolt.geometry.dispose(); bolt.material.dispose();
        if (onArrive) onArrive(p);
        return false;
      }
      return true;
    });
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

  // tiny gunfire flicker for the supporting infantry crossfire
  _infFlicker(side) {
    const j = () => (Math.random() - 0.5);
    const pos = side === 'me'
      ? this.camera.position.clone().add(new THREE.Vector3(j() * 9, -6.5, -12 + j() * 5))
      : this._enemy.position.clone().add(new THREE.Vector3(j() * 6, -1.6, 3 + j() * 2));
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTex, color: side === 'me' ? 0xffe0a0 : 0xffcf9a,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.position.copy(pos); m.scale.setScalar(2 + Math.random() * 1.6);
    this.scene.add(m);
    let life = 0.12;
    this.effects.push((dt) => {
      life -= dt; m.material.opacity = Math.max(0, life / 0.12) * 0.9;
      if (life <= 0) { this.scene.remove(m); m.material.dispose(); return false; }
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
    // Portrait: widen the base vertical FOV so the framing holds on a tall
    // screen. The per-frame accuracy zoom narrows from this base.
    this._baseFov = aspect < 1 ? Math.min(74, 46 / Math.max(aspect, 0.45)) : 46;
    this.camera.fov = this._baseFov;
    this.camera.updateProjectionMatrix();
  }
}
