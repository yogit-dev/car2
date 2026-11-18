/**
 * Simulator.js — Three.js scene, cameras, per-frame update (physics → visuals) and the 3D input HUD.
 *
 * Usage:
 *   const sim = new Simulator(canvas);
 *   // each frame:
 *   sim.update(dt, { steer, throttle, brake });
 *   sim.render();
 */
import * as THREE from 'three';
import { Vehicle } from './Vehicle.js';
import { World, RoadPath } from './World.js';
import { buildCar, buildBike, buildBus, buildSteeringWheel, buildPedals, makeLabel } from './Models.js';
import { VEHICLES, isVehicleType } from './VehicleSpecs.js';
import { composeEnvironment } from './Environment.js';
import { DEFAULT_SETTINGS, normalizeSettings, pickValid, envChanged } from './Settings.js';

const BUILDERS = { car: buildCar, bike: buildBike, bus: buildBus };

/** Free GPU memory of a model we are throwing away (geometries, materials, canvas textures). */
function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) { m.map?.dispose(); m.dispose(); }
  });
}

const STEER_VISUAL = 2.3;            // wheel rotation (rad) at full lock ≈ 130°
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Simulator {
  /** @param {{vehicle?:string, time?:string, weather?:string, season?:string}} settings */
  constructor(canvas, settings = DEFAULT_SETTINGS) {
    this.canvas = canvas;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2600);
    this.path = new RoadPath();
    this.world = new World(this.scene, this.path, renderer);

    this.car = null;
    this.cameraMode = 'chase';          // 'chase' | 'cockpit'
    this.hudVisible = true;
    this.events = [];
    this.time = 0;
    this._camPos = new THREE.Vector3(); this._camLook = new THREE.Vector3();
    this._camInit = false;

    this._buildHud();
    this.settings = normalizeSettings(settings);
    this.world.setEnvironment(composeEnvironment(this.settings));
    this.setVehicle(this.settings.vehicle);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Second scene rendered into a corner viewport: a big wheel + 2 pedals that visibly follow your inputs. */
  _buildHud() {
    const s = this.hud = new THREE.Scene();
    s.add(new THREE.AmbientLight(0xffffff, 1.1));
    const l = new THREE.DirectionalLight(0xfff0dd, 2.2); l.position.set(-1, 2, 2); s.add(l);

    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.4), new THREE.MeshBasicMaterial({ color: 0x0b0d12, transparent: true, opacity: 0.55 }));
    panel.position.z = -0.6; s.add(panel);

    this.hudWheel = buildSteeringWheel(0.3);
    this.hudWheel.root.position.set(-0.8, 0.12, 0);
    this.hudWheel.root.rotation.x = -0.25;
    s.add(this.hudWheel.root);

    this.hudPedals = buildPedals();
    this.hudPedals.root.position.set(0.66, -0.4, 0);
    this.hudPedals.root.scale.setScalar(1.45);
    this.hudPedals.root.rotation.x = -0.45;
    s.add(this.hudPedals.root);
    for (const [name, x, txt] of [['brake', -0.1, 'BRAKE'], ['accelerator', 0.1, 'THROTTLE']]) {
      const lab = makeLabel(txt, { size: 34, world: 0.34 });
      lab.position.set(0.66 + x * 1.45, -0.72, 0.3);
      s.add(lab);
    }
    this.hudCam = new THREE.PerspectiveCamera(36, 1.55, 0.1, 20);
    this.hudCam.position.set(0, 0, 2.75);
  }

  /**
   * Apply a (partial) settings change: vehicle, time, weather and/or season. A new vehicle puts the car back at the
   * start of the road. Returns which parts actually changed.
   */
  applySettings(partial) {
    const next = normalizeSettings({ ...this.settings, ...pickValid(partial) });   // invalid values are ignored, not reset
    const vehicleChanged = next.vehicle !== this.settings.vehicle;
    const environmentChanged = envChanged(next, this.settings);
    this.settings = next;
    if (vehicleChanged) this.setVehicle(next.vehicle);
    if (environmentChanged) { this.world.setEnvironment(composeEnvironment(next)); this._applyHeadlights(); }
    return { vehicle: vehicleChanged, environment: environmentChanged };
  }

  /** Swap the vehicle (model + physics + camera). The car is put back at the start of the road. */
  setVehicle(type) {
    if (!isVehicleType(type)) return false;
    if (this.car) { this.scene.remove(this.car.root); disposeTree(this.car.root); }
    this.type = type;
    this.settings = { ...this.settings, vehicle: type };
    this.spec = VEHICLES[type];
    this.car = BUILDERS[type]();
    this.scene.add(this.car.root);

    // headlights: a spot light on the front of the vehicle, switched on by the time of day / weather
    const front = new THREE.Box3().setFromObject(this.car.root).min.z;
    this.headlight = new THREE.SpotLight(0xfff1cf, 0, 75, 0.5, 0.65, 0);
    this.headlight.position.set(0, 0.9, front + 0.2);
    this.headlight.target.position.set(0, 0.2, front - 30);
    this.car.root.add(this.headlight, this.headlight.target);
    this._applyHeadlights();

    this.vehicle = new Vehicle(this.spec.physics);
    this.reset();
    return true;
  }

  _applyHeadlights() {
    const k = this.world.env?.headlights ?? 0;
    if (this.headlight) this.headlight.intensity = k * 10;
  }

  reset() {
    this.vehicle.reset({ x: 0, yaw: this.path.heading(0) });
    this._camInit = false;
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    this._camInit = false;
    return this.cameraMode;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.size = { w, h };
  }

  /** Advance physics by dt and pose every visual. */
  update(dt, input) {
    const v = this.vehicle, car = this.car, b = this.spec.body;
    this.time += dt;
    v.step(dt, input, this.path);
    this.events = v.events.slice();

    // car transform: world is rendered relative to the car in z, absolute in x
    car.root.position.set(v.x, 0, 0);
    car.root.rotation.y = -v.yaw;
    const bump = v.offRoad ? Math.sin(this.time * 55) * 0.012 * clamp(v.speed / 15, 0, 1.5) : 0;
    car.chassis.position.y = bump;
    car.chassis.rotation.x += (clamp(v.longAcc * b.pitchK, -b.pitchMax, b.pitchMax) - car.chassis.rotation.x) * Math.min(1, dt * 6);   // squat / dive
    car.chassis.rotation.z += (clamp(v.latAcc * b.rollK, -b.rollMax, b.rollMax) - car.chassis.rotation.z) * Math.min(1, dt * 6);    // body roll
    for (const w of car.wheels) {
      w.spin.rotation.x = -v.wheelSpin;
      if (w.front) w.pivot.rotation.y = -v.steerAngle * this.spec.wheelSteerVisual;                 // exaggerated so steering reads from behind
    }

    // wheel + pedals (cockpit wheel, HUD wheel, HUD pedals)
    const a = v.steerState * STEER_VISUAL;
    car.cockpit.wheel.setAngle(a);
    this.hudWheel.setAngle(a);
    this.hudPedals.set({ brake: input.brake, accelerator: input.throttle });
    car.cockpit.updateCluster({ kmh: v.kmh, gear: v.engineOn ? v.gear : 'X', rpm: v.rpm, redline: v.p.redline, mode: this.type === 'car' ? v.mode : this.spec.label });

    this.world.update(v.s, this.camera);
    this._updateCamera(dt);
    this.world.stepWeather(dt, this.camera, v.speed);
    car.cockpit.group.visible = true;
    for (const o of car.hideInCockpit ?? []) o.visible = this.cameraMode !== 'cockpit';
  }

  _updateCamera(dt) {
    const v = this.vehicle, cam = this.camera, car = this.car;
    car.root.updateMatrixWorld(true);
    const speedFrac = clamp(v.speed / 50, 0, 1);

    if (this.cameraMode === 'cockpit') {
      const eye = car.cockpit.eye.clone(); eye.x -= v.latAcc * 0.004;
      cam.position.copy(car.chassis.localToWorld(eye));
      cam.lookAt(car.chassis.localToWorld(car.cockpit.look.clone()));
      cam.rotation.z += 0;                                     // keep horizon level
      cam.fov += ((78 + speedFrac * 8) - cam.fov) * Math.min(1, dt * 3);
    } else {
      const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
      const c = this.spec.chase;
      const targetPos = new THREE.Vector3(v.x - sy * c.back, c.height + speedFrac * 0.3, cy * c.back);
      const targetLook = new THREE.Vector3(v.x + sy * c.lookAhead, c.lookHeight, -cy * c.lookAhead);
      if (!this._camInit) { this._camPos.copy(targetPos); this._camLook.copy(targetLook); this._camInit = true; }
      const k = 1 - Math.exp(-5.5 * dt);
      this._camPos.lerp(targetPos, k); this._camLook.lerp(targetLook, 1 - Math.exp(-9 * dt));
      cam.position.copy(this._camPos);
      if (v.offRoad) cam.position.y += Math.sin(this.time * 60) * 0.015 * clamp(v.speed / 15, 0, 1.5);
      cam.lookAt(this._camLook);
      cam.fov += ((60 + speedFrac * 14) - cam.fov) * Math.min(1, dt * 3);
    }
    cam.updateProjectionMatrix();
  }

  render() {
    const r = this.renderer, { w, h } = this.size;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);

    if (this.hudVisible) {
      const hw = Math.round(Math.min(360, w * 0.42)), hh = Math.round(hw / 1.55);
      const x = w - hw - 14, y = 14;                            // bottom-right
      r.clearDepth();
      r.setViewport(x, y, hw, hh);
      r.setScissor(x, y, hw, hh);
      r.setScissorTest(true);
      r.render(this.hud, this.hudCam);
      r.setScissorTest(false);
    }
  }
}
