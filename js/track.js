import * as THREE from './vendor/three.module.js';
import { P } from './car.js';

const UP = new THREE.Vector3(0, 1, 0);
const SPACING = 4;          // centreline sample spacing in metres
const CURB_CURV = 0.010;    // 1/R above which we paint kerbing on the inside
const LINE_MARGIN = 1.5;    // how far the racing line stays off the white line

// Terrain beside the circuit: [metres outside the barrier, blend toward the local
// landscape, blend on down to the distant ground plane]. Distances are scaled down
// per sample where a neighbouring part of the lap is close.
//
// Two stages matter. Easing straight to the global ground plane is what turns a
// circuit with real elevation (Spa climbs 100m) into a plateau ringed by cliffs;
// the near apron has to settle onto the hillside the track is actually cut into.
const TERRAIN = [[0, 0, 0], [30, 0, 0], [85, 0.45, 0], [155, 0.85, 0], [230, 1, 0], [310, 1, 1]];
const TERRAIN_MAX = 310;

const LINE_GREEN = [0.16, 0.85, 0.36];
const LINE_AMBER = [0.98, 0.78, 0.10];
const LINE_RED = [0.94, 0.20, 0.16];

// --- geometry helpers -------------------------------------------------------

function ribbonGeom(inner, outer, yOff, closed) {
  const n = inner.length;
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    pos[i * 6 + 0] = inner[i].x; pos[i * 6 + 1] = inner[i].y + yOff; pos[i * 6 + 2] = inner[i].z;
    pos[i * 6 + 3] = outer[i].x; pos[i * 6 + 4] = outer[i].y + yOff; pos[i * 6 + 5] = outer[i].z;
  }
  const idx = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function ribbon(inner, outer, color, yOff = 0) {
  return new THREE.Mesh(ribbonGeom(inner, outer, yOff, true),
    new THREE.MeshLambertMaterial({ color, flatShading: true }));
}

// Vertical wall standing on `base`, `h` tall, closed loop.
function wall(base, h, color) {
  const n = base.length;
  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    pos[i * 6 + 0] = base[i].x; pos[i * 6 + 1] = base[i].y; pos[i * 6 + 2] = base[i].z;
    pos[i * 6 + 3] = base[i].x; pos[i * 6 + 4] = base[i].y + h; pos[i * 6 + 5] = base[i].z;
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide }));
}

function ribbonSpan(inner, outer, from, to, yOff) {
  const a = [], b = [];
  for (let i = from; i <= to; i++) { a.push(inner[i]); b.push(outer[i]); }
  return ribbonGeom(a, b, yOff, false);
}

function mergeGeoms(list) {
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

// --- track ------------------------------------------------------------------

export class Track {
  constructor(def) {
    this.def = def;
    this.halfWidth = def.halfWidth;
    this.runoff = def.runoff;
    this.wallDist = def.halfWidth + def.runoff;

    const sc = def.scale || 1;   // uniform, so designed gradients are preserved
    const ys = (def.yScale ?? 1) * sc;   // gradients tuned separately from plan scale
    // Three.js is right-handed, so with the car driving toward +z it is world -x
    // that lies to the driver's right: a lap is clockwise *as driven* when its
    // signed area in the xz plane is positive. Mirror x when that disagrees with
    // the direction the real circuit runs, so a layout can never come out reversed.
    let area = 0;
    for (let i = 0; i < def.points.length; i++) {
      const a = def.points[i], b = def.points[(i + 1) % def.points.length];
      area += a[0] * b[2] - b[0] * a[2];
    }
    const wantCW = (def.dir || 'cw') === 'cw';
    const mx = ((-area > 0) === wantCW) ? -1 : 1;
    this.direction = wantCW ? 'cw' : 'ccw';
    const ctrl = def.points.map(p => new THREE.Vector3(p[0] * sc * mx, p[1] * ys, p[2] * sc));
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal', 0.5);
    const n = Math.max(64, Math.round(curve.getLength() / SPACING));

    this.pos = curve.getSpacedPoints(n);
    this.pos.pop();                     // getSpacedPoints repeats the first point
    this.n = this.pos.length;

    this.tan = []; this.right = [];
    this.curv = new Float32Array(this.n);
    this.dist = new Float32Array(this.n);
    this.length = 0;

    for (let i = 0; i < this.n; i++) {
      const a = this.pos[(i - 1 + this.n) % this.n], b = this.pos[(i + 1) % this.n];
      const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
      this.tan.push(t);
      this.right.push(new THREE.Vector3().crossVectors(t, UP).normalize());
    }
    for (let i = 0; i < this.n; i++) {
      this.dist[i] = this.length;
      this.length += this.pos[i].distanceTo(this.pos[(i + 1) % this.n]);
    }
    // signed curvature (positive = turning right) from heading change over 4 samples
    for (let i = 0; i < this.n; i++) {
      const a = this.tan[(i - 2 + this.n) % this.n], b = this.tan[(i + 2) % this.n];
      const cross = a.x * b.z - a.z * b.x;
      const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
      this.curv[i] = Math.atan2(-cross, dot) / (4 * SPACING);
    }

    // start/finish distance from the nominated control point
    const sp = ctrl[def.start || 0];
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = this.pos[i].distanceToSquared(sp);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.startIndex = best;
    this.startS = this.dist[best];

    this.computeLandscape();

    this.computeTerrainReach();
    this.buildRacingLine();
    this.buildSpeedProfile();
    this.group = new THREE.Group();
    this.buildMeshes();
  }

  // Relaxation: repeatedly pull each racing-line point toward the midpoint of its
  // neighbours (projected onto the local track normal), clamped inside the track.
  buildRacingLine() {
    const n = this.n;
    const off = new Float32Array(n);
    const maxOff = Math.max(0.5, this.halfWidth - LINE_MARGIN);
    const p = (i) => {
      const j = ((i % n) + n) % n;
      return new THREE.Vector3().copy(this.pos[j]).addScaledVector(this.right[j], off[j]);
    };
    // Multi-scale relaxation. A single fine stencil propagates information only
    // ~k samples per sweep, so on a full-length circuit (Spa is 1748 samples) it
    // never converges and leaves kinks in the line - a 2.5 m radius on a straight.
    // Coarse sweeps settle the broad shape, fine sweeps sharpen the apexes.
    for (const [k, iters] of [[40, 60], [20, 70], [10, 90], [5, 120], [3, 120]]) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < n; i++) {
          const mid = p(i - k).add(p(i + k)).multiplyScalar(0.5);
          const d = mid.sub(this.pos[i]).dot(this.right[i]);
          off[i] = THREE.MathUtils.clamp(off[i] + (d - off[i]) * 0.35, -maxOff, maxOff);
        }
      }
    }
    // final light smoothing so no single sample can kink the line
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let d = -2; d <= 2; d++) a += off[(i + d + n) % n];
      sm[i] = a / 5;
    }
    off.set(sm);

    this.lineOffset = off;
    this.line = [];
    for (let i = 0; i < n; i++) this.line.push(p(i));

    // curvature of the racing line - what the AI actually brakes for
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.line[(i - 3 + n) % n], b = this.line[i], c = this.line[(i + 3) % n];
      const v1 = new THREE.Vector3().subVectors(b, a).setY(0);
      const v2 = new THREE.Vector3().subVectors(c, b).setY(0);
      const l1 = v1.length(), l2 = v2.length();
      if (l1 < 1e-4 || l2 < 1e-4) continue;
      v1.divideScalar(l1); v2.divideScalar(l2);
      const ang = Math.abs(Math.atan2(v1.x * v2.z - v1.z * v2.x, v1.dot(v2)));
      raw[i] = ang / ((l1 + l2) * 0.5);
    }
    this.lineCurv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) s += raw[(i + d + n) % n];
      this.lineCurv[i] = s / 5;
    }
  }

  buildMeshes() {
    const n = this.n, hw = this.halfWidth;
    const inner = [], outer = [], wallL = [], wallR = [];
    for (let i = 0; i < n; i++) {
      const p = this.pos[i], r = this.right[i];
      inner.push(new THREE.Vector3().copy(p).addScaledVector(r, -hw));
      outer.push(new THREE.Vector3().copy(p).addScaledVector(r, hw));
      wallL.push(new THREE.Vector3().copy(p).addScaledVector(r, -this.wallDist).setY(p.y - 0.15));
      wallR.push(new THREE.Vector3().copy(p).addScaledVector(r, this.wallDist).setY(p.y - 0.15));
    }
    this.wallL = wallL; this.wallR = wallR;

    // Terrain: a flat apron beside the track easing down to ground level over a long
    // run. Built from the same TERRAIN table that grounds every prop, so nothing
    // floats and there is no cliff edge where the apron stops.
    const ringAt = (r, side) => this.pos.map((p, i) => {
      const clear = TERRAIN[r][0] * (this.reach[i] / TERRAIN_MAX);
      return new THREE.Vector3().copy(p)
        .addScaledVector(this.right[i], side * (this.wallDist + clear))
        .setY(this.terrainY(clear, i));
    });
    for (let r = 0; r < TERRAIN.length - 1; r++) {
      const shade = r === 0 ? this.def.hue : this.def.ground;
      this.group.add(ribbon(ringAt(r + 1, -1), ringAt(r, -1), shade, 0));
      this.group.add(ribbon(ringAt(r, 1), ringAt(r + 1, 1), shade, 0));
    }
    this.group.add(ribbon(inner, outer, 0x53585e, 0.02));   // asphalt

    const edgeLine = (side) => {
      const a = [], b = [];
      for (let i = 0; i < n; i++) {
        const p = this.pos[i], r = this.right[i];
        a.push(new THREE.Vector3().copy(p).addScaledVector(r, side * (hw - 0.5)));
        b.push(new THREE.Vector3().copy(p).addScaledVector(r, side * (hw - 0.08)));
      }
      return ribbon(a, b, 0xe8e8e8, 0.05);
    };
    this.group.add(edgeLine(-1)); this.group.add(edgeLine(1));

    this.buildKerbs();
    this.buildStartLine();

    const barrierCol = this.def.scenery === 'city' ? 0xdadde2 : 0xc2c7cf;
    this.group.add(wall(wallL, 1.15, barrierCol));
    this.group.add(wall(wallR, 1.15, barrierCol));
    const rail = (base, side) => {
      const a = base.map(v => new THREE.Vector3(v.x, v.y + 1.15, v.z));
      const b = a.map((v, i) => new THREE.Vector3().copy(v).addScaledVector(this.right[i], -side * 0.3));
      return ribbon(a, b, 0xcc2b2b, 0);
    };
    this.group.add(rail(wallL, -1)); this.group.add(rail(wallR, 1));

    // Racing line overlay. Vertex-coloured so it can react to the driver's speed the
    // way the F1 games do: green = room to accelerate, red = brake, amber = hold.
    const a = [], b = [];
    for (let i = 0; i < n; i++) {
      const r = this.right[i], p = this.line[i];
      a.push(new THREE.Vector3(p.x, p.y + 0.12, p.z).addScaledVector(r, -0.42));
      b.push(new THREE.Vector3(p.x, p.y + 0.12, p.z).addScaledVector(r, 0.42));
    }
    const geo = ribbonGeom(a, b, 0, true);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    this.racingLineMesh = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82 }));
    this.racingLineMesh.renderOrder = 2;
    this.group.add(this.racingLineMesh);
    this.updateRacingLine(0, 0);
  }

  buildKerbs() {
    const n = this.n, hw = this.halfWidth;
    const reds = [], whites = [];
    for (const s of [-1, 1]) {
      const inn = [], out = [];
      for (let i = 0; i < n; i++) {
        const p = this.pos[i], r = this.right[i];
        inn.push(new THREE.Vector3().copy(p).addScaledVector(r, s * (hw - 0.15)));
        out.push(new THREE.Vector3().copy(p).addScaledVector(r, s * (hw + 1.3)));
      }
      // kerb only where the corner turns toward this side (the apex side)
      const active = (j) => (s > 0 ? this.curv[j] < -CURB_CURV : this.curv[j] > CURB_CURV);
      let i = 0, block = 0;
      while (i < n) {
        if (!active(i)) { i++; continue; }
        let j = i;
        while (j + 1 < n && active(j + 1)) j++;
        if (j - i >= 2) {
          for (let k = i; k < j; k += 3, block++) {
            (block % 2 ? whites : reds).push(ribbonSpan(inn, out, k, Math.min(k + 3, j), 0.06));
          }
        }
        i = j + 1;
      }
    }
    if (reds.length) this.group.add(new THREE.Mesh(mergeGeoms(reds), new THREE.MeshLambertMaterial({ color: 0xd42b2b, flatShading: true })));
    if (whites.length) this.group.add(new THREE.Mesh(mergeGeoms(whites), new THREE.MeshLambertMaterial({ color: 0xf2f2f2, flatShading: true })));
  }

  buildStartLine() {
    const hw = this.halfWidth;
    const i = this.startIndex, p = this.pos[i], r = this.right[i], t = this.tan[i];
    const a = [], b = [];
    for (const k of [-1.1, 1.1]) {
      const c = new THREE.Vector3().copy(p).addScaledVector(t, k);
      a.push(new THREE.Vector3().copy(c).addScaledVector(r, -hw));
      b.push(new THREE.Vector3().copy(c).addScaledVector(r, hw));
    }
    this.group.add(new THREE.Mesh(ribbonSpan(a, b, 0, 1, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xffa519 })));
    // white grid boxes, one per starting slot
    const boxes = [];
    for (let k = 0; k < 22; k++) {
      const slot = this.gridSlot(k);
      const j = this.indexAtLapDist(((slot.d % this.length) + this.length) % this.length);
      const q = this.pos[j], qr = this.right[j], qt = this.tan[j];
      const lat = slot.lateral;
      const c = new THREE.Vector3().copy(q).addScaledVector(qr, lat);
      const inn = [], out = [];
      for (const s of [-2.9, 2.9]) {
        const e = new THREE.Vector3().copy(c).addScaledVector(qt, s);
        inn.push(new THREE.Vector3().copy(e).addScaledVector(qr, -1.3));
        out.push(new THREE.Vector3().copy(e).addScaledVector(qr, 1.3));
      }
      boxes.push(ribbonSpan(inn, out, 0, 1, 0.06));
    }
    this.group.add(new THREE.Mesh(mergeGeoms(boxes), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 })));
  }

  // --- queries --------------------------------------------------------------

  nearestIndex(p, hint = -1) {
    let best = 0, bestD = Infinity;
    if (hint >= 0) {
      for (let d = -24; d <= 24; d++) {
        const i = ((hint + d) % this.n + this.n) % this.n;
        const dd = this.pos[i].distanceToSquared(p);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (bestD < 3600) return best;
    }
    bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dd = this.pos[i].distanceToSquared(p);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  }

  // { i, offset (signed, + = right of centre), s (metres round the lap), surfaceY }
  frame(p, hint = -1) {
    const i = this.nearestIndex(p, hint);
    const c = this.pos[i], t = this.tan[i], r = this.right[i];
    const dx = p.x - c.x, dz = p.z - c.z;
    const along = dx * t.x + dz * t.z;
    const offset = dx * r.x + dz * r.z;
    const j = (i + (along >= 0 ? 1 : -1) + this.n) % this.n;
    const f = Math.min(1, Math.abs(along) / SPACING);
    const surfaceY = c.y + (this.pos[j].y - c.y) * f;
    let s = this.dist[i] + along;
    if (s < 0) s += this.length;
    if (s >= this.length) s -= this.length;
    return { i, offset, s, along, surfaceY };
  }

  // metres travelled since the start/finish line
  lapProgress(s) {
    let v = s - this.startS;
    if (v < 0) v += this.length;
    return v;
  }

  // How far the terrain beside sample `i` may spread before it would run into
  // another part of the circuit. Monaco stacks the Casino section above the
  // tunnel run; without this the upper road's apron roofs over the lower one and
  // the car ends up driving underneath the ground.
  // The hillside the circuit is cut into: its own elevation, smoothed over half a
  // kilometre and dropped a few metres. The apron settles onto this rather than
  // onto one flat plane, so elevation reads as terrain instead of as a plateau.
  computeLandscape() {
    const n = this.n;
    const win = Math.max(3, Math.round(500 / SPACING)) | 1;
    const half = win >> 1;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + this.pos[i].y;
    const sum = (a, b) => {
      a = ((a % n) + n) % n; b = ((b % n) + n) % n;
      return a > b ? pre[n] - pre[a] + pre[b] : pre[b] - pre[a];
    };
    this.land = new Float32Array(n);
    let lo = Infinity;
    for (let i = 0; i < n; i++) {
      const avg = sum(i - half, i + half + 1) / win;
      this.land[i] = Math.min(this.pos[i].y - 1.5, avg - 7);
      lo = Math.min(lo, this.land[i]);
    }
    this.groundY = lo - 5;
  }

  computeTerrainReach() {
    const n = this.n;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let j = 0; j < n; j++) {
        let arc = Math.abs(this.dist[j] - this.dist[i]);
        arc = Math.min(arc, this.length - arc);
        if (arc < 140) continue;
        const d = this.pos[i].distanceToSquared(this.pos[j]);
        if (d < best) best = d;
      }
      const sep = best === Infinity ? 1e4 : Math.sqrt(best);
      // 0.45 of the room left between the two barriers, so any two samples that
      // face each other can never total more than the gap between them
      raw[i] = THREE.MathUtils.clamp((sep - 2 * this.wallDist) * 0.45, 0, TERRAIN_MAX);
    }
    // smooth, and only ever downhill from the neighbours, so the apron tapers
    // into a pinch point instead of stepping
    this.reach = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = raw[i];
      for (let d = -12; d <= 12; d++) m = Math.min(m, raw[(i + d + n) % n] + Math.abs(d) * 6);
      this.reach[i] = m;
    }
  }

  // Height of the ground `clear` metres outside the barrier beside sample `i`.
  // Piecewise linear over TERRAIN so the rendered ribbons and the props standing
  // on them agree exactly.
  terrainY(clear, i) {
    const base = this.pos[i].y - 0.4;
    if (clear <= 0) return base;
    const land = this.land[i];
    const k = this.reach[i] / TERRAIN_MAX;
    let seg = TERRAIN.length - 1;
    for (let t = 1; t < TERRAIN.length; t++) if (clear < TERRAIN[t][0] * k) { seg = t; break; }
    const [d0, l0, g0] = TERRAIN[seg - 1], [d1, l1, g1] = TERRAIN[seg];
    const a = d0 * k, b = d1 * k;
    const f = clear >= b ? 1 : (b - a < 1e-4 ? 1 : (clear - a) / (b - a));
    const tl = l0 + (l1 - l0) * f, tg = g0 + (g1 - g0) * f;
    return base + (land - base) * tl + (this.groundY - land) * tg;
  }

  // Ideal speed at every point of the racing line, at the car's real limits.
  // Backward pass = braking, forward pass = traction.
  buildSpeedProfile() {
    const n = this.n;
    const grip = P.gripOn * 0.96, brake = P.brakeAccel * 0.9, top = P.topSpeed;
    const ds = new Float32Array(n);
    for (let i = 0; i < n; i++) ds[i] = this.line[i].distanceTo(this.line[(i + 1) % n]);
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // grip rises with speed, so solve v^2 = g(1 + a v^2)/k rather than v = sqrt(g/k)
      const k = Math.max(this.lineCurv[i], 1e-5);
      const denom = k - grip * P.aeroGrip;
      v[i] = denom <= 1e-9 ? top : Math.min(top, Math.sqrt(grip / denom));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds[i]));
      }
      for (let i = 0; i < n; i++) {
        const h = (i - 1 + n) % n;
        const a = P.engineAccel * Math.max(0.15, 1 - v[h] / top);
        v[i] = Math.min(v[i], Math.sqrt(v[h] * v[h] + 2 * a * ds[h]));
      }
    }
    this.lineSpeed = v;
  }

  // Recolour the line for the driver's current speed and position.
  updateRacingLine(lapDist, speed) {
    if (!this.racingLineMesh || !this.racingLineMesh.visible) return;
    const n = this.n, step = this.length / n;
    const brake = P.brakeAccel * 0.85;
    const col = this.racingLineMesh.geometry.attributes.color;
    const arr = col.array;
    const i0 = this.indexAtLapDist(lapDist);
    for (let k = 0; k < n; k++) {
      const i = (i0 + k) % n;
      const allow = this.lineSpeed[i];
      // vMax = the fastest you could be travelling right now and still make that
      // point. Red once you are past it (brake), amber where the corner itself
      // will not take much more than you are already doing, green elsewhere.
      const vMax = Math.sqrt(allow * allow + 2 * brake * k * step);
      const c = speed > vMax + 0.5 ? LINE_RED
        : (speed > allow - 2.5 || speed > vMax - 4) ? LINE_AMBER : LINE_GREEN;
      const o = i * 6;
      arr[o] = arr[o + 3] = c[0];
      arr[o + 1] = arr[o + 4] = c[1];
      arr[o + 2] = arr[o + 5] = c[2];
    }
    col.needsUpdate = true;
  }

  // Where car `k` (0 = pole) sits on the grid: metres before the line, and how
  // far off centre. Used both to paint the boxes and to place the cars.
  gridSlot(k) {
    return { d: -12 - k * 9, lateral: (k % 2 === 0 ? -1 : 1) * this.halfWidth * 0.42 };
  }

  // Centreline sample straddling `d` metres past the start line, plus how far
  // into that segment we are. Everything downstream indexes off the CENTRELINE
  // arc length — the racing line has its own, different arc length, and mixing
  // the two silently drags the AI's aim point tens of metres out of place.
  segmentAtLapDist(d) {
    let s = this.startS + d;
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.dist[m] <= s) lo = m; else hi = m - 1; }
    const end = lo + 1 < this.n ? this.dist[lo + 1] : this.length;
    const span = end - this.dist[lo];
    return { i: lo, j: (lo + 1) % this.n, f: span > 1e-5 ? (s - this.dist[lo]) / span : 0 };
  }

  indexAtLapDist(d) { return this.segmentAtLapDist(d).i; }

  // Point on the racing line `d` metres past the start line.
  linePointAtLapDist(d) {
    const { i, j, f } = this.segmentAtLapDist(d);
    return { p: new THREE.Vector3().lerpVectors(this.line[i], this.line[j], f), i, j, f };
  }

  setRacingLineVisible(v) { this.racingLineMesh.visible = v; }
}
