/**
 * Models.js — procedural 3D models (no external assets): car, steering wheel, pedals, cockpit.
 * Car convention: origin on the ground at the centre, nose toward −z, driver on the left (−x).
 */
import * as THREE from 'three';

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 40, ...o });

/** Text on a transparent plane (used for pedal labels). */
export function makeLabel(text, { w = 256, h = 64, size = 40, color = '#ffd9a0', world = 0.5 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(world, (world * h) / w), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  return m;
}

// ───────────────────────────── shared pieces ─────────────────────────────

/** Live instrument cluster (speed, gear, rpm bar) drawn on a canvas texture. Returns { mesh, update({kmh,gear,rpm,redline,mode}) }. */
function makeCluster(planeW, planeH) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), new THREE.MeshBasicMaterial({ map: tex }));
  let last = '';
  function update({ kmh, gear, rpm, redline = 6500, mode = '' }) {
    const key = `${Math.round(kmh)}|${gear}|${Math.round(rpm / 60)}|${mode}`;
    if (key === last) return; last = key;
    ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, 512, 192);
    const frac = Math.min(1, rpm / redline);
    for (let i = 0; i < 30; i++) {                                // tach ticks
      const on = i / 30 < frac;
      ctx.fillStyle = on ? (i > 24 ? '#ff4a2a' : '#ffb454') : '#2a2d33';
      ctx.fillRect(16 + i * 16, 14, 11, 26);
    }
    ctx.fillStyle = '#ffe6c2'; ctx.font = '700 92px "Arial Narrow", Arial'; ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(kmh)), 22, 142);
    ctx.font = '600 24px Arial'; ctx.fillStyle = '#9a8f80'; ctx.fillText('km/h', 24, 178);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffb454'; ctx.font = '700 96px "Arial Narrow", Arial';
    ctx.fillText(String(gear), 488, 142);
    ctx.font = '600 22px Arial'; ctx.fillStyle = '#9a8f80'; ctx.fillText(String(mode).toUpperCase(), 490, 178);
    tex.needsUpdate = true;
  }
  return { mesh, update };
}

/** A cylinder stretched between two points (arms, legs, forks). */
function limb(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** Wheel = pivot (steers) → spin (rolls). Radius must equal the physics wheelRadius so the tyre doesn't slip visually. */
function makeWheel(radius, width, x, y, z, front, tyreMat, rimMat) {
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 24); tyre.rotateZ(Math.PI / 2);
  const pivot = new THREE.Group(); pivot.position.set(x, y, z);
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(tyre, tyreMat));
  const hubA = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, radius * 1.35, radius * 0.2), rimMat);
  const hubB = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, radius * 0.2, radius * 1.35), rimMat);
  spin.add(hubA, hubB);
  pivot.add(spin);
  return { pivot, spin, front };
}

// ───────────────────────────── steering wheel ─────────────────────────────

/** Faces +z (toward the driver). Call setAngle(rad): + = clockwise as the driver sees it (steer right). */
export function buildSteeringWheel(radius = 0.19) {
  const root = new THREE.Group(), rot = new THREE.Group();
  root.add(rot);
  const dark = phong(0x1b1c20, { shininess: 25 });
  rot.add(new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.12, 14, 48), dark));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.27, radius * 0.3, radius * 0.22, 20), phong(0x2c2e35));
  hub.rotation.x = Math.PI / 2; rot.add(hub);
  const spokeH = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.85, radius * 0.13, radius * 0.1), dark);
  const spokeV = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.13, radius * 0.9, radius * 0.1), dark);
  spokeV.position.y = -radius * 0.45;
  rot.add(spokeH, spokeV);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.16, radius * 0.3, radius * 0.2),
    new THREE.MeshBasicMaterial({ color: 0xff4a2a }));
  mark.position.y = radius;                                  // 12 o'clock marker makes rotation obvious
  rot.add(mark);
  return { root, rot, setAngle(rad) { rot.rotation.z = -rad; } };
}

// ───────────────────────────── pedals ─────────────────────────────

/** Hinged pedals. Automatic car: brake + accelerator only. set({brake,accelerator}) with values 0..1. */
export function buildPedals() {
  const root = new THREE.Group();
  const defs = { brake: { x: -0.1, color: 0xff3b3b }, accelerator: { x: 0.1, color: 0x35d070 } };
  const pedals = {};
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.3), phong(0x2a2c34));
  plate.position.set(0, -0.015, -0.02);
  root.add(plate);
  for (const [name, d] of Object.entries(defs)) {
    const pivot = new THREE.Group(); pivot.position.set(d.x, 0.2, 0.06);        // hinge near the top
    const padMat = phong(d.color, { emissive: d.color, emissiveIntensity: 0.12, shininess: 70 });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.26, 0.035), padMat);
    pad.position.y = -0.1;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.025), phong(0x888a92));
    arm.position.y = 0.07;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.014, 0.04), phong(0x111111));
    for (const y of [-0.08, -0.14, -0.2]) { const g = grip.clone(); g.position.set(0, y, 0.002); pivot.add(g); }
    pivot.add(pad, arm);
    root.add(pivot);
    pedals[name] = { pivot, padMat };
  }
  return {
    root, pedals,
    set(values) {
      for (const [name, p] of Object.entries(pedals)) {
        const v = Math.min(1, Math.max(0, values[name] ?? 0));
        p.pivot.rotation.x = v * 0.5;                    // pad swings away from the driver
        p.padMat.emissiveIntensity = 0.12 + v * 0.9;
      }
    },
  };
}

// ───────────────────────────── cockpit ─────────────────────────────

/** Dashboard + steering wheel + a live instrument cluster (canvas texture). Positioned in car space. */
export function buildCockpit() {
  const group = new THREE.Group();
  const dashMat = phong(0x17181c, { shininess: 15 });

  // seats-and-floor deck so the red body shell isn't visible from inside
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 2.2), phong(0x25262b, { shininess: 5 }));
  deck.position.set(0, 0.915, 0.35); group.add(deck);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.75), dashMat);
  dash.position.set(0, 0.99, -0.95); group.add(dash);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), phong(0x2e2f36));
  seat.position.set(-0.4, 0.99, 0.7); group.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), phong(0x2e2f36));
  back.position.set(-0.4, 1.28, 0.97); back.rotation.x = -0.15; group.add(back);

  // steering column + wheel, tilted toward the driver
  const wheel = buildSteeringWheel(0.17);
  wheel.root.position.set(-0.4, 1.0, -0.5);
  wheel.root.rotation.x = -0.42;
  group.add(wheel.root);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 10), dashMat);
  col.rotation.x = Math.PI / 2 - 0.42; col.position.set(-0.4, 0.96, -0.6); group.add(col);

  // instrument cluster
  const cl = makeCluster(0.34, 0.128);
  cl.mesh.position.set(-0.4, 1.12, -0.82); cl.mesh.rotation.x = -0.6; group.add(cl.mesh);
  const updateCluster = cl.update;

  return { group, wheel, updateCluster, eye: new THREE.Vector3(-0.4, 1.36, 0.3), look: new THREE.Vector3(-0.4, 1.22, -20) };
}

// ───────────────────────────── exterior car ─────────────────────────────

export function buildCar() {
  const root = new THREE.Group();          // moved/yawed by the simulator
  const chassis = new THREE.Group();       // pitched/rolled for weight transfer
  root.add(chassis);

  const paint = phong(0xd8322b, { shininess: 110, specular: 0x886655 });
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 4.3), paint);
  tub.position.y = 0.6; chassis.add(tub);

  // cabin: trapezoid profile in the (z, y) plane extruded across x, so the roof/screen rake looks like a car
  const prof = new THREE.Shape();
  prof.moveTo(1.6, 0.0); prof.lineTo(0.95, 0.52); prof.lineTo(-0.5, 0.52); prof.lineTo(-1.1, 0.0); prof.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(prof, { depth: 1.62, bevelEnabled: false });
  cabinGeo.rotateY(-Math.PI / 2); cabinGeo.translate(0.81, 0.91, 0);     // (shape x → z, extrude → x)
  const glass = new THREE.Mesh(cabinGeo, phong(0x0f1a26, { transparent: true, opacity: 0.72, shininess: 150, specular: 0xaaccff }));
  chassis.add(glass);
  // Single-sided plane: seen from outside it's the roof, from inside it's culled so the view isn't blocked by a headliner.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 1.48), paint);
  roof.rotation.x = -Math.PI / 2; roof.position.set(0, 1.432, 0.225); chassis.add(roof);

  // lights
  const head = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
  const tail = new THREE.MeshBasicMaterial({ color: 0xff2a1f });
  for (const x of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), head); h.position.set(x, 0.72, -2.16); chassis.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), tail); t.position.set(x, 0.74, 2.16); chassis.add(t);
  }
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.16, 0.1), phong(0x1a1a1d)); bumperF.position.set(0, 0.4, -2.18); chassis.add(bumperF);
  const bumperR = bumperF.clone(); bumperR.position.z = 2.18; chassis.add(bumperR);

  // wheels: pivot (steers) → spin (rolls)
  const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 24); tyre.rotateZ(Math.PI / 2);
  const tyreMat = phong(0x0e0e10, { shininess: 8 });
  const rimMat = phong(0xb8bcc6, { shininess: 90 });
  const wheels = [];
  for (const [x, z, front] of [[-0.9, -1.38, true], [0.9, -1.38, true], [-0.9, 1.38, false], [0.9, 1.38, false]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.34, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyre, tyreMat));
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.46, 0.07), rimMat);
    const hub2 = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.07, 0.46), rimMat);
    spin.add(hub, hub2);
    pivot.add(spin); root.add(pivot);                         // wheels stay on the ground (not in the pitched chassis)
    wheels.push({ pivot, spin, front });
  }

  const cockpit = buildCockpit();
  chassis.add(cockpit.group);

  return { root, chassis, wheels, cockpit, bodyMeshes: [tub, roof, glass] };
}


// ───────────────────────────── motorbike ─────────────────────────────

/**
 * Same return shape as buildCar(). Origin on the ground at the centre, nose toward −z, rider in the middle.
 * The wheels live inside `chassis` so the whole bike leans into corners. The fork + handlebars are children of the
 * front wheel's pivot, so they turn with the steering.
 */
export function buildBike() {
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);

  const paint = phong(0x2a6df0, { shininess: 110, specular: 0x8899cc });
  const dark = phong(0x16171b, { shininess: 25 });
  const chrome = phong(0xb8bcc6, { shininess: 90 });
  const tyreMat = phong(0x0e0e10, { shininess: 8 });

  // engine, tank, seat, tail, exhaust
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.55), dark); engine.position.set(0, 0.5, 0.05); chassis.add(engine);
  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), paint);
  tank.scale.set(0.36, 0.27, 0.6); tank.position.set(0, 0.88, -0.28); chassis.add(tank);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.62), dark); seat.position.set(0, 0.82, 0.36); chassis.add(seat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.17, 0.45), paint); tail.position.set(0, 0.9, 0.82); chassis.add(tail);
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2a1f }));
  tailLight.position.set(0, 0.92, 1.06); chassis.add(tailLight);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.95, 12), chrome);
  exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0.22, 0.4, 0.5); chassis.add(exhaust);
  const swing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.8), dark); swing.position.set(0.12, 0.42, 0.62); chassis.add(swing);
  const fenderR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.5), paint); fenderR.position.set(0, 0.7, 0.92); chassis.add(fenderR);

  // wheels (rear fixed, front steers with fork + bars)
  const wheels = [];
  const rear = makeWheel(0.32, 0.15, 0, 0.32, 0.7, false, tyreMat, chrome);
  const front = makeWheel(0.32, 0.13, 0, 0.32, -0.7, true, tyreMat, chrome);
  chassis.add(rear.pivot, front.pivot);
  wheels.push(rear, front);

  // fork + bars + headlight, relative to the front wheel pivot (so they turn with it)
  const rake = 0.38;
  for (const x of [-0.1, 0.1]) front.pivot.add(limb(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0.78 * Math.cos(rake), 0.78 * Math.sin(rake)), 0.026, chrome));
  const top = new THREE.Vector3(0, 0.78 * Math.cos(rake), 0.78 * Math.sin(rake));
  const bars = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.03, 0.03), chrome); bars.position.copy(top).add(new THREE.Vector3(0, 0.04, 0.02)); front.pivot.add(bars);
  for (const x of [-0.33, 0.33]) { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), dark); g.rotation.z = Math.PI / 2; g.position.set(x, top.y + 0.04, top.z + 0.02); front.pivot.add(g); }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.14), dark); lamp.position.set(0, 0.5, -0.16); front.pivot.add(lamp);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff1cf })); lens.position.set(0, 0.5, -0.24); front.pivot.add(lens);
  const fenderF = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.5), paint); fenderF.position.set(0, 0.36, -0.02); front.pivot.add(fenderF);
  const bodyOnFork = lamp;

  // rider (hidden in cockpit view so the camera isn't inside the helmet)
  const rider = new THREE.Group();
  const suit = phong(0x22252c, { shininess: 30 }), helmetMat = phong(0xeeeeee, { shininess: 120 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 0.22), suit);
  torso.position.set(0, 1.22, 0.24); torso.rotation.x = -0.55; rider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), helmetMat); head.position.set(0, 1.6, -0.02); rider.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.1), phong(0x0b1620, { shininess: 150 })); visor.position.set(0, 1.62, -0.12); rider.add(visor);
  const barY = top.y + 0.32;     // handlebar height in chassis space
  for (const sx of [-1, 1]) {
    rider.add(limb(new THREE.Vector3(sx * 0.2, 1.42, 0.1), new THREE.Vector3(sx * 0.32, barY + 0.04, -0.7 + top.z + 0.02), 0.045, suit));
    rider.add(limb(new THREE.Vector3(sx * 0.15, 0.95, 0.42), new THREE.Vector3(sx * 0.22, 0.74, 0.02), 0.075, suit));
    rider.add(limb(new THREE.Vector3(sx * 0.22, 0.74, 0.02), new THREE.Vector3(sx * 0.22, 0.38, 0.38), 0.06, suit));
  }
  chassis.add(rider);

  // cockpit: speedo on the tank, first-person eye point. (The bars themselves are on the front pivot and turn visibly.)
  const group = new THREE.Group();
  const cl = makeCluster(0.3, 0.1125);
  cl.mesh.position.set(0, 1.07, -0.5); cl.mesh.rotation.x = -0.95; group.add(cl.mesh);
  chassis.add(group);
  const cockpit = { group, wheel: { setAngle() {} }, updateCluster: cl.update, eye: new THREE.Vector3(0, 1.62, 0.1), look: new THREE.Vector3(0, 1.4, -20) };

  return { root, chassis, wheels, cockpit, hideInCockpit: [rider], bodyMeshes: [tank, tail, bodyOnFork] };
}

// ───────────────────────────── bus ─────────────────────────────

/** Same return shape as buildCar(). 11 m long, driver on the left at the front, seats down the aisle. */
export function buildBus() {
  const root = new THREE.Group(), chassis = new THREE.Group();
  root.add(chassis);

  const paint = phong(0xf0b323, { shininess: 70, specular: 0x665533 });
  const stripe = phong(0x1c2b3f, { shininess: 40 });
  const glassMat = phong(0x10202e, { transparent: true, opacity: 0.78, shininess: 150, specular: 0xaaccff });
  const dark = phong(0x17181c, { shininess: 15 });
  const seatMat = phong(0x2f4f7a, { shininess: 10 });

  // hull (from outside it is solid; from the driver's seat its walls are culled so you can see out)
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, 11), paint); hull.position.set(0, 1.65, 0); chassis.add(hull);
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.34, 11.02), stripe); band.position.set(0, 0.95, 0); chassis.add(band);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.8, 9.6), glassMat); windows.position.set(0, 2.2, 0.3); chassis.add(windows);
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.05, 0.05), glassMat); windscreen.position.set(0, 2.15, -5.51); chassis.add(windscreen);
  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.05), glassMat); rearGlass.position.set(0, 2.2, 5.51); chassis.add(rearGlass);
  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 10.8), phong(0xe8e8ec, { shininess: 30 })); roofCap.position.set(0, 2.81, 0); chassis.add(roofCap);

  // destination board above the windscreen
  const sign = makeLabel('BODY DRIVE 42', { w: 512, h: 96, size: 56, color: '#ffb454', world: 1.5 });
  sign.position.set(0, 2.62, -5.53); chassis.add(sign);

  // lights + bumpers
  const head = new THREE.MeshBasicMaterial({ color: 0xfff1cf }), tail = new THREE.MeshBasicMaterial({ color: 0xff2a1f });
  for (const x of [-0.9, 0.9]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.05), head); h.position.set(x, 0.95, -5.52); chassis.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), tail); t.position.set(x, 1.05, 5.52); chassis.add(t);
  }
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.24, 0.16), dark); bumperF.position.set(0, 0.66, -5.52); chassis.add(bumperF);
  const bumperR = bumperF.clone(); bumperR.position.z = 5.52; chassis.add(bumperR);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.7, 1.0), glassMat); door.position.set(1.26, 1.5, -3.9); chassis.add(door);

  // wheels: front axle steers
  const tyreMat = phong(0x0e0e10, { shininess: 8 }), rimMat = phong(0xb8bcc6, { shininess: 90 });
  const wheels = [];
  for (const [x, z, front, w] of [[-1.2, -3.5, true, 0.34], [1.2, -3.5, true, 0.34], [-1.2, 2.4, false, 0.5], [1.2, 2.4, false, 0.5]]) {
    const wh = makeWheel(0.5, w, x, 0.5, z, front, tyreMat, rimMat);
    root.add(wh.pivot); wheels.push(wh);
  }

  // cockpit: floor, dash, driver's seat, passenger seats, big flat steering wheel, instrument cluster
  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.04, 10.6), phong(0x25262b, { shininess: 5 })); floor.position.set(0, 0.58, 0); group.add(floor);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.55, 0.9), dark); dash.position.set(0, 1.35, -5.0); group.add(dash);
  const dseat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatMat); dseat.position.set(-0.75, 1.0, -4.05); group.add(dseat);
  const dback = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.1), seatMat); dback.position.set(-0.75, 1.42, -3.82); group.add(dback);
  const dpost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), dark); dpost.position.set(-0.75, 0.78, -4.05); group.add(dpost);
  for (let i = 0; i < 8; i++) {
    for (const x of [-0.8, -0.3, 0.45, 0.95]) {
      const z = -2.6 + i * 1.0;
      const cush = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), seatMat); cush.position.set(x, 0.95, z); group.add(cush);
      const bk = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.08), seatMat); bk.position.set(x, 1.27, z + 0.2); group.add(bk);
    }
  }
  const wheel = buildSteeringWheel(0.25);
  wheel.root.position.set(-0.75, 1.62, -4.72);
  wheel.root.rotation.x = -1.0;
  group.add(wheel.root);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 10), dark);
  col.rotation.x = Math.PI / 2 - 1.0; col.position.set(-0.75, 1.42, -4.85); group.add(col);
  const cl = makeCluster(0.42, 0.1575);
  cl.mesh.position.set(-0.75, 1.68, -5.05); cl.mesh.rotation.x = -0.55; group.add(cl.mesh);
  chassis.add(group);

  const cockpit = { group, wheel, updateCluster: cl.update, eye: new THREE.Vector3(-0.75, 2.05, -4.15), look: new THREE.Vector3(-0.75, 1.85, -40) };
  return { root, chassis, wheels, cockpit, hideInCockpit: [], bodyMeshes: [hull, roofCap] };
}
