import * as THREE from './vendor/three.module.js';
import { P } from './car.js';

// Uniform per-difficulty pace. Applied identically to every AI car — no team
// tiers, and deliberately no rubber-banding: this is a flat baseline.
export const DIFFICULTY = {
  easy:   { label: 'Easy',   pace: 0.780, aggression: 0.45, mistakes: 0.030 },
  medium: { label: 'Medium', pace: 0.895, aggression: 0.70, mistakes: 0.012 },
  hard:   { label: 'Hard',   pace: 1.000, aggression: 0.95, mistakes: 0.004 },
};

const TOP = P.topSpeed;

// Fastest speed sustainable through a corner of curvature k, allowing for grip
// that itself rises with speed. Solving v^2 = g(1 + a v^2)/k for v: past a
// critical radius the downforce wins and the corner is flat out.
function cornerSpeed(k, grip) {
  const denom = k - grip * P.aeroGrip;
  if (denom <= 1e-9) return TOP;
  return Math.min(TOP, Math.sqrt(grip / denom));
}
// How much of the car's real envelope the AI actually uses. Left of the limit on
// purpose: a lookahead driver that aims for 100% simply runs wide and never recovers.
const GRIP_MARGIN = 0.85;
const BRAKE_MARGIN = 0.85;

export class AIDriver {
  constructor(car, track, difficulty, seed = 0) {
    this.car = car;
    this.track = track;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    this.seed = seed;
    // small fixed per-car variance so the field does not lap identically
    this.carVar = 1 + ((seed * 0.6180339887 % 1) - 0.5) * 0.016;
    this.lapVar = 1;
    this.lastLap = -1;
    this.offset = 0;         // lateral offset from the racing line
    this.targetOffset = 0;
    this.stuck = 0;
    this.mistake = 0;
  }

  get pace() { return this.d.pace * this.carVar * this.lapVar; }

  update(dt, cars) {
    const car = this.car, track = this.track;
    if (car.lap !== this.lastLap) {
      this.lastLap = car.lap;
      this.lapVar = 1 + (Math.random() - 0.5) * 0.014;
    }
    if (this.mistake > 0) this.mistake -= dt;
    else if (Math.random() < this.d.mistakes * dt) this.mistake = 0.35 + Math.random() * 0.5;

    const prog = track.lapProgress(car.frameInfo.s);
    const speed = Math.max(0.5, car.vel.dot(car.forward));

    // --- recovery ---------------------------------------------------------
    const facing = car.forward.dot(track.tan[car.frameInfo.i]);
    if (speed < 4 && Math.abs(car.frameInfo.offset) > track.halfWidth) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 0.6);
    if (this.stuck > 3) { car.resetToLine(); this.stuck = 0; }

    // --- racecraft: pick a lateral offset from the racing line -------------
    this.planOffset(dt, cars, prog, speed);
    this.offset += (this.targetOffset - this.offset) * Math.min(1, dt * 2.2);

    // --- lookahead steering (pure pursuit) ---------------------------------
    // Aim at a point some way down the line, convert that into the path
    // curvature it implies, then into a steering command scaled by whatever
    // lock the car can actually use at this speed.
    // off the road, aim closer so the car actually turns back onto it
    const strayed = Math.abs(car.frameInfo.offset) > track.halfWidth;
    let look = THREE.MathUtils.clamp(5 + speed * 0.40, 8, 30);
    if (strayed) look = Math.min(look, 9 + speed * 0.16);
    const aim = this.pointAt(prog + look);
    const toAim = new THREE.Vector3().subVectors(aim, car.pos).setY(0);
    const Ld = Math.max(3, toAim.length());
    const fwd = car.forward;
    // alpha > 0 when the aim point lies to the car's right
    const alpha = Math.atan2(toAim.dot(car.right), toAim.dot(fwd));
    const wantAngle = Math.atan(2 * Math.sin(alpha) * P.wheelbase / Ld);
    const aero = P.gripOn * (1 + P.aeroGrip * speed * speed);
    const lock = Math.min(P.steerMax, (aero * P.wheelbase / Math.max(1, speed * speed)) * P.steerOverdrive);
    let steer = THREE.MathUtils.clamp(wantAngle / lock - car.turnRate * 0.10, -1, 1);
    if (facing < -0.2) steer = THREE.MathUtils.clamp(alpha * 2.0, -1, 1);

    // --- speed target from upcoming racing-line curvature -------------------
    const grip = P.gripOn * this.pace * GRIP_MARGIN;
    const brake = P.brakeAccel * this.pace * BRAKE_MARGIN;
    let target = TOP * Math.min(1, this.pace + 0.03);
    for (let d = 0; d <= 170; d += 5) {
      const i = track.indexAtLapDist(prog + d);
      const k = Math.max(track.lineCurv[i], 1e-5);
      const vAllow = cornerSpeed(k, grip);
      const vNow = Math.sqrt(vAllow * vAllow + 2 * brake * d);
      target = Math.min(target, vNow);
    }
    if (this.mistake > 0) target *= 0.82;
    if (car.offTrack) target = Math.min(target, 26);

    // --- traffic: do not drive into the back of anyone ---------------------
    const near = this.carAhead(cars, prog);
    if (near) {
      if (near.gap < 6.5 && Math.abs(near.lateral) < 2.4) target = Math.min(target, near.car.vel.length() * 0.92);
      else if (near.gap < 13 && Math.abs(near.lateral) < 2.0) target = Math.min(target, near.car.vel.length() + 3);
    }

    // throttle that merely holds the current speed against drag + rolling loss
    const hold = THREE.MathUtils.clamp((P.dragOn * speed * speed + P.rollOn) / P.engineAccel, 0, 1);
    let throttle = 0, brk = 0;
    if (speed < target - 0.6) throttle = THREE.MathUtils.clamp((target - speed) / 4, hold, 1);
    else if (speed > target + 1.2) brk = THREE.MathUtils.clamp((speed - target) / 7, 0.15, 1);
    else throttle = hold;
    if (facing < -0.2 && speed < 6) { throttle = 0.5; brk = 0; }

    return { throttle, brake: brk, steer };
  }

  // Racing line point `d` metres into the lap, shifted laterally by this.offset.
  pointAt(d) {
    const { p, i } = this.track.linePointAtLapDist(d);
    return p.addScaledVector(this.track.right[i], this.offset);
  }

  carAhead(cars, prog) {
    const track = this.track, L = track.length;
    let best = null;
    for (const o of cars) {
      if (o === this.car) continue;
      let gap = track.lapProgress(o.frameInfo.s) - prog;
      if (gap < -L / 2) gap += L;
      if (gap > L / 2) gap -= L;
      if (gap <= 0 || gap > 40) continue;
      const lateral = o.frameInfo.offset - this.car.frameInfo.offset;
      if (!best || gap < best.gap) best = { car: o, gap, lateral };
    }
    return best;
  }

  carBehind(cars, prog) {
    const track = this.track, L = track.length;
    let best = null;
    for (const o of cars) {
      if (o === this.car) continue;
      let gap = prog - track.lapProgress(o.frameInfo.s);
      if (gap < -L / 2) gap += L;
      if (gap > L / 2) gap -= L;
      if (gap <= 0 || gap > 22) continue;
      if (!best || gap < best.gap) best = { car: o, gap, lateral: o.frameInfo.offset - this.car.frameInfo.offset };
    }
    return best;
  }

  planOffset(dt, cars, prog, speed) {
    const track = this.track;
    const lineOff = track.lineOffset[track.indexAtLapDist(prog)];
    const room = track.halfWidth - 1.6;
    const clampToTrack = (o) => THREE.MathUtils.clamp(o, -room - lineOff, room - lineOff);

    const ahead = this.carAhead(cars, prog);
    const behind = this.carBehind(cars, prog);
    let want = 0;

    if (ahead) {
      const closing = speed - ahead.car.vel.length();
      // attack: pull alongside on whichever side has more asphalt
      if (ahead.gap < 26 && (closing > 1.2 || ahead.gap < 12)) {
        const theirOff = ahead.car.frameInfo.offset;
        const leftRoom = (theirOff + track.halfWidth) - 2.6;
        const rightRoom = (track.halfWidth - theirOff) - 2.6;
        const dir = rightRoom > leftRoom ? 1 : -1;
        want = (theirOff - lineOff) + dir * 3.2 * this.d.aggression;
      }
      // never sit directly behind close enough to touch
      if (ahead.gap < 9 && Math.abs(ahead.lateral) < 2.2) {
        want += (ahead.lateral >= 0 ? -1 : 1) * 2.4;
      }
    } else if (behind && behind.gap < 16) {
      // defend: take the line the follower is trying to use
      want = THREE.MathUtils.clamp((behind.car.frameInfo.offset - lineOff) * 0.7, -3.0, 3.0) * this.d.aggression;
    }

    // running wide: pull back toward the middle before the tyres leave the asphalt
    const edge = track.halfWidth - 1.4;
    const mine = this.car.frameInfo.offset;
    if (Math.abs(mine) > edge) want -= Math.sign(mine) * (Math.abs(mine) - edge) * 1.6;

    // side-by-side: hold your own lane rather than chopping across
    for (const o of cars) {
      if (o === this.car) continue;
      const dSq = o.pos.distanceToSquared(this.car.pos);
      if (dSq > 64) continue;
      const lat = o.frameInfo.offset - this.car.frameInfo.offset;
      if (Math.abs(lat) < 3.4) want += (lat > 0 ? -1 : 1) * (3.4 - Math.abs(lat)) * 0.8;
    }

    this.targetOffset = clampToTrack(want);
  }
}

// Quasi-static lap-time estimate along the racing line for a given pace.
// Used to generate AI qualifying times that match how the AI actually drives.
export function estimateLapTime(track, pace) {
  const n = track.n;
  const grip = P.gripOn * pace * GRIP_MARGIN;
  const brake = P.brakeAccel * pace * BRAKE_MARGIN;
  const top = TOP * Math.min(1, pace + 0.03);
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) ds[i] = track.line[i].distanceTo(track.line[(i + 1) % n]);

  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = cornerSpeed(Math.max(track.lineCurv[i], 1e-5), grip);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n - 1; k >= 0; k--) {       // braking limit
      const i = k, j = (i + 1) % n;
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds[i]));
    }
    for (let k = 0; k < n; k++) {            // traction limit
      const i = k, h = (i - 1 + n) % n;
      const a = P.engineAccel * pace * Math.max(0.15, 1 - v[h] / top);
      v[i] = Math.min(v[i], Math.sqrt(v[h] * v[h] + 2 * a * ds[h]));
    }
  }
  let t = 0;
  for (let i = 0; i < n; i++) t += ds[i] / Math.max(4, (v[i] + v[(i + 1) % n]) / 2);
  // The quasi-static pass is a little pessimistic against what the AI actually
  // laps in; calibrated against the headless sim so grid times match race pace.
  return t * 0.945;
}
