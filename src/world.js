// ============================================================
//  world.js — procedural low-poly 3D battlefield (Three.js)
//  Gunner first-person scope onto a cold, grim AFW duel.
// ============================================================
import * as THREE from 'three';
import { rangeSway, PART_POS } from './combat.js';

// engagement distances pulled far out — at this range a tiny aim wobble
// walks the point of impact from the head down to the legs (sniper feel)
const RANGE_DIST = { SHORT: 200, MEDIUM: 360, LONG: 520 };
const ENEMY_SCALE = 4.4;               // ~1/8 of screen height at MEDIUM range
const ENEMY_BASE_Y = 1.4 * ENEMY_SCALE - 0.6;    // keep the feet (~-1.4 local) on the ground
// our gunner rides atop our own AFW, so the sight is level with the enemy's
// mid-body — looking straight across, not craning up at it
const CAM_Y = ENEMY_BASE_Y + 6.5 * ENEMY_SCALE;

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

    // clean sky: no sun/clouds, only the gradient backdrop.
    this._glowTex = this._radialTexture();   // still used by infantry muzzle flickers
    this.sunGlow = null; this.sunCore = null; this.clouds = [];
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

    // battlefield kept clear of props — only the enemy AFW stands on it
    this.debris = [];
    this._zNear = 30; this._zFar = -950;
  }

  // a detailed bipedal AFW: head, torso, two arm-cannons (the "hands" that
  // fire), two walking legs. Part groups/pivots are preserved for locational
  // damage, projection and animation.
  _buildAFW({ enemy }) {
    const g = new THREE.Group();
    const body  = enemy ? 0x6f5d42 : 0x55603f;   // armour
    const body2 = enemy ? 0x5a4b36 : 0x47512f;   // darker panels
    const steel = 0x33373a;
    const dark  = 0x202327;
    const accent = enemy ? 0xc0443a : 0x8a9a5b;
    const trim  = enemy ? 0xd9a23a : 0xb8c06a;
    const mat = (c, m = 0.4, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: r, metalness: m });
    const visMat = new THREE.MeshStandardMaterial({ color: 0x123, emissive: enemy ? 0xff5a3a : 0x6fd0ff, emissiveIntensity: 0.9, flatShading: true });
    const box = (w, h, d, c, m, r) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, m, r));
    const cyl = (rt, rb, h, c, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c, 0.5, 0.6));
    const add = (parent, mesh, x, y, z, cast = true) => { mesh.position.set(x, y, z); mesh.castShadow = cast; parent.add(mesh); return mesh; };

    // ---- pelvis / hip ----
    add(g, box(4.0, 2.2, 3.0, body2), 0, 6.0, 0);
    add(g, box(4.6, 0.6, 3.2, steel), 0, 7.0, 0);            // belt
    add(g, box(2.2, 1.4, 1.0, dark), 0, 5.4, 1.5);           // crotch guard

    // ---- torso ----
    const torso = new THREE.Group(); torso.position.y = 9.4;
    add(torso, box(5.0, 4.6, 3.2, body), 0, 0, 0);           // chest core
    add(torso, box(5.6, 1.4, 3.4, body2), 0, 1.9, 0);        // upper deck
    const gla = add(torso, box(4.4, 2.0, 1.0, steel), 0, -0.4, 1.5); gla.rotation.x = -0.4;  // sloped glacis
    add(torso, box(1.4, 1.0, 0.3, visMat), 0, 0.2, 2.0, false);   // chest sensor (glow)
    add(torso, box(2.0, 0.5, 0.25, trim), 0, -1.4, 1.95);    // accent stripe
    add(torso, box(1.0, 1.6, 0.3, accent), -1.7, 0.4, 1.75); // unit marking
    // back thruster pack
    add(torso, box(3.6, 3.2, 1.4, body2), 0, 0.4, -2.0);
    add(torso, cyl(0.6, 0.7, 1.4, dark), -1.0, -1.2, -2.6).rotation.x = Math.PI / 2;
    add(torso, cyl(0.6, 0.7, 1.4, dark), 1.0, -1.2, -2.6).rotation.x = Math.PI / 2;
    // shoulder yokes
    add(torso, box(7.0, 1.4, 2.4, steel), 0, 1.6, 0);
    g.add(torso);

    // ---- head ----
    const head = new THREE.Group(); head.position.y = 12.6;
    add(head, box(2.0, 1.7, 2.0, body), 0, 0, 0);
    add(head, box(2.2, 0.5, 2.2, steel), 0, 0.9, 0);          // crest
    add(head, box(1.7, 0.5, 0.25, visMat), 0, 0.05, 1.05, false);  // visor glow
    add(head, cyl(0.06, 0.06, 1.6, trim), 0.8, 1.6, -0.3);   // antenna
    add(head, box(0.4, 0.7, 0.6, dark), -1.15, 0.1, 0.2);    // ear sensor L
    add(head, box(0.4, 0.7, 0.6, dark), 1.15, 0.1, 0.2);     // ear sensor R
    g.add(head);

    // ---- arm cannons (fire from the hands) ----
    const buildArm = (side) => {
      const arm = new THREE.Group(); arm.position.set(side * 3.4, 11.0, 0);
      add(arm, box(2.4, 2.4, 2.6, body), 0, 0, 0);                 // pauldron
      add(arm, box(2.7, 0.8, 2.9, steel), 0, 1.1, 0);              // pauldron cap
      add(arm, box(0.6, 1.2, 0.6, accent), side * 1.25, 0.2, 0.2); // shoulder accent
      add(arm, box(1.6, 1.6, 2.2, body2), 0, -1.6, 0);            // upper arm
      // cannon assembly pointing forward (-z)
      add(arm, box(1.8, 1.8, 3.4, steel), 0, -1.9, -2.2);         // breech housing
      add(arm, cyl(0.7, 0.7, 1.6, dark), 0, -1.9, -1.0);          // drum
      const barrel = add(arm, cyl(0.55, 0.7, 6.4, steel), 0, -1.9, -5.6); barrel.rotation.x = Math.PI / 2;
      add(arm, cyl(0.5, 0.5, 4.0, dark), 0, -1.9, -5.6).rotation.x = Math.PI / 2;  // bore
      const brake = add(arm, cyl(1.0, 1.0, 1.0, dark), 0, -1.9, -8.6); brake.rotation.x = Math.PI / 2; // muzzle brake
      add(arm, box(2.0, 0.3, 0.5, trim), 0, -2.85, -8.6, false);  // brake vents
      const tip = new THREE.Object3D(); tip.position.set(0, -1.9, -9.2); arm.add(tip); arm.userData.tip = tip;
      return arm;
    };
    const armL = buildArm(-1), armR = buildArm(1); g.add(armL, armR);

    // ---- walking legs ----
    const buildLeg = (side) => {
      const leg = new THREE.Group(); leg.position.set(side * 1.6, 6.0, 0);
      add(leg, box(2.2, 2.0, 2.4, body), 0, -0.4, 0);            // hip housing
      add(leg, box(1.9, 3.2, 1.9, body2), 0, -2.0, 0);          // thigh
      add(leg, box(2.1, 0.8, 2.1, steel), 0, -0.7, 0);          // thigh collar
      const knee = new THREE.Group(); knee.position.y = -3.4;
      add(knee, box(1.5, 1.4, 1.6, steel), 0, 0, 0);            // knee joint
      add(knee, box(1.0, 1.2, 0.4, accent), 0, 0, 1.0);         // knee guard
      add(knee, box(1.7, 3.2, 1.7, body), 0, -1.8, 0);          // shin
      add(knee, cyl(0.18, 0.18, 3.0, dark), side * 0.9, -1.6, 0.6); // hydraulic piston
      add(knee, box(2.4, 0.8, 4.0, steel), 0, -3.6, 0.5);       // foot
      add(knee, box(0.7, 0.6, 1.0, dark), -0.7, -3.7, 2.3);     // toe L
      add(knee, box(0.7, 0.6, 1.0, dark), 0.7, -3.7, 2.3);      // toe R
      leg.add(knee); leg.userData.knee = knee;
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
    // sky dome gradient only (no sun/clouds)
    this.skyU.top.value.setHex(p.skyTop);
    this.skyU.horizon.value.setHex(p.skyHorizon);
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

    // destroyed parts keep smoking / burning
    this._smokeT = (this._smokeT || 0) + dt;
    if (this._smokeT > 0.28 && state.foe && state.foe.parts) {
      this._smokeT = 0;
      const tmp = new THREE.Vector3();
      for (const name in state.foe.parts) {
        if (state.foe.parts[name].co <= 0) {
          const wp = this._enemy.userData.parts[name].getWorldPosition(tmp).clone();
          this._smoke(wp, 0x2a2622, 2.4, 6, 1.2);
          if (Math.random() < 0.4) this._smoke(wp, 0xff7a2a, 1.3, 5, 0.5);
        }
      }
    }

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

    const ending = state.phase === 'ending';
    if (ending) {
      // multi-angle bullet-time kill cam (no first-person rig)
      this.rig.visible = false;
      this._cineCam(dt, state);
    } else {
      this.rig.visible = true;
      this._endingPrev = false;
      this.camera.position.set(
        this.kickPos.x + swayX + rumX + rnd() * rp,
        CAM_Y + this.kickPos.y + bobY + rumY + rnd() * rp,
        6 + this.kickPos.z + lurchZ + rnd() * rp * 0.5,
      );
      this.camera.rotation.set(
        sy + pitchG + this.kickRot.x + rumPitch + rnd() * rr,
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
    }

    this._consumeFx(state);
    this._updateEffects(dt);
    if (!ending) this._project(state);
    this.renderer.render(this.scene, this.camera);
  }

  // Cinematic kill cam: cut between 5 angles over the ~10s slow-mo to show the
  // finishing shell's whole trajectory and impact from multiple perspectives.
  _cineCam(dt, state) {
    if (!this._endingPrev) { this._endingPrev = true; this._cineFov = 50; this._cineShot = -1; }
    const up = new THREE.Vector3(0, 1, 0);
    const S = this._killFrom ? this._killFrom.clone() : new THREE.Vector3(0, 8, 0);
    const E = this._killTo ? this._killTo.clone() : this._enemyPartWorld('torso');
    const P = (this._killActive && this._killPos) ? this._killPos.clone()
            : (this._killImpact ? this._killImpact.clone() : E.clone());
    const dir = E.clone().sub(S); const len = Math.max(1, dir.length()); dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const t = state.endStart ? (performance.now() - state.endStart) / 1000 : 0;
    const mid = (f) => S.clone().lerp(E, f);

    let idx, pos, look, fov;
    if (t < 2) {                 // 1: high wide establishing, following launch
      idx = 0; pos = mid(0.35).addScaledVector(side, len * 0.12 + 30).addScaledVector(up, 42); look = P; fov = 52;
    } else if (t < 4) {          // 2: low ground track, shell tearing past
      idx = 1; pos = mid(0.5).addScaledVector(side, 18).addScaledVector(up, 3.5); look = P; fov = 42;
    } else if (t < 6) {          // 3: opposite-side track
      idx = 2; pos = mid(0.68).addScaledVector(side, -(len * 0.1 + 28)).addScaledVector(up, 16); look = P; fov = 46;
    } else if (t < 8) {          // 4: reverse angle at the target, round streaking in
      idx = 3; pos = E.clone().addScaledVector(dir, -34).addScaledVector(side, 22).addScaledVector(up, 14); look = P.clone().lerp(E, 0.6); fov = 44;
    } else {                     // 5: impact close-up, slow orbit around the strike
      idx = 4; const a = t * 0.8;
      pos = E.clone().addScaledVector(side, Math.cos(a) * 16).addScaledVector(dir, Math.sin(a) * 16 - 4).addScaledVector(up, 9);
      look = E; fov = 40;
    }
    if (idx !== this._cineShot) { this._cineShot = idx; this.camera.position.copy(pos); }  // hard cut
    else this.camera.position.lerp(pos, Math.min(1, dt * 6));                                // gentle follow
    this.camera.lookAt(look);
    this._cineFov += (fov - this._cineFov) * Math.min(1, dt * 5);
    this.camera.fov = this._cineFov;
    this.camera.updateProjectionMatrix();
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
        if (e.kill) this._trackKill(from, target);
        this._projectile(from, target, col, (p) => {
          if (e.hit) {
            if (e.shrapnel) { this._explosion(p, 34); this._sparks(p, 0xffd27a, 8, 18); }
            else this._impactFx(e.part || 'torso', p, e.crit);
            this.kickVel.z += 1.2; this.trauma = Math.max(this.trauma, e.crit ? 0.5 : 0.3);
            if (e.kill) { this._explosion(p, 120); this._shockwave(p, 0xffffff, 32); this._killActive = false; this._killImpact = p.clone(); state.killLanded = true; }
          } else this._dirtGeyser(p);
        }, e.kill ? (p) => this._killPos.copy(p) : null);
      } else if (e.type === 'shot' && e.side === 'foe') {
        // enemy fires from its hand toward us; impact reaction on arrival
        const from = this._foeMuzzleWorld();
        const aimAt = this.camera.position.clone().add(new THREE.Vector3(rnd() * 2, -1, 2));
        const target = e.hit ? aimAt : aimAt.add(new THREE.Vector3((rnd() < 0 ? -1 : 1) * 18, 6 + Math.random() * 8, 0));
        this._muzzleFlash(from, 0xffae5a);
        if (e.kill) this._trackKill(from, target);
        this._projectile(from, target, e.hit ? 0xff8855 : 0xffcc66, (p) => {
          if (e.hit) {
            const d = Math.random() < 0.5 ? -1 : 1;
            this.kickVel.x += d * 10; this.kickVel.z += 6; this.kickVel.y += Math.abs(rnd()) * 5;
            this.kickRotVel.z += d * 1.7; this.kickRotVel.x += 0.9;
            this.trauma = 1; this.rumble = Math.max(this.rumble, 0.85); this._redFlash();
            const hitAt = this.camera.position.clone().add(new THREE.Vector3(rnd() * 6, -2, -10));
            this._sparks(hitAt, 0xffd27a, 14, 22); this._smoke(hitAt, 0x2a2622, 3, 7);
            if (e.crit) { this._whiteFlash(); this._critText(); this._shockwave(hitAt, 0xffffff, 26); this.trauma = 1.2; }
            if (e.kill) { this._explosion(p, 120); this._killActive = false; this._killImpact = p.clone(); state.killLanded = true; }
          } else { this.kickVel.x += (Math.random() < 0.5 ? -1 : 1) * 3; this.trauma = Math.max(this.trauma, 0.25); }
        }, e.kill ? (p) => this._killPos.copy(p) : null);
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

  // a shell that visibly flies from -> to; onStep(p,k) each frame, onArrive at impact
  _projectile(from, to, color, onArrive, onStep) {
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
      if (onStep) onStep(p, k);
      if (k >= 1) {
        this.scene.remove(bolt, light); bolt.geometry.dispose(); bolt.material.dispose();
        if (onArrive) onArrive(p);
        return false;
      }
      return true;
    });
  }

  // record a finishing shell so the cinematic kill cam can follow it
  _trackKill(from, to) {
    this._killFrom = from.clone(); this._killTo = to.clone();
    this._killPos = from.clone(); this._killImpact = null; this._killActive = true;
  }

  _muzzleFlash(pos, color) {
    // multi-layer muzzle blast: bright core + outer flame + flash light
    const light = new THREE.PointLight(color, 11, 60, 2);
    light.position.copy(pos); this.scene.add(light);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    const flame = new THREE.Mesh(new THREE.SphereGeometry(3.0, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.copy(pos); flame.position.copy(pos); this.scene.add(core, flame);
    this._sparks(pos, 0xffd27a, 10, 26);              // ejected sparks
    this._smoke(pos, 0x6b6256, 3.5, 5);               // muzzle smoke puff
    let life = 0.16;
    this.effects.push((dt) => {
      life -= dt; const k = Math.max(0, life / 0.16);
      light.intensity = 11 * k;
      core.material.opacity = k; core.scale.setScalar(1 + (1 - k) * 1.2);
      flame.material.opacity = k * 0.9; flame.scale.setScalar(1 + (1 - k) * 1.8);
      if (life <= 0) {
        this.scene.remove(light, core, flame);
        core.geometry.dispose(); core.material.dispose(); flame.geometry.dispose(); flame.material.dispose();
        return false;
      }
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

  // ---- VFX library ----------------------------------------------------

  // bright sparks flying out with gravity
  _sparks(pos, color, n = 12, speed = 22) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35),
        new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true }));
      s.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.scene.add(s); parts.push({ s, v });
    }
    let life = 0.5;
    this.effects.push((dt) => {
      life -= dt; const k = Math.max(0, life / 0.5);
      parts.forEach((p) => { p.v.y -= 42 * dt; p.s.position.addScaledVector(p.v, dt); p.s.material.opacity = k; });
      if (life <= 0) { parts.forEach((p) => { this.scene.remove(p.s); p.s.geometry.dispose(); p.s.material.dispose(); }); return false; }
      return true;
    });
  }

  // soft expanding, rising smoke puff
  _smoke(pos, color = 0x55504a, size = 4, rise = 6, dur = 1.1) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glowTex, color, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.copy(pos); m.scale.setScalar(size); this.scene.add(m);
    let life = dur;
    this.effects.push((dt) => {
      life -= dt; const k = Math.max(0, life / dur);
      m.material.opacity = k * 0.55; m.position.y += rise * dt; m.scale.setScalar(size * (1 + (1 - k) * 1.6));
      if (life <= 0) { this.scene.remove(m); m.material.dispose(); return false; }
      return true;
    });
  }

  // chunks of blown-off armor with gravity + spin that settle on the ground
  _debrisBurst(pos, color, n = 8, power = 16) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const sz = 0.5 + Math.random() * 1.4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz),
        new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }));
      m.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5)
        .normalize().multiplyScalar(power * (0.5 + Math.random()));
      const w = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(8);
      this.scene.add(m); parts.push({ m, v, w });
    }
    let life = 1.4;
    this.effects.push((dt) => {
      life -= dt;
      parts.forEach((p) => {
        p.v.y -= 36 * dt; p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < 0) { p.m.position.y = 0; p.v.y *= -0.3; p.v.x *= 0.6; p.v.z *= 0.6; }
        p.m.rotation.x += p.w.x * dt; p.m.rotation.y += p.w.y * dt;
      });
      if (life <= 0) { parts.forEach((p) => { this.scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); }); return false; }
      return true;
    });
  }

  // expanding shockwave ring (faces the camera)
  _shockwave(pos, color = 0xffffff, max = 26) {
    const geo = new THREE.RingGeometry(0.6, 1.4, 32);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos); this.scene.add(m);
    let life = 0.5;
    this.effects.push((dt) => {
      life -= dt; const k = Math.max(0, life / 0.5);
      m.lookAt(this.camera.position);
      m.scale.setScalar(1 + (1 - k) * max);
      m.material.opacity = k * 0.85;
      if (life <= 0) { this.scene.remove(m); geo.dispose(); m.material.dispose(); return false; }
      return true;
    });
  }

  // a tall dirt geyser where a missed shell strikes the ground
  _dirtGeyser(pos) {
    this._smoke(pos.clone().setY(Math.max(0, pos.y)), 0x6b6357, 5, 16, 1.0);
    this._debrisBurst(pos.clone().setY(0.5), 0x5a5346, 6, 12);
    this._sparks(pos, 0xa89878, 6, 12);
  }

  // location-specific impact effect for a hit on the enemy AFW
  _impactFx(part, pos, crit) {
    const SPARK = { head: 0x9fd8ff, torso: 0xffd27a, armL: 0xffae5a, armR: 0xffae5a, legL: 0xffe0a0, legR: 0xffe0a0 };
    const color = SPARK[part] || 0xffd27a;
    if (crit) { this._critFx(pos); return; }
    this._explosion(pos, part === 'torso' ? 70 : 48);
    this._sparks(pos, color, part === 'head' ? 18 : 12, part === 'head' ? 30 : 22);
    if (part === 'torso') this._debrisBurst(pos, 0x6b5a3a, 9, 18);
    else if (part === 'legL' || part === 'legR') { this._smoke(pos.clone().setY(0.5), 0x4a4036, 4, 5); this._debrisBurst(pos, 0x3a3f3a, 5, 14); }
    else this._debrisBurst(pos, 0x3a3f3a, 5, 14);
    this._smoke(pos, 0x2a2622, 3, 7);
  }

  // critical hit: big blast + shockwave + white flash + on-screen "CRITICAL"
  _critFx(pos) {
    this._explosion(pos, 150);
    this._shockwave(pos, 0xffffff, 34);
    this._sparks(pos, 0xfff0b0, 22, 34);
    this._debrisBurst(pos, 0x6b5a3a, 12, 22);
    this._smoke(pos, 0x201c18, 5, 9, 1.4);
    this.trauma = Math.max(this.trauma, 0.9);
    this._whiteFlash();
    this._critText();
  }

  _whiteFlash() {
    if (!this._white) {
      this._white = document.createElement('div');
      this._white.style.cssText = 'position:fixed;inset:0;z-index:26;pointer-events:none;background:rgba(255,255,255,.85);opacity:0;transition:opacity .12s';
      document.body.appendChild(this._white);
    }
    this._white.style.opacity = '1';
    setTimeout(() => { if (this._white) this._white.style.opacity = '0'; }, 70);
  }

  _critText() {
    if (!this._crit) {
      this._crit = document.createElement('div');
      this._crit.textContent = 'CRITICAL ・ 爆擊';
      this._crit.style.cssText = 'position:fixed;left:50%;top:38%;transform:translate(-50%,-50%) scale(.6);z-index:34;pointer-events:none;'
        + 'font-family:ui-monospace,monospace;font-weight:800;letter-spacing:.14em;font-size:clamp(1.4rem,6vw,2.6rem);'
        + 'color:#ff5a4a;text-shadow:0 0 16px rgba(255,80,60,.8),0 2px 6px #000;opacity:0;transition:opacity .12s,transform .18s';
      document.body.appendChild(this._crit);
    }
    const el = this._crit;
    el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%) scale(1.1)';
    clearTimeout(this._critT);
    this._critT = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(.6)'; }, 650);
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
