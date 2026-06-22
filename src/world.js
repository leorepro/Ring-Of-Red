// ============================================================
//  world.js — procedural low-poly 3D battlefield (Three.js)
//  Gunner first-person scope onto a cold, grim AFW duel.
// ============================================================
import * as THREE from 'three';
import { rangeSway, PART_POS } from './combat.js';
import { audio } from './audio.js';

// engagement distances pulled far out — at this range a tiny aim wobble
// walks the point of impact from the head down to the legs (sniper feel)
const RANGE_DIST = { SHORT: 400, MEDIUM: 720, LONG: 1040 };   // battlefield doubled out
const ENEMY_SCALE = 8.8;               // doubled with the range → ~1/8 screen height holds
const ENEMY_BASE_Y = 1.4 * ENEMY_SCALE - 0.6;    // keep the feet (~-1.4 local) on the ground
// our gunner rides atop our own AFW, so the sight is level with the enemy's
// mid-body — looking straight across, not craning up at it
const CAM_Y = ENEMY_BASE_Y + 6.5 * ENEMY_SCALE;

// bright clear-day vs night palettes
// (day = blue sky + white clouds over rolling green country, per Ring of Red)
const DAY = {
  fog: 0xbcd8ec, sky: 0x6fb0e6, ground: 0x6f9048,
  hemiSky: 0xcfe8ff, hemiGround: 0x586a38, key: 0xfff6e6, keyI: 2.0, ambI: 0.95,
  skyTop: 0x3a86d6, skyHorizon: 0xd9ecf7, sun: 0xffe6ad, sunCore: 0xfff4da,
  sunScale: 500, sunOp: 0.95, cloud: 0xffffff, cloudOp: 0.95,
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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
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
    this._buildTargetDesignator();
    this._buildInfantrySquads();
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
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 1; this.key.shadow.camera.far = 900;
    this.key.shadow.normalBias = 0.08;
    const d = 260;
    Object.assign(this.key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.rim = new THREE.SpotLight(0x9fd8ff, 0.0, 900, Math.PI / 7, 0.85, 1.4);
    this.rim.position.set(-210, 220, -620);
    this.rim.target.position.set(0, ENEMY_BASE_Y + 44, -RANGE_DIST.MEDIUM);
    this.rim.castShadow = true;
    this.rim.shadow.mapSize.set(1024, 1024);
    this.rim.shadow.normalBias = 0.1;
    this.scene.add(this.rim, this.rim.target);

    this.search = new THREE.SpotLight(0xffe2b0, 0.0, 720, Math.PI / 9, 0.92, 1.6);
    this.search.position.set(42, CAM_Y + 18, 38);
    this.search.target.position.set(0, ENEMY_BASE_Y + 42, -RANGE_DIST.MEDIUM);
    this.scene.add(this.search, this.search.target);
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

  _scorchTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.96)');
    grd.addColorStop(0.34, 'rgba(42,18,8,0.86)');
    grd.addColorStop(0.58, 'rgba(196,78,30,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 38; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 52;
      g.fillStyle = `rgba(255,${110 + Math.random() * 90},60,${0.06 + Math.random() * 0.12})`;
      g.beginPath();
      g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1 + Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
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

    this._glowTex = this._radialTexture();
    this._scorchTex = this._scorchTexture();
    this.sunGlow = null; this.sunCore = null;
    this._cloudTex = this._cloudTexture();
    this._buildClouds();
  }

  // soft puffy-cloud sprite texture (lumpy white blob, transparent edges)
  _cloudTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const blob = (x, y, r) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.92)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    for (let i = 0; i < 10; i++) blob(60 + Math.random() * 136, 90 + Math.random() * 76, 36 + Math.random() * 40);
    return new THREE.CanvasTexture(c);
  }

  // drifting cumulus clouds — clusters of soft white sprites high over the field
  _buildClouds() {
    this.clouds = [];
    for (let i = 0; i < 18; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._cloudTex, color: 0xffffff, transparent: true,
          opacity: 0.78 + Math.random() * 0.18, depthWrite: false, fog: false,
        }));
        const sc = 150 + Math.random() * 200;
        s.scale.set(sc, sc * 0.6, 1);
        s.position.set((Math.random() - 0.5) * sc * 1.3, (Math.random() - 0.5) * sc * 0.22, (Math.random() - 0.5) * sc * 0.7);
        cloud.add(s);
      }
      cloud.position.set((Math.random() - 0.5) * 3000, 320 + Math.random() * 360, -400 - Math.random() * 1100);
      cloud.userData.spd = 5 + Math.random() * 8;
      this.scene.add(cloud); this.clouds.push(cloud);
    }
  }

  // a small unit-marking decal (e.g. red "107"), drawn to a canvas texture
  _markTexture(text, color) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = color; g.font = 'bold 78px monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 52);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
  }

  _buildGround() {
    this.scene.fog = new THREE.Fog(DAY.fog, 150, 1600);
    this.scene.background = new THREE.Color(DAY.sky);

    // large low-poly displaced terrain (battlefield is long now)
    const geo = new THREE.PlaneGeometry(4200, 4200, 120, 120);
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
    this.groundMat = new THREE.MeshStandardMaterial({ color: DAY.ground, flatShading: true, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);

    this._buildBattlefieldSetDressing();
    this._buildGroundFog();
    this._zNear = 30; this._zFar = -1900;
  }

  _buildBattlefieldSetDressing() {
    this.debris = [];
    this.puddles = [];
    const mud = new THREE.MeshStandardMaterial({ color: 0x3e3a30, roughness: 0.98, metalness: 0 });
    const darkMud = new THREE.MeshStandardMaterial({ color: 0x272822, roughness: 1, metalness: 0 });
    const water = new THREE.MeshPhysicalMaterial({
      color: 0x465761, roughness: 0.08, metalness: 0, transmission: 0, transparent: true,
      opacity: 0.48, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.8,
    });
    const makeCrater = (x, z, s) => {
      const crater = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.4, s * 1.9, 0.28, 18), darkMud);
      crater.position.set(x, 0.08, z); crater.scale.y = 0.24; crater.receiveShadow = true;
      this.scene.add(crater); this.debris.push(crater);
    };
    const makePuddle = (x, z, sx, sz) => {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 32), water);
      puddle.rotation.x = -Math.PI / 2; puddle.position.set(x, 0.19, z); puddle.scale.set(sx, sz, 1);
      puddle.userData.baseScale = new THREE.Vector2(sx, sz);
      puddle.renderOrder = 1; this.scene.add(puddle); this.puddles.push(puddle); this.debris.push(puddle);
    };
    const makeWreck = (x, z, s, rot) => {
      const group = new THREE.Group(); group.position.set(x, 1.0, z); group.rotation.y = rot;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(9 * s, 2.0 * s, 4.2 * s), mud);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.38 * s, 0.48 * s, 10 * s, 10), mud);
      pipe.rotation.z = Math.PI / 2; pipe.position.set(1.8 * s, 1.3 * s, 0.7 * s);
      group.add(hull, pipe);
      group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(group); this.debris.push(group);
    };
    for (let i = 0; i < 18; i++) {
      makeCrater((Math.random() - 0.5) * 900, -120 - Math.random() * 1500, 6 + Math.random() * 14);
    }
    for (let i = 0; i < 8; i++) {
      makePuddle((Math.random() - 0.5) * 760, -160 - Math.random() * 1300, 10 + Math.random() * 28, 4 + Math.random() * 12);
    }
    for (let i = 0; i < 7; i++) {
      makeWreck((Math.random() - 0.5) * 820, -260 - Math.random() * 1450, 0.75 + Math.random() * 0.8, Math.random() * Math.PI);
    }
  }

  _buildGroundFog() {
    this.groundFog = [];
    const mat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0xaeb7bd, transparent: true, opacity: 0.18,
      depthWrite: false, fog: false, blending: THREE.NormalBlending,
    });
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.position.set((Math.random() - 0.5) * 1400, 7 + Math.random() * 16, -120 - Math.random() * 1500);
      s.scale.set(170 + Math.random() * 260, 28 + Math.random() * 44, 1);
      s.userData.spd = 5 + Math.random() * 10;
      s.userData.phase = Math.random() * Math.PI * 2;
      s.userData.baseOpacity = s.material.opacity;
      this.scene.add(s); this.groundFog.push(s);
    }
  }

  // a detailed bipedal AFW: head, torso, two arm-cannons (the "hands" that
  // fire), two walking legs. Part groups/pivots are preserved for locational
  // damage, projection and animation.
  _buildAFW({ enemy }) {
    const g = new THREE.Group();
    // desert-tan armoured battle frame (Ring of Red AFW): warm sand camo with
    // gunmetal joints and a red unit marking
    const body  = enemy ? 0xb89761 : 0x828c5f;   // main painted armour
    const body2 = enemy ? 0x7e6540 : 0x5f6b45;   // darker camo panels
    const steel = enemy ? 0x6f736e : 0x666c66;   // gunmetal joints
    const dark  = 0x282722;                       // exposed internals
    const accent = enemy ? 0xb23a2c : 0x3f6f9a;   // red (enemy) / blue (ally) marking
    const trim  = enemy ? 0xd0b46f : 0x6f8aa8;   // exposed edge trim
    const mat = (c, m = 0.28, r = 0.62) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const visMat = new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: enemy ? 0xff3b24 : 0x6fd0ff, emissiveIntensity: 1.8 });
    const box = (w, h, d, c, m, r) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, m, r));
    const cyl = (rt, rb, h, c, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c, 0.5, 0.6));
    const add = (parent, mesh, x, y, z, cast = true) => { mesh.position.set(x, y, z); mesh.castShadow = cast; parent.add(mesh); return mesh; };
    const plate = (parent, w, h, d, x, y, z, c = body, rx = 0, ry = 0, rz = 0) => {
      const p = add(parent, box(w, h, d, c, 0.22, 0.5), x, y, z);
      p.rotation.set(rx, ry, rz);
      const e = new THREE.LineSegments(
        new THREE.EdgesGeometry(p.geometry, 26),
        new THREE.LineBasicMaterial({ color: 0x1b1712, transparent: true, opacity: 0.38 }),
      );
      p.add(e);
      return p;
    };

    // ---- pelvis / hip ----
    add(g, box(4.0, 2.2, 3.0, body2), 0, 6.0, 0);
    add(g, box(4.6, 0.6, 3.2, steel, 0.75, 0.38), 0, 7.0, 0);            // belt
    add(g, box(2.2, 1.4, 1.0, dark), 0, 5.4, 1.5);           // crotch guard
    plate(g, 1.8, 0.55, 3.4, -2.0, 6.4, 0.15, body, 0, 0, -0.12);
    plate(g, 1.8, 0.55, 3.4, 2.0, 6.4, 0.15, body, 0, 0, 0.12);

    // ---- torso ----
    const torso = new THREE.Group(); torso.position.y = 9.4;
    add(torso, box(5.0, 4.6, 3.2, body), 0, 0, 0);           // chest core
    plate(torso, 2.5, 3.0, 0.6, -1.45, 0.2, 1.85, body, -0.18, -0.08, 0.04);
    plate(torso, 2.5, 3.0, 0.6, 1.45, 0.2, 1.85, body, -0.18, 0.08, -0.04);
    add(torso, box(5.6, 1.4, 3.4, body2), 0, 1.9, 0);        // upper deck
    const gla = add(torso, box(4.4, 2.0, 1.0, steel), 0, -0.4, 1.5); gla.rotation.x = -0.4;  // sloped glacis
    add(torso, box(1.4, 1.0, 0.3, visMat), 0, 0.2, 2.0, false);   // chest sensor (glow)
    add(torso, box(2.0, 0.5, 0.25, trim), 0, -1.4, 1.95);    // accent stripe
    add(torso, box(1.0, 1.6, 0.3, accent), -1.7, 0.4, 1.75); // unit marking
    // red "107" unit decal on the chest, like the reference frame
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5),
      new THREE.MeshBasicMaterial({ map: this._markTexture(enemy ? '107' : '74', enemy ? '#c4392b' : '#3f6f9a'), transparent: true }));
    mark.position.set(1.5, 0.5, 1.66); torso.add(mark);
    // back thruster pack
    add(torso, box(3.6, 3.2, 1.4, body2), 0, 0.4, -2.0);
    add(torso, cyl(0.6, 0.7, 1.4, dark), -1.0, -1.2, -2.6).rotation.x = Math.PI / 2;
    add(torso, cyl(0.6, 0.7, 1.4, dark), 1.0, -1.2, -2.6).rotation.x = Math.PI / 2;
    add(torso, box(0.28, 4.2, 0.28, trim, 0.7, 0.24), -2.85, 0.1, 0.2);
    add(torso, box(0.28, 4.2, 0.28, trim, 0.7, 0.24), 2.85, 0.1, 0.2);
    // shoulder yokes
    add(torso, box(7.0, 1.4, 2.4, steel, 0.7, 0.38), 0, 1.6, 0);
    g.add(torso);

    // ---- head ----
    const head = new THREE.Group(); head.position.y = 12.6;
    add(head, box(2.0, 1.7, 2.0, body), 0, 0, 0);
    plate(head, 1.0, 1.35, 0.42, -0.62, 0, 1.16, body2, -0.08, -0.16, 0);
    plate(head, 1.0, 1.35, 0.42, 0.62, 0, 1.16, body2, -0.08, 0.16, 0);
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
      plate(arm, 2.95, 0.62, 2.95, 0, 1.2, 0, body2, 0, 0, side * 0.08);
      add(arm, box(0.6, 1.2, 0.6, accent), side * 1.25, 0.2, 0.2); // shoulder accent
      add(arm, box(1.6, 1.6, 2.2, body2), 0, -1.6, 0);            // upper arm
      add(arm, cyl(0.16, 0.16, 3.2, trim, 8), side * 0.75, -1.6, 0.55).rotation.x = 0.25;
      // long low-recoil cannon pointing forward (-z), thin and far-reaching
      add(arm, box(1.8, 1.8, 3.4, steel, 0.8, 0.32), 0, -1.9, -2.2);         // breech housing
      add(arm, cyl(0.7, 0.7, 1.6, dark), 0, -1.9, -1.0);          // drum
      const barrel = add(arm, cyl(0.42, 0.6, 10.0, steel), 0, -1.9, -7.6); barrel.rotation.x = Math.PI / 2;
      add(arm, cyl(0.34, 0.34, 6.0, dark), 0, -1.9, -7.6).rotation.x = Math.PI / 2;  // bore
      const brake = add(arm, cyl(0.85, 0.85, 1.1, dark), 0, -1.9, -12.4); brake.rotation.x = Math.PI / 2; // muzzle brake
      add(arm, box(1.7, 0.3, 0.5, trim), 0, -2.7, -12.4, false);  // brake vents
      const tip = new THREE.Object3D(); tip.position.set(0, -1.9, -13.0); arm.add(tip); arm.userData.tip = tip;
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
      plate(knee, 1.45, 1.3, 0.46, 0, 0, 1.0, accent, -0.18, 0, 0);
      add(knee, box(1.7, 3.2, 1.7, body), 0, -1.8, 0);          // shin
      add(knee, cyl(0.18, 0.18, 3.0, trim, 10), side * 0.9, -1.6, 0.6); // hydraulic piston
      plate(knee, 1.9, 2.6, 0.52, 0, -1.8, 0.98, body2, -0.12, 0, 0);
      add(knee, box(2.4, 0.8, 4.0, steel, 0.78, 0.36), 0, -3.6, 0.5);       // foot
      add(knee, box(0.7, 0.6, 1.0, dark), -0.7, -3.7, 2.3);     // toe L
      add(knee, box(0.7, 0.6, 1.0, dark), 0.7, -3.7, 2.3);      // toe R
      leg.add(knee); leg.userData.knee = knee;
      leg.userData.gaitDriven = true;
      return leg;
    };
    const legL = buildLeg(-1), legR = buildLeg(1); g.add(legL, legR);

    g.userData.parts = { head, torso, armL, armR, legL, legR };
    // stable rest-position anchors (local to the mech) used for HUD projection,
    // so a blown-off / tumbling part's debris never drags the targeting markers
    g.userData.partAnchors = {
      head: head.position.clone(), torso: torso.position.clone(),
      armL: armL.position.clone(), armR: armR.position.clone(),
      legL: legL.position.clone(), legR: legR.position.clone(),
    };
    g.userData.legs = [{ grp: legL, phase: 0 }, { grp: legR, phase: Math.PI }];
    g.rotation.y = enemy ? Math.PI : 0;    // enemy faces the camera
    const outline = new THREE.Box3().setFromObject(g);
    g.userData.height = outline.max.y - outline.min.y;
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

  _buildTargetDesignator() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fffd0, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.designator = new THREE.Group();
    const rings = [
      { r: 1.0, tube: 0.018 },
      { r: 0.62, tube: 0.012 },
      { r: 1.34, tube: 0.01 },
    ];
    rings.forEach((cfg, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(cfg.r, cfg.tube, 6, 72), mat.clone());
      ring.userData.spin = i % 2 ? -1 : 1;
      this.designator.add(ring);
    });
    this.scene.add(this.designator);
  }

  _buildInfantrySquads() {
    this.infantrySquads = {
      me: this._makeInfantrySquad(false, 3),
      foe: this._makeInfantrySquad(true, 3),
    };
    this.scene.add(this.infantrySquads.me, this.infantrySquads.foe);
  }

  _makeInfantrySquad(enemy, count = 3) {
    const group = new THREE.Group();
    group.userData.slots = [];
    const coat = new THREE.MeshStandardMaterial({
      color: enemy ? 0x6b4b34 : 0x425c3d,
      roughness: 0.86,
      metalness: 0.06,
      flatShading: true,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1b18, roughness: 0.9, metalness: 0.1, flatShading: true });
    const helm = new THREE.MeshStandardMaterial({ color: enemy ? 0x3a3027 : 0x2d3a2d, roughness: 0.82, metalness: 0.12, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb58a62, roughness: 0.9, metalness: 0, flatShading: true });
    const hpBack = new THREE.MeshBasicMaterial({ color: 0x160f0d, transparent: true, opacity: 0.78, depthWrite: false });
    const hpFill = new THREE.MeshBasicMaterial({ color: enemy ? 0xff5a4a : 0x7fd07f, transparent: true, opacity: 0.9, depthWrite: false });
    const add = (parent, mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    for (let i = 0; i < count; i++) {
      const s = new THREE.Group();
      const col = i - (count - 1) / 2;
      s.position.set(col * 18 + (Math.random() - 0.5) * 3, 1.45, (Math.random() - 0.5) * 8);
      add(s, new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 1.9, 6), coat), 0, 1.05, 0);
      add(s, new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 5), skin), 0, 2.26, 0.05);
      add(s, new THREE.Mesh(new THREE.SphereGeometry(0.48, 7, 4), helm), 0, 2.43, 0.02);
      const pack = add(s, new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.34), dark), 0, 1.14, 0.52);
      pack.rotation.x = -0.12;
      const rifle = add(s, new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.1, 6), dark), 0.38, 1.58, -0.9);
      rifle.rotation.x = Math.PI / 2;
      rifle.rotation.z = 0.18;
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0.38, 1.58, -2.05);
      s.add(muzzle);
      const bar = new THREE.Group();
      const back = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.34), hpBack.clone());
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hpFill.clone());
      fill.scale.set(2.72, 0.18, 1);
      fill.position.z = 0.01;
      bar.add(back, fill);
      bar.position.set(0, 3.35, 0);
      s.add(bar);
      s.userData.muzzle = muzzle;
      s.userData.hpBar = bar;
      s.userData.hpFill = fill;
      s.userData.phase = Math.random() * Math.PI * 2;
      s.userData.downSide = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.3);
      s.scale.setScalar(1.45 + Math.random() * 0.25);
      group.add(s);
      group.userData.slots.push(s);
    }
    return group;
  }

  _updateTargetDesignator(pos, state, lock01, dt) {
    if (!this.designator) return;
    const active = state.phase === 'battle' && state.me && state.me.acc > 18;
    this.designator.visible = active;
    if (!active) return;
    this.designator.position.copy(pos);
    this.designator.lookAt(this.camera.position);
    const scale = 7.5 + lock01 * 6.5 + Math.sin(this.t * 5.5) * 0.35;
    this.designator.scale.setScalar(scale);
    const hot = lock01 > 0.62;
    this.designator.children.forEach((ring, i) => {
      ring.rotation.z += (0.8 + i * 0.35) * ring.userData.spin * dt;
      ring.material.opacity = (hot ? 0.44 : 0.22) * (0.65 + lock01 * 0.55) * (i === 1 ? 0.7 : 1);
      ring.material.color.setHex(hot ? 0x7fffd0 : 0xe6b53a);
    });
  }

  _updateInfantrySquads(state, dt, relocating) {
    if (!this.infantrySquads) return;
    const updateSide = (side, unit, basePos, facing) => {
      const group = this.infantrySquads[side];
      if (!group || !unit) return;
      group.position.copy(basePos);
      group.rotation.y = facing;
      const slots = group.userData.slots || [];
      slots.forEach((s, i) => {
        const member = unit.squad && unit.squad[i];
        s.visible = !!member;
        if (!member) return;
        const down = member.down || member.hp <= 0;
        s.userData.active = !down;
        if (s.userData.hpBar) {
          s.userData.hpBar.visible = !down;
          s.userData.hpBar.lookAt(this.camera.position);
        }
        if (s.userData.hpFill && member.maxHp) {
          const ratio = Math.max(0, Math.min(1, member.hp / member.maxHp));
          s.userData.hpFill.scale.x = 2.72 * ratio;
          s.userData.hpFill.position.x = -1.36 * (1 - ratio);
        }
        if (down) {
          if (!s.userData.wasDown) {
            const wp = s.getWorldPosition(new THREE.Vector3());
            this._smoke(wp, 0x5a5146, 1.8, 2.4, 0.65);
            this._sparks(wp, 0xffd27a, 4, 9);
            audio.soldierDown();
          }
          s.userData.wasDown = true;
          s.position.y = 0.34;
          s.rotation.x = Math.PI / 2;
          s.rotation.z = s.userData.downSide;
          return;
        }
        s.userData.wasDown = false;
        const moving = relocating || !unit.halted;
        const step = moving ? 5.5 : 2.0;
        const bob = Math.sin(this.t * step + s.userData.phase) * (moving ? 0.18 : 0.04);
        s.position.y = 1.45 + Math.abs(bob);
        s.rotation.x = 0;
        s.rotation.z = Math.sin(this.t * step + s.userData.phase) * (moving ? 0.05 : 0.015);
      });
    };
    updateSide('foe', state.foe, new THREE.Vector3(0, 0, -this.dist + 58), Math.PI);
    updateSide('me', state.me, new THREE.Vector3(0, 0, -92), 0);
  }

  // ---------- per-frame ----------
  setEnv(night) {
    if (this.lastNight === night) return;
    this.lastNight = night;
    const p = night ? NIGHT : DAY;
    this.scene.fog.color.setHex(p.fog);
    this.scene.fog.near = night ? 140 : 200;
    this.scene.fog.far = night ? 1300 : 1600;
    this.scene.background.setHex(p.sky);
    this.groundMat.color.setHex(p.ground);
    this.hemi.color.setHex(p.hemiSky); this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.ambI;
    this.key.color.setHex(p.key); this.key.intensity = p.keyI;
    this.rim.color.setHex(night ? 0x9fd8ff : 0xffe0b0);
    this.rim.intensity = night ? 7.5 : 2.6;
    this.search.color.setHex(night ? 0xcfe8ff : 0xffddb0);
    this.search.intensity = night ? 6.2 : 1.8;
    if (this.groundFog) {
      this.groundFog.forEach((s) => {
        s.material.color.setHex(night ? 0x7d8b9a : 0xd0d8d8);
        s.userData.baseOpacity = night ? 0.24 : 0.15;
        s.material.opacity = s.userData.baseOpacity;
      });
    }
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
      if (c.position.x > 1700) c.position.x = -1700;
    }
    if (this.groundFog) {
      for (const s of this.groundFog) {
        s.position.x += Math.sin(this.t * 0.2 + s.userData.phase) * dt * 6 + s.userData.spd * dt;
        s.material.opacity = s.userData.baseOpacity * (0.84 + Math.sin(this.t * 0.35 + s.userData.phase) * 0.16);
        if (s.position.x > 850) s.position.x = -850;
      }
    }
    if (this.puddles) {
      for (const p of this.puddles) {
        const k = 1 + Math.sin(this.t * 1.4 + p.position.x * 0.02) * 0.018;
        p.scale.set(p.userData.baseScale.x * k, p.userData.baseScale.y / k, 1);
      }
    }

    // Both AFWs are constantly marching forward: scroll the battlefield
    // toward the camera (faster while relocating range) so the ground and
    // debris flow past, selling the advance without breaking the range system.
    const relocating = state.moving > 0;
    const meMarching = !(state.me && state.me.halted);
    const scroll = (relocating ? 40 : meMarching ? 14 : 0) * dt;
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
    this.key.target.position.set(0, ENEMY_BASE_Y + 30, -this.dist);
    this.rim.target.position.set(0, ENEMY_BASE_Y + 42, -this.dist);
    const targetPart = state.me ? state.me.targetPart : 'torso';
    const targetWorld = this._enemyPartWorld(targetPart);
    this.search.target.position.copy(targetWorld);
    const lock01 = state.me ? Math.min(1, state.me.acc / 92) : 0;
    this.search.intensity = (state.env.night ? 4.8 : 1.15) + lock01 * (state.env.night ? 3.0 : 2.4);
    this._updateTargetDesignator(targetWorld, state, lock01, dt);

    // walking gait — strides while marching, settles to a near-stop when halted
    const foeMarching = !(state.foe && state.foe.halted);
    const gait = foeMarching ? (relocating ? 8 : 5) : 1.4;
    const amp = foeMarching ? (relocating ? 0.6 : 0.42) : 0.07;
    this._enemy.userData.legs.forEach((leg) => {
      const a = Math.sin(this.t * gait + leg.phase) * amp;
      leg.grp.rotation.x = a;
      leg.grp.userData.knee.rotation.x = Math.max(0, -a) * 1.4;
    });
    this._enemy.position.y += Math.abs(Math.sin(this.t * gait)) * amp * 0.5;
    this._updateInfantrySquads(state, dt, relocating);

    // reflect locational damage: armor wears down progressively, then breaks.
    if (state.foe && state.foe.parts) {
      this._reflectWear(this._enemy, state.foe.parts);
      this._reflectDamage(this._enemy, state.foe.parts);
    }
    this._animateHitReactions(dt);

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
    // detached parts (blown-off arms) tumble and fall away
    for (const nm in this._enemy.userData.parts) {
      const node = this._enemy.userData.parts[nm]; const f = node.userData.fall;
      if (f) {
        f.vy -= 22 * dt;
        node.position.x += f.vx * dt; node.position.y += f.vy * dt; node.position.z += (f.vz || 0) * dt;
        node.rotation.z += f.vr * dt; node.rotation.x += (f.vrx || 0) * dt;
        f.life -= dt; if (f.life <= 0) { node.visible = false; node.userData.fall = null; }
      }
    }

    // gunner aim micro-sway (shrinks as accuracy climbs)
    const sway = state.phase === 'battle' ? rangeSway(state) * 0.006 : 0.003;
    const sx = Math.sin(this.t * 1.7) * sway;
    const sy = Math.cos(this.t * 1.3) * sway * 0.7;

    // ---- walking-gait motion: halt = planted & steady, march = weaving sway ----
    const fastMove = state.moving > 0;                    // relocating range
    const marching = !(state.me && state.me.halted);      // default stance keeps moving
    const step = (fastMove ? 1.45 : marching ? 1.1 : 0.7) * Math.PI * 2;
    const ph = this.t * step;
    const weight = fastMove ? 0.85 : marching ? 0.55 : 0.16;   // halt barely shifts
    const swayX  = Math.sin(ph) * 0.34 * weight;
    const bobY   = Math.sin(ph * 2) * 0.13 * weight;
    const lurchZ = fastMove
      ? (0.6 - Math.cos(ph * 2) * 0.6) * 1.0
      : Math.sin(ph * 2) * 0.05 * weight;
    const rollZ  = Math.sin(ph) * 0.016 * weight;
    const pitchG = Math.sin(ph * 2 + 0.6) * 0.012 * weight;

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
    const dir = E.clone().sub(S); dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const t = state.endStart ? (performance.now() - state.endStart) / 1000 : 0;
    // frame every shot around the enemy at a radius tied to its size, so the
    // doomed AFW always fills the frame as the finishing round streaks in
    const R = ENEMY_SCALE * 15;

    let idx, pos, look, fov;
    if (t < 2) {                 // 1: high 3/4 front establishing
      idx = 0; pos = E.clone().addScaledVector(dir, -2.4 * R).addScaledVector(side, 1.3 * R).addScaledVector(up, 1.5 * R); look = E; fov = 46;
    } else if (t < 4) {          // 2: low front hero shot, craning up at the mech
      idx = 1; pos = E.clone().addScaledVector(dir, -1.9 * R).addScaledVector(side, -1.4 * R).addScaledVector(up, 0.3 * R); look = E.clone().addScaledVector(up, 0.5 * R); fov = 40;
    } else if (t < 6) {          // 3: side profile, the shell crossing the frame
      idx = 2; pos = E.clone().addScaledVector(side, 2.7 * R).addScaledVector(up, 0.9 * R).addScaledVector(dir, -0.2 * R); look = P.clone().lerp(E, 0.5); fov = 44;
    } else if (t < 8) {          // 4: reverse angle behind the enemy, round streaking in
      idx = 3; pos = E.clone().addScaledVector(dir, 1.7 * R).addScaledVector(side, 1.1 * R).addScaledVector(up, 1.3 * R); look = E; fov = 52;
    } else {                     // 5: slow orbit close-up on the strike
      idx = 4; const a = t * 0.7;
      pos = E.clone().addScaledVector(side, Math.cos(a) * 1.7 * R).addScaledVector(dir, Math.sin(a) * 1.7 * R).addScaledVector(up, 0.9 * R);
      look = E; fov = 38;
    }
    if (idx !== this._cineShot) { this._cineShot = idx; this.camera.position.copy(pos); }  // hard cut
    else this.camera.position.lerp(pos, Math.min(1, dt * 4));                                // gentle follow
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
    // project the parts' stable rest anchors (through the mech's world matrix)
    // rather than the live nodes, so detached/falling debris can't skew markers
    this._enemy.updateWorldMatrix(true, false);
    const m = this._enemy.matrixWorld;
    const A = this._enemy.userData.partAnchors;
    const pr = (anchor) => {
      v.copy(anchor).applyMatrix4(m).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    };
    const s = {};
    for (const k in A) s[k] = pr(A[k]);
    const support = [];
    const foeSlots = (this.infantrySquads && this.infantrySquads.foe && this.infantrySquads.foe.userData.slots) || [];
    if (this.infantrySquads && this.infantrySquads.foe) this.infantrySquads.foe.updateWorldMatrix(true, true);
    foeSlots.forEach((slot) => {
      const p = slot.getWorldPosition(new THREE.Vector3());
      p.y += 5.2;
      p.project(this.camera);
      support.push({
        x: (p.x * 0.5 + 0.5) * W,
        y: (-p.y * 0.5 + 0.5) * H,
        visible: slot.visible,
        active: !!slot.userData.active,
      });
    });
    const dy = (PART_POS.head.y - PART_POS.torso.y) || 1;
    const dx = (PART_POS.armR.x - PART_POS.armL.x) || 1;
    state.screen = {
      parts: s, support, torso: s.torso, W, H,
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
        audio.fire(e.weapon || 'cannon');
        this.kickRotVel.x += 1.0; this.kickRotVel.z += rnd() * 0.5;
        this.kickVel.y += 2.6; this.kickVel.z += 7.5;
        this.trauma = Math.max(this.trauma, 0.7);
        this.rumble = 1; this.barrelKick = 1;
      } else if (e.type === 'shot' && e.side === 'me') {
        // shell flies from our hand to the targeted enemy part (or wide on a miss)
        const from = this._myMuzzleWorld();
        const target = e.hit && Number.isInteger(e.support)
          ? this._supportWorld(e.support)
          : e.hit && e.part
          ? this._enemyPartWorld(e.part)
          : this._enemyPartWorld('torso').add(new THREE.Vector3((rnd() < 0 ? -1 : 1) * (14 + Math.random() * 14), 6 + Math.random() * 10, 0));
        if (e.kill) this._trackKill(from, target);
        const arrive = (p) => {
          if (e.hit) {
            if (e.shrapnel) { this._explosion(p, 34); this._sparks(p, 0xffd27a, 8, 18); audio.impact('shrap', false); }
            else { this._impactFx(e.part || 'torso', p, e.crit, e.weapon); e.crit ? audio.crit() : audio.impact(e.weapon, false); }
            this.kickVel.z += 1.2; this.trauma = Math.max(this.trauma, e.crit ? 0.5 : 0.3);
            if (e.kill) { this._explosion(p, 120); this._shockwave(p, 0xffffff, 32); this._killActive = false; this._killImpact = p.clone(); state.killLanded = true; }
          } else this._dirtGeyser(p);
        };
        const onStep = e.kill ? (p) => this._killPos.copy(p) : null;
        this._fireWeaponVfx(e.weapon, from, target, arrive, onStep, e.hit);
      } else if (e.type === 'shot' && e.side === 'foe') {
        // enemy fires from its hand toward us; impact reaction on arrival
        const from = this._foeMuzzleWorld();
        const aimAt = this.camera.position.clone().add(new THREE.Vector3(rnd() * 2, -1, 2));
        const target = e.hit ? aimAt : aimAt.add(new THREE.Vector3((rnd() < 0 ? -1 : 1) * 18, 6 + Math.random() * 8, 0));
        this._muzzleFlash(from, 0xffae5a);
        audio.enemyFire();
        if (e.kill) this._trackKill(from, target);
        this._projectile(from, target, e.hit ? 0xff8855 : 0xffcc66, (p) => {
          if (e.hit) {
            const d = Math.random() < 0.5 ? -1 : 1;
            this.kickVel.x += d * 10; this.kickVel.z += 6; this.kickVel.y += Math.abs(rnd()) * 5;
            this.kickRotVel.z += d * 1.7; this.kickRotVel.x += 0.9;
            this.trauma = 1; this.rumble = Math.max(this.rumble, 0.85); this._redFlash();
            const hitAt = this.camera.position.clone().add(new THREE.Vector3(rnd() * 6, -2, -10));
            this._sparks(hitAt, 0xffd27a, 14, 22); this._smoke(hitAt, 0x2a2622, 3, 7);
            e.crit ? audio.crit() : audio.hitTaken();
            if (e.crit) { this._whiteFlash(); this._critText(); this._shockwave(hitAt, 0xffffff, 26); this.trauma = 1.2; }
            if (e.kill) { this._explosion(p, 120); this._killActive = false; this._killImpact = p.clone(); state.killLanded = true; }
          } else { this.kickVel.x += (Math.random() < 0.5 ? -1 : 1) * 3; this.trauma = Math.max(this.trauma, 0.25); }
        }, e.kill ? (p) => this._killPos.copy(p) : null);
      } else if (e.type === 'evade') {
        const d = Math.random() < 0.5 ? -1 : 1;
        this.kickVel.x += d * 12; this.kickRotVel.z += d * 1.5;
        this.trauma = Math.max(this.trauma, 0.5);
        audio.dodge();
      } else if (e.type === 'inffire') {
        this._infFlicker(e.side, e.unit);
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
  _supportWorld(index) {
    const slots = (this.infantrySquads && this.infantrySquads.foe && this.infantrySquads.foe.userData.slots) || [];
    const slot = slots[index];
    if (!slot) return this._enemyPartWorld('torso');
    const p = slot.getWorldPosition(new THREE.Vector3());
    p.y += 2.2;
    return p;
  }

  // char + sag destroyed parts (applied once when a part's coordination hits 0)
  _reflectDamage(mech, parts) {
    const P = mech.userData.parts;
    for (const name in parts) {
      const broken = parts[name].co <= 0;
      const node = P[name];
      if (!node || node.userData.broken === broken) continue;
      node.userData.broken = broken;
      if (broken) this._destroyPart(name, node);
    }
  }

  _reflectWear(mech, parts) {
    const P = mech.userData.parts;
    for (const name in parts) {
      const node = P[name];
      if (!node || node.userData.broken) continue;
      const co = parts[name].co;
      const level = co < 30 ? 2 : co < 65 ? 1 : 0;
      if (node.userData.wearLevel === level) continue;
      node.userData.wearLevel = level;
      node.traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.color) return;
        if (!o.material.userData.baseColor) {
          o.material = o.material.clone();
          o.material.userData.baseColor = o.material.color.clone();
          if (o.material.emissive) o.material.userData.baseEmissive = o.material.emissive.clone();
        }
        const base = o.material.userData.baseColor;
        if (level === 0) {
          o.material.color.copy(base);
          if (o.material.emissive && o.material.userData.baseEmissive) o.material.emissive.copy(o.material.userData.baseEmissive);
          return;
        }
        const worn = level === 1 ? new THREE.Color(0x5b5044) : new THREE.Color(0x241b16);
        o.material.color.copy(base).lerp(worn, level === 1 ? 0.38 : 0.7);
        o.material.roughness = Math.min(1, (o.material.roughness || 0.6) + 0.18);
        if (o.material.emissive) {
          o.material.emissive.setHex(level === 2 ? 0x3a1006 : 0x080402);
          o.material.emissiveIntensity = level === 2 ? 0.32 : 0.08;
        }
      });
      if (level > 0) {
        const wp = node.getWorldPosition(new THREE.Vector3());
        this._smoke(wp, level === 2 ? 0x2a201b : 0x4c443c, level === 2 ? 2.4 : 1.7, level === 2 ? 4 : 2.5, 0.75);
      }
    }
  }

  // dramatic per-part destruction the moment a part's coordination hits 0
  _destroyPart(name, node) {
    const wp = node.getWorldPosition(new THREE.Vector3());
    audio.explosion(true);
    node.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.color.setHex(0x201b16); o.material.emissive && o.material.emissive.setHex(0x000000); } });
    if (name === 'head') {
      // head blown off — explode and detach upward
      this._explosion(wp, 160); this._shockwave(wp, 0xfff0b0, 24);
      this._sparks(wp, 0x9fd8ff, 26, 34); this._debrisBurst(wp, 0x33373a, 12, 24);
      node.visible = false;                       // decapitated
      const stump = node; setTimeout(() => {}, 0);
      void stump;
    } else if (name === 'armL' || name === 'armR') {
      // arm cannon blown clean off — big blast, the whole arm launches away,
      // tumbling, with a sparking severed shoulder
      this._explosion(wp, 175); this._shockwave(wp, 0xffd27a, 26);
      this._sparks(wp, 0xffae5a, 28, 40); this._debrisBurst(wp, 0xa8854f, 16, 30);
      const dir = name === 'armL' ? 1 : -1;
      node.userData.fall = { vx: dir * 16, vy: 11, vz: -5, vr: dir * 9, vrx: 6, life: 2.6 };
    } else if (name === 'legL' || name === 'legR') {
      // leg crippled — buckles, mech lists to that side
      this._explosion(wp, 130); this._sparks(wp, 0xffe0a0, 18, 24); this._debrisBurst(wp, 0x33373a, 10, 18);
      node.rotation.x = 0.7; node.position.y -= 0.6;
      this._enemy.rotation.z = (name === 'legL' ? 1 : -1) * 0.12;   // hull tilts
    } else if (name === 'torso') {
      this._explosion(wp, 150); this._smoke(wp, 0x201c18, 6, 9, 1.6);
    }
  }

  // per-weapon shot visuals: each gun fires a distinct projectile (or a spread
  // / burst of them). Only the "primary" round carries the impact + kill hooks.
  _fireWeaponVfx(weapon, from, to, arrive, onStep, hit) {
    const rnd = () => Math.random() - 0.5;
    switch (weapon) {
      case 'sniper': {
        // a single hyper-fast, thin blue-white tracer + a streaking beam
        this._tracer(from, to, 0x9fd0ff, true);
        this._projectile(from, to, 0xdff2ff, arrive, onStep, { size: 1.0, speed: 1300, trail: 'tracer' });
        break;
      }
      case 'mg': {
        // a rapid stream of small staggered tracer rounds
        const N = 6;
        for (let i = 0; i < N; i++) {
          const last = i === N - 1;
          const tt = to.clone().add(new THREE.Vector3(rnd() * 9, rnd() * 9, rnd() * 5));
          this._projectile(from, tt, 0xffe27a, last ? arrive : null, last ? onStep : null,
            { size: 0.8, speed: 1500, trail: 'tracer', delay: i * 0.05 });
        }
        break;
      }
      case 'missile': {
        // slow rocket lobbed on a high parabolic arc, leaving a smoke trail
        const arc = Math.max(60, from.distanceTo(to) * 0.17);
        this._projectile(from, to, 0xffcaa0, arrive, onStep, { size: 2.6, speed: 320, arc, trail: 'smoke' });
        break;
      }
      case 'shrap': {
        // a fan of fragments diverging onto the silhouette
        const N = 6;
        for (let i = 0; i < N; i++) {
          const primary = i === 0;
          const tt = to.clone().add(new THREE.Vector3(rnd() * 34, rnd() * 26, rnd() * 12));
          this._projectile(from, tt, 0xffd27a,
            primary ? arrive : (p) => this._sparks(p, 0xffae5a, 5, 14),
            primary ? onStep : null, { size: 1.3, speed: 560 });
        }
        break;
      }
      case 'rail': {
        // an instant lance: thick beam + a blink-fast core round
        this._tracer(from, to, 0xbfe0ff, true);
        this._projectile(from, to, 0xeaf6ff, arrive, onStep, { size: 1.6, speed: 2400, trail: 'tracer' });
        break;
      }
      default: { // cannon — heavy glowing shell
        this._projectile(from, to, hit ? 0xfff0b0 : 0xffcc66, arrive, onStep, { size: 2.3, speed: 430 });
      }
    }
  }

  // a tiny additive dot left in a tracer's wake
  _trailDot(pos, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos); this.scene.add(m);
    let life = 0.2;
    this.effects.push((dt) => {
      life -= dt; m.material.opacity = Math.max(0, life / 0.2) * 0.8; m.scale.setScalar(1 + (1 - life / 0.2) * 0.6);
      if (life <= 0) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
      return true;
    });
  }

  // a shell that visibly flies from -> to; opts: size/speed/arc/delay/trail.
  // onStep(p,k) each frame, onArrive at impact.
  _projectile(from, to, color, onArrive, onStep, opts = {}) {
    const size = opts.size ?? 2.0, speed = opts.speed ?? 430;
    const arc = opts.arc ?? 0, delay = opts.delay ?? 0;
    const dir = to.clone().sub(from);
    const dist = dir.length(); dir.normalize();
    const dur = Math.max(0.06, Math.min(1.6, dist / speed));
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const light = new THREE.PointLight(color, 3, 70, 2);
    bolt.visible = delay <= 0;
    bolt.position.copy(from); light.position.copy(from);
    this.scene.add(bolt, light);
    let t = 0, trailT = 0;
    this.effects.push((dt) => {
      t += dt;
      if (t < delay) return true;
      bolt.visible = true;
      const k = Math.min(1, (t - delay) / dur);
      const p = from.clone().addScaledVector(dir, dist * k);
      if (arc) p.y += arc * Math.sin(Math.PI * k);     // parabolic lob (missiles)
      bolt.position.copy(p); light.position.copy(p);
      if (opts.trail) {
        trailT += dt; const iv = opts.trail === 'smoke' ? 0.028 : 0.013;
        if (trailT >= iv) {
          trailT = 0;
          if (opts.trail === 'smoke') this._smoke(p.clone(), 0x9a8f80, 2.0, 3, 0.45);
          else this._trailDot(p.clone(), color);
        }
      }
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
  _infFlicker(side, unitIndex = null) {
    const j = () => Math.random() - 0.5;
    audio.rifle(side);
    const pos = this._infantryMuzzle(side, unitIndex) || (side === 'me'
      ? this.camera.position.clone().add(new THREE.Vector3(j() * 9, -6.5, -12 + j() * 5))
      : this._enemy.position.clone().add(new THREE.Vector3(j() * 6, -1.6, 3 + j() * 2)));
    const target = side === 'me'
      ? this._enemyPartWorld(Math.random() < 0.7 ? 'torso' : 'legL').add(new THREE.Vector3(j() * 28, j() * 18, j() * 18))
      : this.camera.position.clone().add(new THREE.Vector3(j() * 18, -CAM_Y + 7 + Math.random() * 5, -20 + j() * 20));
    this._tracer(pos, target, side === 'me' ? 0xffe0a0 : 0xff9a6a, false);
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

  _infantryMuzzle(side, unitIndex = null) {
    const group = this.infantrySquads && this.infantrySquads[side];
    if (!group) return null;
    const slots = group.userData.slots || [];
    if (unitIndex !== null && slots[unitIndex] && slots[unitIndex].visible && slots[unitIndex].userData.active) {
      return slots[unitIndex].userData.muzzle.getWorldPosition(new THREE.Vector3());
    }
    const live = slots.filter((s) => s.visible && s.userData.active && s.userData.muzzle);
    if (!live.length) return null;
    const s = live[Math.floor(Math.random() * live.length)];
    return s.userData.muzzle.getWorldPosition(new THREE.Vector3());
  }

  // ---- VFX library ----------------------------------------------------

  // bright sparks flying out with gravity (sized to read at long range)
  _sparks(pos, color, n = 12, speed = 26) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const sz = 1.1 + Math.random() * 0.9;
      const s = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz),
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
      const sz = 1.2 + Math.random() * 2.6;
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
  _impactFx(part, pos, crit, weapon = 'cannon') {
    const SPARK = { head: 0x9fd8ff, torso: 0xffd27a, armL: 0xffae5a, armR: 0xffae5a, legL: 0xffe0a0, legR: 0xffe0a0 };
    const color = SPARK[part] || 0xffd27a;
    const heavy = weapon === 'missile' || weapon === 'rail' || weapon === 'sniper';
    const splash = weapon === 'missile' || weapon === 'shrap';
    this._hitReact(part, crit ? 1.3 : heavy ? 0.95 : 0.65);
    this._scorch(part, pos, crit ? 15 : heavy ? 11 : 8, crit ? 12 : 8);
    this._moltenGlow(part, pos, crit ? 0xfff0b0 : color, crit ? 1.1 : 0.7);
    if (crit) { this._critFx(pos, part); return; }
    this._explosion(pos, splash ? 115 : part === 'torso' ? 95 : 70);
    this._sparks(pos, color, part === 'head' ? 22 : 16, part === 'head' ? 34 : 26);
    if (weapon === 'rail') this._shockwave(pos, 0xbfe0ff, 22);
    if (weapon === 'missile') {
      this._shockwave(pos, 0xffd6a0, 30);
      this._smoke(pos, 0x302822, 8, 9, 1.7);
    }
    if (part === 'torso') this._debrisBurst(pos, 0x8a7048, 10, 20);
    else if (part === 'legL' || part === 'legR') { this._smoke(pos.clone().setY(0.5), 0x4a4036, 4, 5); this._debrisBurst(pos, 0x3a3f3a, 5, 14); }
    else this._debrisBurst(pos, 0x3a3f3a, 5, 14);
    this._smoke(pos, 0x2a2622, 3, 7);
  }

  // critical hit: big blast + shockwave + white flash + on-screen "CRITICAL"
  _critFx(pos, part = 'torso') {
    this._hitReact(part, 1.8);
    this._explosion(pos, 150);
    this._shockwave(pos, 0xffffff, 34);
    this._sparks(pos, 0xfff0b0, 22, 34);
    this._debrisBurst(pos, 0x6b5a3a, 12, 22);
    this._smoke(pos, 0x201c18, 5, 9, 1.4);
    this._scorch(part, pos, 18, 14);
    this._moltenGlow(part, pos, 0xfff0b0, 1.35);
    this.trauma = Math.max(this.trauma, 0.9);
    this._whiteFlash();
    this._critText();
  }

  _hitReact(part, power = 0.8) {
    const node = this._enemy.userData.parts[part] || this._enemy.userData.parts.torso;
    if (!node || node.userData.fall) return;
    node.userData.restRot ||= node.rotation.clone();
    node.userData.hit = {
      life: 0.5,
      dur: 0.5,
      amp: power * (part === 'torso' ? 0.1 : 0.18),
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      prev: new THREE.Vector3(),
    };
  }

  _animateHitReactions(dt) {
    const parts = this._enemy && this._enemy.userData.parts;
    if (!parts) return;
    for (const name in parts) {
      const node = parts[name];
      const h = node.userData.hit;
      if (!h || node.userData.fall) continue;
      if (!node.userData.gaitDriven && node.userData.restRot) {
        node.rotation.copy(node.userData.restRot);
      }
      h.life -= dt;
      const u = Math.max(0, h.life / h.dur);
      const pulse = Math.sin((1 - u) * Math.PI * 4) * u * h.amp;
      node.rotation.x += h.axis.x * pulse;
      node.rotation.y += h.axis.y * pulse;
      node.rotation.z += h.axis.z * pulse;
      if (h.life <= 0) {
        if (!node.userData.gaitDriven && node.userData.restRot) node.rotation.copy(node.userData.restRot);
        node.userData.hit = null;
      }
    }
  }

  _scorch(part, pos, size = 9, life = 8) {
    const node = this._enemy.userData.parts[part] || this._enemy.userData.parts.torso;
    if (!node) return;
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._scorchTex, color: 0xffffff, transparent: true, opacity: 0.74,
      depthWrite: false, blending: THREE.NormalBlending,
    }));
    mark.position.copy(node.worldToLocal(pos.clone()));
    const localSize = size / ENEMY_SCALE;
    mark.scale.set(localSize, localSize, 1);
    mark.renderOrder = 2;
    node.add(mark);
    node.userData.scars ||= [];
    node.userData.scars.push(mark);
    while (node.userData.scars.length > 7) {
      const old = node.userData.scars.shift();
      old.parent && old.parent.remove(old);
      old.material.dispose();
    }
    this.effects.push((dt) => {
      life -= dt;
      mark.material.opacity = Math.max(0.24, Math.min(0.74, life / 8 * 0.74));
      if (life <= 0) { mark.material.opacity = 0.24; return false; }
      return true;
    });
  }

  _moltenGlow(part, pos, color = 0xffb05a, power = 0.8) {
    const node = this._enemy.userData.parts[part] || this._enemy.userData.parts.torso;
    if (!node) return;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTex, color, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.copy(node.worldToLocal(pos.clone()));
    glow.scale.setScalar((6 + power * 8) / ENEMY_SCALE);
    node.add(glow);
    const light = new THREE.PointLight(color, 4.5 * power, 90, 2);
    light.position.copy(pos); this.scene.add(light);
    let life = 0.45 + power * 0.25;
    const dur = life;
    this.effects.push((dt) => {
      life -= dt;
      const k = Math.max(0, life / dur);
      glow.material.opacity = k * 0.95;
      glow.scale.setScalar((6 + power * 16 * (1 - k)) / ENEMY_SCALE);
      light.intensity = 4.5 * power * k;
      light.position.copy(glow.getWorldPosition(new THREE.Vector3()));
      if (life <= 0) {
        glow.parent && glow.parent.remove(glow);
        this.scene.remove(light);
        glow.material.dispose();
        return false;
      }
      return true;
    });
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
