/**
 * World.js — infinite procedural road, sky, roadside scenery. Its look (time of day, weather, season) is set with
 * setEnvironment(composeEnvironment(...)) — see Environment.js.
 *
 * Everything is rendered RELATIVE TO THE CAR: the car sits at z = 0 and the world streams past toward +z.
 * Each frame the road/ground strips are re-sampled from a deterministic centre-line function c(s), and scenery
 * slots (trees, posts) are derived from a hash of their slot index. That means:
 *   • the road is infinite and never repeats visibly, yet costs a few hundred vertices,
 *   • there is no floating-point drift no matter how far you drive (we never translate huge distances).
 */
import * as THREE from 'three';

import { Precipitation } from './Weather.js';
import { composeEnvironment, DEFAULT_ENV } from './Environment.js';

// Road centre-line lives in RoadPath.js (re-exported here so existing imports keep working)
import { RoadPath } from './RoadPath.js';
export { RoadPath };

const hash = (n, salt = 0) => { const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };

// ───────────────────────────── procedural textures ─────────────────────────────

function canvasTexture(w, h, draw, { repeatY = true, anisotropy = 4 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = repeatY ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  return t;
}

function noise(ctx, w, h, amount, count) {
  for (let i = 0; i < count; i++) {
    const v = 128 + (Math.random() - 0.5) * amount;
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Asphalt with edge lines and a dashed centre line. 256×512 px ⇢ 8 m wide × 12 m long. */
function makeRoadTexture(anisotropy) {
  return canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3a3c41'; ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 70, 5200);
    // worn wheel tracks
    for (const cx of [0.27, 0.73]) {
      const g = ctx.createLinearGradient((cx - 0.11) * w, 0, (cx + 0.11) * w, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(20,20,24,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect((cx - 0.11) * w, 0, 0.22 * w, h);
    }
    ctx.fillStyle = '#e8e6df';
    ctx.fillRect(0.045 * w, 0, 0.022 * w, h);              // left edge line
    ctx.fillRect(0.933 * w, 0, 0.022 * w, h);              // right edge line
    ctx.fillStyle = '#f2d34b';
    ctx.fillRect(0.485 * w, 0, 0.03 * w, h / 3);           // dashed centre: 4 m dash / 8 m gap
  }, { anisotropy });
}

/** Ground texture for each look. 'summer' is the original grass. */
function makeGroundTexture(kind, anisotropy) {
  const styles = {
    summer: { base: '#4f6a2e', blade: (g) => `rgba(${g * 0.7},${g * 1.05},${g * 0.35},0.45)` },
    spring: { base: '#5f8a34', blade: (g) => `rgba(${g * 0.72},${g * 1.25},${g * 0.4},0.45)` },
    autumn: { base: '#6a5a2c', blade: (g) => `rgba(${g * 1.25},${g * 0.95},${g * 0.3},0.45)` },
    snow:   { base: '#e6ebf1', blade: (g) => { const v = 205 + (g - 70) * 0.8; return `rgba(${v},${v + 4},${v + 12},0.5)`; } },
  };
  const st = styles[kind] ?? styles.summer;
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = st.base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const g = 70 + Math.random() * 60;
      ctx.fillStyle = st.blade(g);
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  }, { anisotropy });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ───────────────────────────── re-samplable ribbon mesh ─────────────────────────────

/** rows × cols grid whose vertices are rewritten every frame. Row = distance ahead, column = lateral band edge. */
class Ribbon {
  constructor(rows, cols, material) {
    this.rows = rows; this.cols = cols;
    const n = rows * cols;
    this.pos = new Float32Array(n * 3);
    this.uv = new Float32Array(n * 2);
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
    const index = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        index.push(a, b, d, b, e, d);                  // counter-clockwise seen from above
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
  }
  set(r, c, x, y, z, u, v) {
    const i = r * this.cols + c;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
  }
  commit() { this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.uv.needsUpdate = true; }
}

// ───────────────────────────── world ─────────────────────────────

const ROW_STEP = 5, BEHIND = 40, AHEAD = 700;
const TREE_STEP = 11, POST_STEP = 20;

export class World {
  constructor(scene, path, renderer) {
    this.scene = scene; this.path = path;
    const aniso = renderer.capabilities.getMaxAnisotropy();
    this.rows = Math.round((BEHIND + AHEAD) / ROW_STEP) + 1;

    this.aniso = aniso;
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(0xffffff, 140, 720);

    // lights (colours/strengths are set by setEnvironment)
    this.sunDir = new THREE.Vector3(0.32, 0.17, -1).normalize();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.hemi, this.sun);

    this._buildSky();
    this._buildMountains();

    // ribbons
    this.roadMat = new THREE.MeshLambertMaterial({ map: makeRoadTexture(aniso) });
    this.groundTex = {};
    this.grassMat = new THREE.MeshLambertMaterial({ map: this._groundTexture('summer') });
    this.gravelMat = new THREE.MeshLambertMaterial({ color: 0x7a6b58 });
    const roadMat = this.roadMat, grassMat = this.grassMat, gravelMat = this.gravelMat;
    this.road = new Ribbon(this.rows, 2, roadMat);
    this.shoulderL = new Ribbon(this.rows, 2, gravelMat);
    this.shoulderR = new Ribbon(this.rows, 2, gravelMat);
    this.groundL = new Ribbon(this.rows, 2, grassMat);
    this.groundR = new Ribbon(this.rows, 2, grassMat);
    for (const r of [this.road, this.shoulderL, this.shoulderR, this.groundL, this.groundR]) scene.add(r.mesh);

    this._buildScenery();
    this.precip = new Precipitation(scene);
    this.leaf = { h: [0.24, 0.32], s: [0.38, 0.58], l: [0.2, 0.3], frost: 0 };
    this.setEnvironment(composeEnvironment(DEFAULT_ENV));
    this.update(0);
  }

  _groundTexture(kind) { return (this.groundTex[kind] ??= makeGroundTexture(kind, this.aniso)); }

  /** Apply a description from composeEnvironment(): sky, fog, lights, ground, tree colours, rain/snow. */
  setEnvironment(e) {
    this.env = e;
    const u = this.sky.material.uniforms, sk = e.sky;
    u.horizonC.value.fromArray(sk.horizon); u.midC.value.fromArray(sk.mid); u.zenithC.value.fromArray(sk.zenith);
    u.glowC.value.fromArray(sk.glow); u.glowK.value = sk.glowK; u.discC.value.fromArray(sk.disc);
    u.sunVis.value = sk.sunVis; u.stars.value = sk.stars;
    this.sunDir.fromArray(sk.sunDir).normalize();

    this.scene.background.fromArray(e.fog.color);
    this.scene.fog.color.fromArray(e.fog.color); this.scene.fog.near = e.fog.near; this.scene.fog.far = e.fog.far;

    this.hemi.color.fromArray(e.hemi.sky); this.hemi.groundColor.fromArray(e.hemi.ground); this.hemi.intensity = e.hemi.intensity;
    this.sun.color.fromArray(e.sun.color); this.sun.intensity = e.sun.intensity; this.sun.position.fromArray(e.sun.pos);

    this.mountainMats[0].color.fromArray(e.mountains[0]); this.mountainMats[1].color.fromArray(e.mountains[1]);

    this.grassMat.map = this._groundTexture(e.ground); this.grassMat.needsUpdate = true;
    this.roadMat.color.fromArray(e.road.tint); this.roadMat.emissive.fromArray(e.road.emissive);
    this.gravelMat.color.fromArray(e.shoulder);

    this.leaf = e.leaf;
    this.precip.setMode(e.precip);
  }

  /** Per-frame rain / snow. Call after update() with the camera and the car's speed (m/s). */
  stepWeather(dt, camera, speed) { this.precip.update(dt, camera.position, speed); }

  _buildSky() {
    const V3 = (a, b, c) => new THREE.Vector3(a, b, c);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        sunDir: { value: this.sunDir },
        horizonC: { value: V3(1.0, 0.66, 0.42) }, midC: { value: V3(0.86, 0.42, 0.38) }, zenithC: { value: V3(0.10, 0.15, 0.40) },
        glowC: { value: V3(1.0, 0.72, 0.40) }, glowK: { value: 0.55 }, discC: { value: V3(1.0, 0.96, 0.85) },
        sunVis: { value: 1 }, stars: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 sunDir, horizonC, midC, zenithC, glowC, discC; uniform float glowK, sunVis, stars; varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 col = mix(horizonC, midC, smoothstep(0.0, 0.16, h));
          col = mix(col, zenithC, smoothstep(0.10, 0.80, h));
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          col += glowC * pow(sd, 10.0) * glowK * sunVis + discC * smoothstep(0.9992, 0.9997, sd) * 1.6 * sunVis;
          if (stars > 0.0 && d.y > 0.05) {
            vec2 p = vec2(atan(d.x, d.z), d.y) * 150.0;
            float s = step(0.993, h21(floor(p))) * (1.0 - smoothstep(0.0, 0.4, length(fract(p) - 0.5)));
            col += vec3(0.9, 0.95, 1.0) * s * stars * smoothstep(0.05, 0.35, d.y);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildMountains() {
    this.mountains = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x5b3f63, fog: false });
    const mat2 = new THREE.MeshBasicMaterial({ color: 0x7a4a5a, fog: false });
    this.mountainMats = [mat, mat2];       // [darker, lighter] — recoloured by setEnvironment
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, h = 150 + hash(i, 1) * 300, r = 220 + hash(i, 2) * 200;
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + (i % 3)), i % 2 ? mat : mat2);
      m.position.set(Math.sin(a) * 1250, h / 2 - 8, -Math.cos(a) * 1250);
      m.rotation.y = hash(i, 3) * 6;
      this.mountains.add(m);
    }
    this.scene.add(this.mountains);
  }

  _buildScenery() {
    const nSlots = Math.ceil((BEHIND + AHEAD) / TREE_STEP) + 2;
    this.treeSlots = nSlots;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
    const leafGeo = new THREE.ConeGeometry(1.9, 5.2, 7); leafGeo.translate(0, 4.4, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3322 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const count = nSlots * 4;                                // 2 sides × (near row + far row)
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
    this.leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    for (const m of [this.trunks, this.leaves]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); }

    const nPosts = Math.ceil((BEHIND + AHEAD) / POST_STEP) + 2;
    this.postSlots = nPosts;
    const postGeo = new THREE.BoxGeometry(0.12, 0.95, 0.12); postGeo.translate(0, 0.475, 0);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xf2efe8, emissive: 0x331a10 });
    this.posts = new THREE.InstancedMesh(postGeo, postMat, nPosts * 2);
    const capGeo = new THREE.BoxGeometry(0.13, 0.14, 0.13); capGeo.translate(0, 0.78, 0);
    this.caps = new THREE.InstancedMesh(capGeo, new THREE.MeshBasicMaterial({ color: 0xff7a2a }), nPosts * 2);
    for (const m of [this.posts, this.caps]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); }
    this._d = new THREE.Object3D();
    this._col = new THREE.Color();
  }

  /** Re-sample everything for the car being at road distance carS. */
  update(carS, camera = null) {
    const P = this.path, hw = P.halfWidth;
    const mod12k = (v) => ((v % 12000) + 12000) % 12000;

    for (let r = 0; r < this.rows; r++) {
      const s0 = carS - BEHIND + r * ROW_STEP;
      const cx = P.center(s0), k = P.slope(s0), inv = 1 / Math.sqrt(1 + k * k);
      const nx = inv, ns = -k * inv;                        // unit normal to the road in the (x, s) plane
      const at = (lat) => [cx + nx * lat, -((s0 + ns * lat) - carS)];   // → scene (x, z)
      const v12 = mod12k(s0) / 12, v10 = (s0 % 10000) / 10;
      let a, b;
      [a, b] = [at(-hw), at(hw)];
      this.road.set(r, 0, a[0], 0.0, a[1], 0, v12); this.road.set(r, 1, b[0], 0.0, b[1], 1, v12);
      [a, b] = [at(-hw - 2.4), at(-hw)];
      this.shoulderL.set(r, 0, a[0], -0.01, a[1], 0, v10); this.shoulderL.set(r, 1, b[0], -0.01, b[1], 1, v10);
      [a, b] = [at(hw), at(hw + 2.4)];
      this.shoulderR.set(r, 0, a[0], -0.01, a[1], 0, v10); this.shoulderR.set(r, 1, b[0], -0.01, b[1], 1, v10);
      // Ground: the far edge is a pure x offset (no normal shear — at 900 m a sloped normal would shift z by hundreds of metres)
      const zRow = -(s0 - carS);
      b = at(-hw - 2.4);
      this.groundL.set(r, 0, cx - 900, -0.03, zRow, -90, v10); this.groundL.set(r, 1, b[0], -0.03, b[1], -0.64, v10);
      a = at(hw + 2.4);
      this.groundR.set(r, 0, a[0], -0.03, a[1], 0.64, v10); this.groundR.set(r, 1, cx + 900, -0.03, zRow, 90, v10);
    }
    for (const rb of [this.road, this.shoulderL, this.shoulderR, this.groundL, this.groundR]) rb.commit();

    // trees: 2 sides × (near, far)
    const d = this._d, col = this._col;
    const k0 = Math.floor((carS - BEHIND) / TREE_STEP);
    let i = 0;
    for (let n = 0; n < this.treeSlots; n++) {
      const k = k0 + n, s = k * TREE_STEP;
      const cx = P.center(s), inv = 1 / Math.sqrt(1 + P.slope(s) ** 2);
      for (let side = -1; side <= 1; side += 2) {
        for (let row = 0; row < 2; row++, i++) {
          const salt = k * 4 + (side > 0 ? 2 : 0) + row;
          const present = hash(salt, 5) > (row === 0 ? 0.35 : 0.15);
          const off = row === 0 ? hw + 5 + hash(salt, 6) * 9 : hw + 18 + hash(salt, 6) * 45;
          const sc = present ? 0.75 + hash(salt, 7) * 1.1 : 0;
          d.position.set(cx + side * off * inv, 0, -(s - carS) + (hash(salt, 8) - 0.5) * 6);
          d.rotation.set(0, hash(salt, 9) * 6.28, 0);
          d.scale.set(sc, sc * (0.9 + hash(salt, 10) * 0.4), sc);
          d.updateMatrix();
          this.trunks.setMatrixAt(i, d.matrix); this.leaves.setMatrixAt(i, d.matrix);
          const lf = this.leaf, fr = lf.frost;
          const hh = lf.h[0] + hash(salt, 11) * (lf.h[1] - lf.h[0]);
          const ss = (lf.s[0] + hash(salt, 12) * (lf.s[1] - lf.s[0])) * (1 - fr * 0.7);
          const ll = lf.l[0] + hash(salt, 13) * (lf.l[1] - lf.l[0]);
          col.setHSL(hh, ss, ll + (0.86 - ll) * fr);                  // frost = snow on the branches
          this.leaves.setColorAt(i, col);
        }
      }
    }
    this.trunks.instanceMatrix.needsUpdate = this.leaves.instanceMatrix.needsUpdate = true;
    this.leaves.instanceColor.needsUpdate = true;

    // roadside delineator posts
    const p0 = Math.floor((carS - BEHIND) / POST_STEP);
    i = 0;
    for (let n = 0; n < this.postSlots; n++) {
      const s = (p0 + n) * POST_STEP, cx = P.center(s), inv = 1 / Math.sqrt(1 + P.slope(s) ** 2);
      for (let side = -1; side <= 1; side += 2, i++) {
        d.position.set(cx + side * (hw + 1.1) * inv, 0, -(s - carS)); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.posts.setMatrixAt(i, d.matrix); this.caps.setMatrixAt(i, d.matrix);
      }
    }
    this.posts.instanceMatrix.needsUpdate = this.caps.instanceMatrix.needsUpdate = true;

    if (camera) { this.sky.position.copy(camera.position); this.mountains.position.set(camera.position.x, 0, camera.position.z); }
  }
}
