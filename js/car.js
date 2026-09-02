import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// Shared performance parameters. EVERY car — player and AI, every team — uses
// these exact numbers. Livery is cosmetic; only AI difficulty changes AI pace.
// ---------------------------------------------------------------------------
export const P = {
  wheelbase: 3.6,
  halfWidth: 1.0,
  halfLength: 2.6,
  // Tuned against the real 1:1 circuit geometry so lap times land within a few
  // per cent of real F1 pace. Still short of a real car's ~5g of cornering,
  // deliberately: the shortfall is what keeps it forgiving.
  topSpeed: 96.0,        // m/s (~345 km/h), the drag-limited terminal speed
  engineAccel: 20.0,     // m/s^2 at standstill on full throttle
  brakeAccel: 55.0,
  reverseAccel: 7.0,
  reverseMax: 12.0,
  dragOn: 0.00213,       // v^2 coefficient, set to hit topSpeed
  rollOn: 0.45,
  dragOff: 0.0035,
  rollOff: 3.6,
  offThrottle: 0.62,     // engine multiplier off track
  gripOn: 30.0,          // mechanical lateral accel, m/s^2 (generous on purpose)
  gripKerb: 25.0,
  gripOff: 17.0,
  // Downforce: real cornering grip climbs with speed, which is why Silverstone
  // and Spa are so much faster than their corner radii alone suggest. Without
  // this the fast circuits come out ~14% off the pace while Monaco is spot on.
  aeroGrip: 1.05e-4,      // grip multiplier = 1 + aeroGrip * v^2 (x1.8 at top speed)
  steerOverdrive: 1.22,  // >1 so you *can* provoke a slide if you overdrive it
  steerMax: 0.50,
  slipFree: 4.0,         // lateral slip you get for free before the rear moves
  slipYaw: 0.055,        // oversteer gain past that...
  slipCap: 7.0,          // ...but capped, so a slide never feeds itself into a pirouette
  slipFade: 8.5,         // slip at which steering authority has halved (understeer wins)
  yawMax: 3.4,
  spinDamp: 2.2,
};

const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

export function buildCarMesh(team, ghost = false) {
  const g = new THREE.Group();
  const mk = (c) => {
    const m = lam(c);
    if (ghost) { m.transparent = true; m.opacity = 0.34; m.depthWrite = false; }
    return m;
  };
  const body = mk(team.body), accent = mk(team.accent), trim = mk(team.trim);
  const dark = mk(ghost ? team.body : 0x14161a);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    g.add(m); return m;
  };

  // nose + monocoque (car points along +z)
  const nose = new THREE.CylinderGeometry(0.12, 0.34, 1.9, 4);
  add(nose, body, 0, 0.42, 1.55, Math.PI / 2, 0, Math.PI / 4);
  add(new THREE.BoxGeometry(0.86, 0.46, 2.0), body, 0, 0.48, 0.35);
  add(new THREE.BoxGeometry(0.62, 0.3, 0.9), body, 0, 0.76, 0.05);         // cockpit surround
  add(new THREE.BoxGeometry(0.44, 0.34, 0.44), dark, 0, 0.74, 0.42);       // cockpit hole
  add(new THREE.SphereGeometry(0.24, 8, 6), trim, 0, 0.86, 0.18);          // helmet
  add(new THREE.TorusGeometry(0.36, 0.05, 4, 8, Math.PI), trim, 0, 0.92, 0.2, 0, 0, 0); // halo

  // sidepods
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.5, 0.42, 1.6), body, s * 0.68, 0.44, -0.1);
    add(new THREE.BoxGeometry(0.52, 0.1, 1.4), accent, s * 0.68, 0.66, -0.1);
  }
  // engine cover + airbox
  add(new THREE.BoxGeometry(0.72, 0.5, 1.5), body, 0, 0.52, -1.05);
  add(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 5), accent, 0, 0.98, -0.35);
  add(new THREE.BoxGeometry(0.16, 0.42, 1.1), accent, 0, 0.92, -1.0);      // shark fin
  add(new THREE.BoxGeometry(0.2, 0.06, 2.6), accent, 0, 0.72, 0.9);        // nose stripe

  // front wing
  add(new THREE.BoxGeometry(1.9, 0.07, 0.62), body, 0, 0.22, 2.34);
  add(new THREE.BoxGeometry(1.6, 0.05, 0.16), accent, 0, 0.27, 2.55);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.36, 0.62), trim, s * 0.94, 0.34, 2.34);
  // rear wing
  add(new THREE.BoxGeometry(1.28, 0.09, 0.5), body, 0, 0.98, -2.15);
  add(new THREE.BoxGeometry(1.2, 0.14, 0.08), accent, 0, 0.82, -2.24);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.62, 0.5), trim, s * 0.64, 0.72, -2.15);
  // floor
  add(new THREE.BoxGeometry(1.5, 0.08, 3.4), dark, 0, 0.16, -0.1);

  // wheels
  const tyre = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 10);
  const rim = new THREE.CylinderGeometry(0.24, 0.24, 0.44, 8);
  const tyreMat = mk(0x1a1c20), rimMat = mk(team.accent);
  // Two nested groups per wheel: the outer one steers, the inner one spins.
  // Rolling inside the steered frame is what stops a turned wheel wobbling.
  const wheels = [];
  for (const [x, z] of [[-0.92, 1.5], [0.92, 1.5], [-0.98, -1.55], [0.98, -1.55]]) {
    const steerPivot = new THREE.Group();
    const hub = new THREE.Group();
    const t = new THREE.Mesh(tyre, tyreMat); t.rotation.z = Math.PI / 2; hub.add(t);
    const r = new THREE.Mesh(rim, rimMat); r.rotation.z = Math.PI / 2; hub.add(r);
    steerPivot.add(hub);
    steerPivot.position.set(x, 0.46, z);
    g.add(steerPivot);
    wheels.push({ steerPivot, hub });
  }
  g.userData.wheels = wheels;
  return g;
}

export class Car {
  constructor(track, opts = {}) {
    this.track = track;
    this.team = opts.team;
    this.name = opts.name || 'DRIVER';
    this.isPlayer = !!opts.isPlayer;
    this.mesh = buildCarMesh(opts.team, !!opts.ghost);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.hint = -1;
    this.lap = 0;
    this.prevProgress = 0;
    this.totalDist = 0;
    this.offTrack = false;
    this.wallHit = 0;
    this.contact = 0;
    this.rpm = 0.2;
    this.frameInfo = { i: 0, offset: 0, s: 0, surfaceY: 0 };
  }

  get speed() { return this.vel.length(); }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  // Screen-right, and identical in handedness to Track.right (= tangent x up).
  // Three.js is right-handed, so with the camera looking down +z it is world -x
  // that appears on the driver's right — getting this backwards inverts steering.
  get right() { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }
  // positive = turning right, i.e. the same sign as the steering input
  get turnRate() { return -this.yawRate; }
  get kmh() { return this.speed * 3.6; }

  placeAtLapDist(d, lateral = 0) {
    const i = this.track.indexAtLapDist(d);
    const p = this.track.pos[i], r = this.track.right[i], t = this.track.tan[i];
    this.pos.copy(p).addScaledVector(r, lateral);
    this.yaw = Math.atan2(t.x, t.z);
    this.vel.set(0, 0, 0);
    this.yawRate = 0;
    this.hint = i;
    const f = this.track.frame(this.pos, i);
    this.frameInfo = f;
    this.prevProgress = this.track.lapProgress(f.s);
    this.totalDist = this.prevProgress;
    this.syncMesh();
  }

  resetToLine() {
    const prog = this.track.lapProgress(this.frameInfo.s);
    const { p } = this.track.linePointAtLapDist(prog);
    const i = this.track.indexAtLapDist(prog);
    this.pos.copy(p);
    this.yaw = Math.atan2(this.track.tan[i].x, this.track.tan[i].z);
    this.vel.set(0, 0, 0);
    this.yawRate = 0;
    this.hint = i;
  }

  // input: { throttle 0..1, brake 0..1, steer -1..1 } (raw, digital)
  update(dt, input, frozen = false) {
    // --- input smoothing: ramps in and out, snappy but not instant ----------
    const to = (cur, tgt, up, down) => {
      const rate = Math.abs(tgt) > Math.abs(cur) ? up : down;
      const d = tgt - cur;
      const step = rate * dt;
      return Math.abs(d) <= step ? tgt : cur + Math.sign(d) * step;
    };
    // Held on the grid: genuinely locked. Do NOT do this by holding the brake -
    // on a stopped car the brake is the reverse gear, and the whole grid backs up.
    if (frozen) {
      this.throttle = 0; this.brake = 0; this.steer = 0;
      this.vel.set(0, 0, 0);
      this.yawRate = 0;
      this.rpm = 0.16;
      this.frameInfo = this.track.frame(this.pos, this.hint);
      this.hint = this.frameInfo.i;
      this.syncMesh();
      return;
    }
    this.throttle = to(this.throttle, input.throttle, 5.5, 8.0);
    this.brake = to(this.brake, input.brake, 9.0, 11.0);
    this.steer = to(this.steer, input.steer, 6.5, 11.0);

    const f = this.track.frame(this.pos, this.hint);
    this.hint = f.i;
    this.frameInfo = f;
    const absOff = Math.abs(f.offset);
    const hw = this.track.halfWidth;
    this.offTrack = absOff > hw + 1.4;   // the kerb still counts as road
    const onKerb = !this.offTrack && absOff > hw - 1.0;

    // Surface grip sets how hard you may *ask* the car to turn; braking eats into
    // what the tyres can actually *hold*. Splitting the two is what makes hard
    // mid-corner braking - and only that - genuinely unsettle the car.
    const base = this.offTrack ? P.gripOff : (onKerb ? P.gripKerb : P.gripOn);
    const surfaceGrip = base * (1 + P.aeroGrip * this.vel.lengthSq());
    const gripLat = surfaceGrip * (1 - 0.24 * this.brake * Math.min(1, Math.abs(this.steer)));

    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    let vLong = this.vel.dot(fwd);
    let vLat = this.vel.dot(right);

    // --- steering: limited by the grip actually available -------------------
    const v2 = Math.max(1, vLong * vLong);
    const limit = Math.min(P.steerMax, (surfaceGrip * P.wheelbase / v2) * P.steerOverdrive);
    const steerAngle = this.steer * limit;
    // Steering authority fades as the tyres slide: a car that is already sideways
    // pushes on rather than pirouetting. This is what keeps it forgiving.
    const slide = Math.abs(vLat) / P.slipFade;
    const authority = 1 / (1 + slide * slide);
    // increasing yaw swings the nose to the left, so steering right lowers it
    let yawRate = -(vLong / P.wheelbase) * Math.tan(steerAngle) * authority;
    // oversteer for feel: past a free band the rear rotates into the slide, capped
    const excess = Math.min(P.slipCap, Math.max(0, Math.abs(vLat) - P.slipFree));
    yawRate += Math.sign(vLat) * excess * P.slipYaw;
    yawRate = THREE.MathUtils.clamp(yawRate, -P.yawMax, P.yawMax);
    this.yawRate = yawRate;
    this.yaw += yawRate * dt;

    // recompute body axes after rotating, then let friction fight the new slip
    const nf = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const nr = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    vLong = this.vel.dot(nf);
    vLat = this.vel.dot(nr);
    const bite = gripLat * dt;
    vLat = Math.abs(vLat) <= bite ? 0 : vLat - Math.sign(vLat) * bite;
    vLat -= vLat * Math.min(1, P.spinDamp * dt * 0.25);

    // --- longitudinal ------------------------------------------------------
    const engineMul = this.offTrack ? P.offThrottle : 1;
    const drag = this.offTrack ? P.dragOff : P.dragOn;
    const roll = this.offTrack ? P.rollOff : P.rollOn;
    if (this.throttle > 0.01 && this.brake < 0.5) {
      vLong += this.throttle * P.engineAccel * engineMul * dt;
    }
    if (this.brake > 0.01) {
      if (vLong > 0.4) vLong = Math.max(0, vLong - this.brake * P.brakeAccel * dt);
      else vLong = Math.max(-P.reverseMax, vLong - this.brake * P.reverseAccel * dt);
    }
    vLong -= (drag * vLong * Math.abs(vLong) + roll * Math.sign(vLong)) * dt;
    if (this.throttle < 0.01 && this.brake < 0.01 && Math.abs(vLong) < 0.35) vLong = 0;

    // gravity component along the slope (Spa / Red Bull Ring actually feel hilly)
    const slope = this.slopeAt(f);
    vLong -= 9.81 * slope * dt;

    this.vel.copy(nf).multiplyScalar(vLong).addScaledVector(nr, vLat);
    this.pos.addScaledVector(this.vel, dt);

    this.resolveWalls();
    this.updateLapCount();

    const gearPos = Math.min(7.9, Math.abs(vLong) / P.topSpeed * 7.4);
    this.rpm = 0.2 + 0.8 * (gearPos - Math.floor(gearPos));
    if (Math.abs(vLong) < 1) this.rpm = 0.15 + 0.1 * this.throttle;

    this.syncMesh();
    this.wallHit = Math.max(0, this.wallHit - dt * 3);
    this.contact = Math.max(0, this.contact - dt * 3);
  }

  slopeAt(f) {
    const t = this.track;
    const a = t.pos[f.i], b = t.pos[(f.i + 1) % t.n];
    const d = a.distanceTo(b);
    if (d < 1e-4) return 0;
    const grade = (b.y - a.y) / d;
    // only the component we are actually driving along
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return grade * Math.max(-1, Math.min(1, fwd.dot(t.tan[f.i])));
  }

  resolveWalls() {
    const t = this.track;
    const f = t.frame(this.pos, this.hint);
    this.hint = f.i;
    const limit = t.wallDist - P.halfWidth * 0.9;
    if (Math.abs(f.offset) <= limit) return;
    const side = Math.sign(f.offset);
    const r = t.right[f.i];
    // push out of the barrier
    this.pos.addScaledVector(r, (limit - Math.abs(f.offset)) * side);
    // reflect the normal component, keep the tangential one (minus a bite)
    const vn = this.vel.dot(r);
    if (vn * side > 0) {
      const sev = Math.min(1, Math.abs(vn) / 22);
      this.vel.addScaledVector(r, -vn * 1.4);
      this.vel.multiplyScalar(1 - 0.30 * sev - 0.06);
      this.wallHit = Math.max(this.wallHit, 0.35 + sev);
      this.yaw += side * sev * 0.12;
    }
    this.frameInfo = t.frame(this.pos, this.hint);
  }

  updateLapCount() {
    const f = this.track.frame(this.pos, this.hint);
    this.frameInfo = f;
    const prog = this.track.lapProgress(f.s);
    const L = this.track.length;
    if (this.prevProgress > L * 0.85 && prog < L * 0.15) { this.lap++; this.justCrossedLine = true; }
    else if (this.prevProgress < L * 0.15 && prog > L * 0.85) { this.lap--; }
    this.prevProgress = prog;
    this.totalDist = this.lap * L + prog;
  }

  syncMesh() {
    const f = this.frameInfo;
    this.mesh.position.set(this.pos.x, (f.surfaceY || 0) + 0.02, this.pos.z);
    this.mesh.rotation.set(0, this.yaw, 0);
    // visual lean: roll into the corner, pitch under braking
    const lat = this.vel.dot(this.right);
    this.mesh.rotation.z = THREE.MathUtils.clamp(this.turnRate * 0.09 + lat * 0.006, -0.09, 0.09);
    this.mesh.rotation.x = THREE.MathUtils.clamp(this.brake * 0.035 - this.throttle * 0.015, -0.05, 0.05);
    const w = this.mesh.userData.wheels;
    if (w) {
      const spin = this.vel.dot(this.forward) * 0.09;
      for (let i = 0; i < 4; i++) {
        w[i].hub.rotation.x -= spin;
        if (i < 2) w[i].steerPivot.rotation.y = -this.steer * 0.42;
      }
    }
  }
}
