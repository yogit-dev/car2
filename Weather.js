/**
 * Weather.js — rain streaks and snowflakes in a box around the camera.
 *
 * The world streams past the car toward +z, so every particle also moves toward +z at the car's speed: rain
 * leans into streaks the faster you drive, and snow rushes at the windscreen. Particles that leave the box wrap
 * around to the other side, so a few thousand are enough forever.
 */
import * as THREE from 'three';

const BOX = { x: 70, y: 32, z: 90 };
const RAIN = 2400, SNOW = 2600;
const wrap = (v, c, size) => c + ((((v - c + size / 2) % size) + size) % size) - size / 2;

export class Precipitation {
  constructor(scene) {
    this.type = 'none';
    this.t = 0;

    // rain: one line segment per drop (head → tail)
    this.rainPos = new Float32Array(RAIN * 6);
    this.rainHead = new Float32Array(RAIN * 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.55, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);

    // snow: one point per flake
    this.snowPos = new Float32Array(SNOW * 3);
    this.snowPhase = new Float32Array(SNOW);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.17, sizeAttenuation: true, transparent: true, opacity: 0.92, depthWrite: false });
    this.snow = new THREE.Points(sg, this.snowMat);

    for (let i = 0; i < RAIN; i++) {
      this.rainHead[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.rainHead[i * 3 + 1] = Math.random() * BOX.y;
      this.rainHead[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    }
    for (let i = 0; i < SNOW; i++) {
      this.snowPos[i * 3] = (Math.random() - 0.5) * BOX.x;
      this.snowPos[i * 3 + 1] = Math.random() * BOX.y;
      this.snowPos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
      this.snowPhase[i] = Math.random() * 6.28;
    }
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
  }

  /** @param {{type:'none'|'rain'|'snow', color:number[]}} p */
  setMode(p) {
    this.type = p.type;
    this.rain.visible = p.type === 'rain';
    this.snow.visible = p.type === 'snow';
    const mat = p.type === 'rain' ? this.rainMat : this.snowMat;
    mat.color.setRGB(...p.color);
  }

  /** Advance by dt seconds around camera position cam, while the car drives at speed m/s. */
  update(dt, cam, speed) {
    if (this.type === 'none') return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const cx = cam.x, cz = cam.z;                      // the box follows the camera sideways and along the road; y runs ground → 32 m

    if (this.type === 'rain') {
      const fall = 15, h = this.rainHead, p = this.rainPos, streak = 0.035;
      for (let i = 0; i < RAIN; i++) {
        const x = wrap(h[i * 3], cx, BOX.x);
        let y = h[i * 3 + 1] - fall * dt;
        const z = wrap(h[i * 3 + 2] + speed * dt, cz, BOX.z);
        if (y < 0) y += BOX.y;
        h[i * 3] = x; h[i * 3 + 1] = y; h[i * 3 + 2] = z;
        const o = i * 6;
        p[o] = x; p[o + 1] = y; p[o + 2] = z;                               // head
        p[o + 3] = x; p[o + 4] = y + fall * streak; p[o + 5] = z - (speed + 0.01) * streak;   // tail: back up the path it came from
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    } else {
      const p = this.snowPos, fall = 1.7, t = this.t;
      for (let i = 0; i < SNOW; i++) {
        const o = i * 3;
        let y = p[o + 1] - fall * dt;
        if (y < 0) y += BOX.y;
        p[o] = wrap(p[o] + Math.sin(t * 0.9 + this.snowPhase[i]) * 0.5 * dt, cx, BOX.x);
        p[o + 1] = y;
        p[o + 2] = wrap(p[o + 2] + speed * dt, cz, BOX.z);
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    for (const o of [this.rain, this.snow]) { o.geometry.dispose(); o.material.dispose(); o.parent?.remove(o); }
  }
}
