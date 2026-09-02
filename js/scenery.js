import * as THREE from './vendor/three.module.js';

// Deterministic PRNG so a track looks the same every session.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const hash = (str) => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function instanced(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.count = 0;
  m.frustumCulled = false;
  return m;
}

const TMP = new THREE.Object3D();
function place(mesh, pos, scale, rotY) {
  if (mesh.count >= mesh.instanceMatrix.count) return;
  TMP.position.copy(pos);
  TMP.scale.copy(scale);
  TMP.rotation.set(0, rotY, 0);
  TMP.updateMatrix();
  mesh.setMatrixAt(mesh.count++, TMP.matrix);
}

export function buildScenery(track) {
  const def = track.def;
  const g = new THREE.Group();
  const rand = rng(hash(def.id));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.pos) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 140;
  const gy = track.groundY;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 9, radius * 9), lam(def.ground));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, gy - 0.05, cz);
  g.add(ground);

  // --- candidate prop sites, each sitting exactly on the rendered terrain ---
  const free = [];
  for (let i = 0; i < 9000; i++) {
    const a = rand() * Math.PI * 2;
    const r = (0.12 + 0.88 * Math.sqrt(rand())) * radius;
    const p = V(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
    const f = track.frame(p);
    const clear = Math.abs(f.offset) - track.wallDist;
    if (clear < 12) continue;
    // keep the pit straight clear so props never crowd the grandstands
    let ds = Math.abs(f.i - track.startIndex);
    ds = Math.min(ds, track.n - ds);
    if (ds < 34 && clear < 62) continue;
    if (clear > track.reach[f.i] * 1.05) continue;   // out on the flat ground plane
    p.y = track.terrainY(clear, f.i);
    free.push({ p, clear });
  }
  // shuffle once, then consume in order - no index aliasing, no stacked props
  for (let i = free.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [free[i], free[j]] = [free[j], free[i]];
  }
  let cursor = 0;
  const take = (minClear) => {
    for (let n = 0; n < free.length; n++) {
      const f = free[(cursor + n) % free.length];
      if (f.clear >= minClear) { cursor = (cursor + n + 1) % free.length; return f; }
    }
    return null;
  };

  // real circuits enclose far more ground than the old half-scale ones, so prop
  // counts scale with area rather than being fixed
  const density = THREE.MathUtils.clamp((radius / 700) ** 2, 0.6, 3.2);
  const theme = def.scenery;
  if (free.length) {
    // a backdrop of peaks belongs at Spa and Spielberg, not on the Northamptonshire
    // flat, so it follows the circuit's real elevation range
    let relief = 0;
    for (const p of track.pos) relief = Math.max(relief, p.y);
    if (relief > 25 && theme !== 'city' && theme !== 'marina') addMountains(g, rand, cx, cz, radius, gy);
    if (theme === 'forest' || theme === 'grass' || theme === 'hills') addWoodland(g, rand, take, theme, density);
    if (theme === 'dunes') addDunes(g, rand, take, density);
    if (theme === 'city' || theme === 'marina') addTownscape(g, rand, take, theme, cx, cz, radius, gy, density);
  }

  g.add(buildStartArea(track));
  return { group: g, bounds: { cx, cz, radius, groundY: gy } };
}

// --- backdrop ---------------------------------------------------------------

function addMountains(g, rand, cx, cz, radius, gy) {
  const N = 44;
  const rock = instanced(new THREE.ConeGeometry(1, 1, 5, 1), lam(0x74879a), N);
  const snow = instanced(new THREE.ConeGeometry(1, 1, 5, 1), lam(0xf4f8fb), N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rand() - 0.5) * 0.12;
    // well beyond the circuit, and never taller than the horizon can carry, so
    // they read as a backdrop instead of walling the track in
    const r = radius * (2.1 + rand() * 1.3);
    const h = Math.min(radius * 0.5, 120 + rand() * 230), w = h * (0.9 + rand() * 0.8);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // a cone's origin is its centre, so the base only meets the ground at gy + h/2
    place(rock, new THREE.Vector3(x, gy + h / 2 - 6, z), new THREE.Vector3(w, h, w), rand() * 6.28);
    if (h > 210) {
      const cap = 0.2;
      place(snow, new THREE.Vector3(x, gy + h - 6 - h * cap / 2, z),
        new THREE.Vector3(w * cap, h * cap, w * cap), 0);
    }
  }
  g.add(rock);
  if (snow.count) g.add(snow);
}

// --- themes -----------------------------------------------------------------

function addWoodland(g, rand, take, theme, density) {
  const N = Math.round((theme === 'forest' ? 1100 : 620) * density);
  const trunk = instanced(new THREE.CylinderGeometry(0.32, 0.5, 1, 5), lam(0x5b4632), N);
  const pine = instanced(new THREE.ConeGeometry(1, 1, 7, 2), lam(0x2c6f33), N);
  const broad = instanced(new THREE.IcosahedronGeometry(1, 1), lam(0x3f9440), N);
  const broad2 = instanced(new THREE.IcosahedronGeometry(1, 1), lam(0x54a94b), N);
  const NB = Math.round(320 * density);
  const bush = instanced(new THREE.IcosahedronGeometry(1, 1), lam(0x487f3c), NB);

  // trees arrive in clumps rather than an even sprinkle - reads far less synthetic
  let planted = 0;
  while (planted < N) {
    const seed = take(16);
    if (!seed) break;
    const clump = 3 + ((rand() * 7) | 0);
    const spread = 9 + rand() * 16;
    for (let k = 0; k < clump && planted < N; k++, planted++) {
      const dx = (rand() - 0.5) * spread * 2, dz = (rand() - 0.5) * spread * 2;
      const h = 6 + rand() * 10, w = h * (0.3 + rand() * 0.16);
      const b = new THREE.Vector3(seed.p.x + dx, seed.p.y, seed.p.z + dz);
      place(trunk, new THREE.Vector3(b.x, b.y + h * 0.2, b.z), new THREE.Vector3(1, h * 0.4, 1), 0);
      const roll = rand();
      if (roll < 0.5) place(pine, new THREE.Vector3(b.x, b.y + h * 0.66, b.z), new THREE.Vector3(w, h, w), rand() * 6.28);
      else if (roll < 0.78) place(broad, new THREE.Vector3(b.x, b.y + h * 0.72, b.z), new THREE.Vector3(w * 1.5, w * 1.35, w * 1.5), rand() * 6.28);
      else place(broad2, new THREE.Vector3(b.x, b.y + h * 0.74, b.z), new THREE.Vector3(w * 1.35, w * 1.5, w * 1.35), rand() * 6.28);
    }
  }
  for (let i = 0; i < NB; i++) {
    const f = take(14);
    if (!f) break;
    const s = 0.7 + rand() * 1.1;
    place(bush, new THREE.Vector3(f.p.x + (rand() - 0.5) * 18, f.p.y + s * 0.5, f.p.z + (rand() - 0.5) * 18),
      new THREE.Vector3(s * 1.5, s, s * 1.5), rand() * 6.28);
  }
  g.add(trunk); g.add(pine); g.add(broad); g.add(broad2); g.add(bush);
}

function addDunes(g, rand, take, density) {
  // no mountains on a North Sea coast: the horizon is dune ridges and marram grass
  const ND = Math.round(240 * density), NS = Math.round(200 * density), NT = Math.round(520 * density);
  const dune = instanced(new THREE.IcosahedronGeometry(1, 1), lam(0xd9c894), ND);
  const sand = instanced(new THREE.IcosahedronGeometry(1, 0), lam(0xcbb682), NS);
  const tuft = instanced(new THREE.ConeGeometry(1, 1, 4, 1), lam(0x9aa860), NT);
  for (let i = 0; i < ND; i++) {
    const f = take(20);
    if (!f) break;
    const s = 7 + rand() * 15;
    // buried past half depth so a dune reads as a swell, not a ball on the grass
    place(dune, new THREE.Vector3(f.p.x, f.p.y - s * 0.62, f.p.z),
      new THREE.Vector3(s * 1.9, s, s * 1.5), rand() * 6.28);
  }
  for (let i = 0; i < NS; i++) {
    const f = take(14);
    if (!f) break;
    const s = 3 + rand() * 7;
    place(sand, new THREE.Vector3(f.p.x, f.p.y - s * 0.55, f.p.z), new THREE.Vector3(s * 2, s, s * 1.6), rand() * 6.28);
  }
  for (let i = 0; i < NT; i++) {
    const f = take(13);
    if (!f) break;
    const h = 1.5 + rand() * 2.2;
    place(tuft, new THREE.Vector3(f.p.x + (rand() - 0.5) * 22, f.p.y + h * 0.5, f.p.z + (rand() - 0.5) * 22),
      new THREE.Vector3(1.1, h, 1.1), rand() * 6.28);
  }
  g.add(dune); g.add(sand); g.add(tuft);
}

function addTownscape(g, rand, take, theme, cx, cz, radius, gy, density) {
  const palette = theme === 'city'
    ? [0xe8d9bd, 0xdcc7a6, 0xf0e4d0, 0xcbb894, 0xe6cfae]
    : [0xf0ece2, 0xdfe6ec, 0xe8dccb, 0xcfd8e0];
  const per = Math.round(70 * density);
  const blocks = palette.map(c => instanced(new THREE.BoxGeometry(1, 1, 1), lam(c), per));
  const roofs = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0xa8654a), palette.length * per);
  for (let i = 0; i < palette.length * per; i++) {
    const f = take(9);
    if (!f) break;
    const m = blocks[i % blocks.length];
    if (m.count >= per) continue;
    const h = theme === 'city' ? 14 + rand() * 52 : 8 + rand() * 24;
    // a block can only be as wide as the gap it stands in, or it overhangs the road
    const room = Math.max(6, (f.clear - 3) * 1.5);
    const w = Math.min(room, 11 + rand() * 20), d = Math.min(room, 11 + rand() * 20);
    const rot = rand() * 6.28;
    place(m, new THREE.Vector3(f.p.x, f.p.y + h / 2, f.p.z), new THREE.Vector3(w, h, d), rot);
    place(roofs, new THREE.Vector3(f.p.x, f.p.y + h + 0.5, f.p.z), new THREE.Vector3(w + 1.2, 1, d + 1.2), rot);
  }
  blocks.forEach(b => g.add(b));
  g.add(roofs);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(radius * 3.2, radius * 1.8),
    new THREE.MeshLambertMaterial({ color: 0x2f8fbf, flatShading: true }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx + radius * 1.5, gy + 0.25, cz - radius * 0.5);
  g.add(water);

  const hull = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0xf6f7f9), 44);
  const mast = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0xdfe3e8), 44);
  for (let i = 0; i < 44; i++) {
    const p = new THREE.Vector3(cx + radius * (0.95 + rand() * 0.85), gy + 1.1, cz - radius * (rand() * 0.9));
    const l = 8 + rand() * 18, rot = rand() * 6.28;
    place(hull, p, new THREE.Vector3(l * 0.32, 2.2, l), rot);
    place(mast, new THREE.Vector3(p.x, p.y + 7, p.z), new THREE.Vector3(0.5, 12, 0.5), rot);
  }
  g.add(hull); g.add(mast);
}

// --- start/finish furniture -------------------------------------------------

// Grandstands are swept ALONG the centreline rather than dropped in as one long
// straight box: a straight box beside a curving pit straight cuts across the road.
function buildStartArea(track) {
  const g = new THREE.Group();
  const n = track.n;
  const seatCols = [0x2b6fd4, 0xd44b3f, 0xf2c400, 0x36b06a];
  const SEG = 4;                       // centreline samples per stand section
  const spans = [[-30, -8], [-4, 18]]; // index offsets from the start line

  const segCount = spans.length * 2 * Math.ceil(26 / SEG) + 8;
  const tiers = seatCols.map(c => instanced(new THREE.BoxGeometry(1, 1, 1), lam(c), segCount * 2));
  const backs = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0x9aa3ad), segCount);
  const roofs = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0xd6dbe1), segCount);
  const facia = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0xffa519), segCount);
  const posts = instanced(new THREE.BoxGeometry(1, 1, 1), lam(0xb8bec6), segCount);

  let block = 0;
  for (const side of [-1, 1]) {
    for (const [from, to] of spans) {
      block++;
      for (let k = from; k < to; k += SEG) {
        const i = ((track.startIndex + k) % n + n) % n;
        const p = track.pos[i], r = track.right[i], t = track.tan[i];
        const yaw = Math.atan2(t.x, t.z);
        const len = SEG * 4.1;
        const at = (lat, h) => new THREE.Vector3()
          .copy(p).addScaledVector(r, side * (track.wallDist + 15 + lat)).setY(p.y - 0.4 + h);

        for (let s = 0; s < 5; s++) {
          const m = tiers[(block + s) % tiers.length];
          place(m, at(-3.4 + s * 1.9, 0.55 + s * 1.35), new THREE.Vector3(2.0, 1.1, len), yaw);
        }
        place(backs, at(5.4, 3.7), new THREE.Vector3(1.2, 7.4, len), yaw);
        place(roofs, at(1.6, 10.4), new THREE.Vector3(8, 0.5, len), yaw);
        place(facia, at(-2.2, 10.0), new THREE.Vector3(0.4, 1.1, len), yaw);
        place(posts, at(-2.2, 5.1), new THREE.Vector3(0.5, 10.2, len * 0.12), yaw);
      }
    }
  }
  tiers.forEach(t => g.add(t));
  g.add(backs); g.add(roofs); g.add(facia); g.add(posts);

  // start gantry over the line
  const gi = track.startIndex;
  const p = track.pos[gi], t = track.tan[gi];
  const gantry = new THREE.Group();
  gantry.position.set(p.x, p.y, p.z);
  gantry.rotation.y = Math.atan2(t.x, t.z);
  const w = track.halfWidth + 2.5;
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), lam(0xe8e8ea));
    leg.position.set(s * w, 4.5, 0);
    gantry.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1.4, 1.8, 1.6), lam(0xe8e8ea));
  beam.position.set(0, 9.4, 0);
  gantry.add(beam);
  const board = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 1.9, 0.35), lam(0x1b1e24));
  board.position.set(0, 8.0, -0.85);
  gantry.add(board);
  const boardTrim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.3, 0.45), lam(0xffa519));
  boardTrim.position.set(0, 7.0, -0.85);
  gantry.add(boardTrim);
  g.add(gantry);
  return g;
}

// Five-light start gantry rig. Returns { group, set(count), off() }.
export function buildStartLights(track) {
  const gi = (track.startIndex + 3) % track.n;
  const p = track.pos[gi], t = track.tan[gi];
  const group = new THREE.Group();
  group.position.set(p.x, p.y + 13.6, p.z);
  group.rotation.y = Math.atan2(t.x, t.z);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(17, 3.4, 0.8), lam(0x14161a));
  group.add(housing);
  const bulbs = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x3a1414 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 9), m);
    b.position.set(-6 + i * 3, 0, -0.6);
    group.add(b);
    bulbs.push(m);
  }
  return {
    group,
    set(count) { bulbs.forEach((m, i) => m.color.setHex(i < count ? 0xff2a1a : 0x3a1414)); },
    off() { bulbs.forEach(m => m.color.setHex(0x3a1414)); },
  };
}
