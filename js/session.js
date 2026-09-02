import * as THREE from './vendor/three.module.js';
import { Track } from './track.js';
import { buildScenery, buildStartLights } from './scenery.js';
import { Car, buildCarMesh } from './car.js';
import { AIDriver, DIFFICULTY, estimateLapTime } from './ai.js';
import { TEAMS, teamById } from './teams.js';
import { store, recordLap, save } from './storage.js';

const TRACE_N = 140;          // delta-timing sample buckets per lap
const FALSE_START_PENALTY = 5;

export class Session {
  // cfg: { mode, trackDef, teamId, laps, difficulty, onEvent }
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.laps = cfg.laps || 3;
    this.onEvent = cfg.onEvent || (() => {});
    this.paused = false;
    this.time = 0;
    this.message = '';
    this.messageUntil = 0;
    this.finished = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(cfg.trackDef.sky);
    this.scene.fog = new THREE.Fog(cfg.trackDef.sky, 620, 2900);

    this.track = new Track(cfg.trackDef);
    this.scene.add(this.track.group);
    const sc = buildScenery(this.track);
    this.scene.add(sc.group);
    this.bounds = sc.bounds;

    const hemi = new THREE.HemisphereLight(0xffffff, cfg.trackDef.ground, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
    sun.position.set(0.6, 1, 0.35).multiplyScalar(400);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    this.camera = new THREE.PerspectiveCamera(64, 1, 0.5, 4000);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();

    this.buildCars();
    this.setupPhase();
    this.track.setRacingLineVisible(store.settings.racingLine);
    this.snapCamera();
  }

  // --- setup ---------------------------------------------------------------

  buildCars() {
    const playerTeam = teamById(this.cfg.teamId);
    this.cars = [];
    this.player = new Car(this.track, { team: playerTeam, name: 'YOU', isPlayer: true });
    this.player.teamName = playerTeam.name;
    this.cars.push(this.player);
    this.scene.add(this.player.mesh);
    this.ais = [];

    if (this.mode === 'race') {
      let seed = 1;
      for (const t of TEAMS) {
        if (t.id === playerTeam.id) continue;
        for (const dn of t.drivers) {
          const c = new Car(this.track, { team: t, name: dn });
          c.teamName = t.name;
          this.scene.add(c.mesh);
          this.cars.push(c);
          this.ais.push(new AIDriver(c, this.track, this.cfg.difficulty, seed++));
        }
      }
    }
  }

  setupPhase() {
    const T = this.track;
    this.lapStart = null;
    this.lapValid = true;
    this.lastLapTime = null;
    this.bestLapTime = store.bestLaps[this.track.def.id] ?? null;
    this.startingBest = this.bestLapTime;   // PB as it stood before this session
    this.sessionBest = null;
    this.bestTrace = (store.bestTraces && store.bestTraces[this.track.def.id]) || null;
    this.curTrace = new Array(TRACE_N).fill(null);
    this.delta = null;

    if (this.mode === 'race') {
      this.setupRace();
    } else if (this.mode === 'qualifying') {
      this.phase = 'outlap';
      this.player.placeAtLapDist(T.length - 190, T.lineOffset[T.indexAtLapDist(T.length - 190)]);
      this.player.vel.copy(this.player.forward).multiplyScalar(52);
      this.setupQualifying();
    } else {
      this.phase = 'drive';
      this.player.placeAtLapDist(2, 0);
    }
  }

  setupQualifying() {
    this.qualiTimes = [];
    const playerTeam = teamById(this.cfg.teamId);
    const base = estimateLapTime(this.track, DIFFICULTY[this.cfg.difficulty].pace);
    for (const t of TEAMS) {
      if (t.id === playerTeam.id) continue;
      for (const dn of t.drivers) {
        const v = 1 + (Math.random() - 0.5) * 0.055;   // per-car variance
        this.qualiTimes.push({
          name: dn, team: t, time: base * v,
          revealAt: 4 + Math.random() * (base * 0.9), revealed: false,
        });
      }
    }
    // ghost pace starts from your own PB (or the field's expected pace)
    this.ghostTime = this.bestLapTime ?? base * 1.03;
    this.ghostOwner = this.bestLapTime ? { name: 'YOUR BEST', team: playerTeam } : { name: 'TARGET', team: TEAMS[0] };
    this.ghostMesh = buildCarMesh(this.ghostOwner.team, true);
    this.ghostMesh.visible = false;
    this.scene.add(this.ghostMesh);
  }

  setupRace() {
    const T = this.track;
    // qualiOrder is [{ name, isPlayer }] with pole first
    this.gridOrder = [];
    let order = this.cars.slice();
    if (this.cfg.qualiOrder) {
      const seen = new Set();
      order = [];
      for (const e of this.cfg.qualiOrder) {
        const c = this.cars.find(c => !seen.has(c) && (e.isPlayer ? c.isPlayer : c.name === e.name));
        if (c) { order.push(c); seen.add(c); }
      }
      for (const c of this.cars) if (!seen.has(c)) order.push(c);
    }
    order.forEach((car, k) => {
      const { d, lateral } = T.gridSlot(k);
      car.placeAtLapDist(((d % T.length) + T.length) % T.length, lateral);
      car.gridPos = k + 1;
      this.gridOrder.push(car);
    });
    this.phase = 'lights';
    this.lightCount = 0;
    this.lightTimer = 2.0;
    this.lightsOutAt = null;
    this.falseStart = false;
    this.raceStart = null;
    this.finishOrder = [];
    this.lights = buildStartLights(this.track);
    this.scene.add(this.lights.group);
    this.lights.off();
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }

  // --- loop ----------------------------------------------------------------

  update(dt, rawInput) {
    if (this.paused) return;
    dt = Math.min(dt, 1 / 30);
    this.time += dt;

    const frozen = this.phase === 'lights';
    const input = this.mapInput(rawInput, frozen);

    if (frozen && (rawInput.up || rawInput.down) && !this.falseStart) {
      this.falseStart = true;
      this.flash('JUMP START — 5 SECOND PENALTY', 3.5);
    }
    if (rawInput.reset) {
      this.player.resetToLine();
      this.lapValid = false;
      rawInput.reset = false;
    }

    // a jump start does not hold you on the grid - you go, and you take the penalty
    const hold = frozen && !this.falseStart;
    this.player.update(dt, hold ? input : this.mapInput(rawInput, false), hold);

    const ready = this.phase === 'green' || this.phase === 'finished';
    this.stepAI(dt, ready);
    this.resolveCarCollisions();
    this.updatePhase(dt);
    this.track.updateRacingLine(
      this.track.lapProgress(this.player.frameInfo.s),
      Math.max(0, this.player.vel.dot(this.player.forward)));
    this.updateTiming(dt);
    this.updateCamera(dt);
    this.updateAudio();
  }

  mapInput(raw, frozen) {
    if (frozen) return { throttle: 0, brake: 1, steer: 0 };
    return {
      throttle: raw.up ? 1 : 0,
      brake: raw.down ? 1 : 0,
      steer: (raw.right ? 1 : 0) - (raw.left ? 1 : 0),
    };
  }

  // two-circle approximation so cars cannot interpenetrate lengthwise
  resolveCarCollisions() {
    const cars = this.cars;
    if (cars.length < 2) return;
    const R = 1.25, OFF = 1.3;
    const pts = cars.map(c => {
      const f = c.forward;
      return [
        new THREE.Vector3(c.pos.x + f.x * OFF, 0, c.pos.z + f.z * OFF),
        new THREE.Vector3(c.pos.x - f.x * OFF, 0, c.pos.z - f.z * OFF),
      ];
    });
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        if (cars[i].pos.distanceToSquared(cars[j].pos) > 40) continue;
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          const pa = pts[i][a], pb = pts[j][b];
          const dx = pa.x - pb.x, dz = pa.z - pb.z;
          const d = Math.hypot(dx, dz);
          if (d > R * 2 || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d;
          const push = (R * 2 - d) * 0.5;
          cars[i].pos.x += nx * push; cars[i].pos.z += nz * push;
          cars[j].pos.x -= nx * push; cars[j].pos.z -= nz * push;
          const rel = (cars[i].vel.x - cars[j].vel.x) * nx + (cars[i].vel.z - cars[j].vel.z) * nz;
          if (rel < 0) {
            const imp = rel * 0.65;
            cars[i].vel.x -= imp * nx; cars[i].vel.z -= imp * nz;
            cars[j].vel.x += imp * nx; cars[j].vel.z += imp * nz;
            const sev = Math.min(1, Math.abs(rel) / 18);
            cars[i].vel.multiplyScalar(1 - 0.10 * sev);
            cars[j].vel.multiplyScalar(1 - 0.10 * sev);
            cars[i].contact = cars[j].contact = 0.4 + sev;
          }
        }
      }
    }
  }

  updatePhase(dt) {
    if (this.phase === 'lights') {
      this.lightTimer -= dt;
      if (this.lightsOutAt == null) {
        if (this.lightTimer <= 0 && this.lightCount < 5) {
          this.lightCount++;
          this.lights.set(this.lightCount);
          this.app.audio.beep(520, 0.14, 0.16);
          this.lightTimer = 1.0;
          if (this.lightCount === 5) this.lightsOutAt = 0.8 + Math.random() * 1.6;
        }
      } else {
        this.lightsOutAt -= dt;
        if (this.lightsOutAt <= 0) {
          this.lights.off();
          this.app.audio.beep(880, 0.25, 0.22);
          this.phase = 'green';
          this.raceStart = this.time;
          this.flash('GO!', 1.2);
        }
      }
      return;
    }

    if (this.phase === 'green') {
      this.checkFinishes(this.time);
      if (this.player.finishTime != null) this.endRace();
    }

    if (this.mode === 'qualifying' && this.phase === 'flying') {
      const el = this.time - this.lapStart;
      for (const q of this.qualiTimes) {
        if (!q.revealed && el >= q.revealAt) {
          q.revealed = true;
          if (q.time < this.ghostTime) {
            this.ghostTime = q.time;
            this.setGhostOwner(q);
            this.flash(`${q.name} sets a ${fmt(q.time)}`, 2.2);
          }
        }
      }
      // ghost drives the current fastest lap
      const d = (el / this.ghostTime) * this.track.length;
      if (el <= this.ghostTime * 1.02) {
        const { p, i } = this.track.linePointAtLapDist(d);
        this.ghostMesh.visible = true;
        this.ghostMesh.position.set(p.x, p.y + 0.02, p.z);
        const t = this.track.tan[i];
        this.ghostMesh.rotation.y = Math.atan2(t.x, t.z);
      } else {
        this.ghostMesh.visible = false;
      }
    }
  }

  setGhostOwner(q) {
    this.ghostOwner = q;
    const old = this.ghostMesh;
    this.scene.remove(old);
    old.traverse(o => { if (o.material) o.material.dispose(); });
    this.ghostMesh = buildCarMesh(q.team, true);
    this.scene.add(this.ghostMesh);
  }

  updateTiming(dt) {
    const p = this.player, T = this.track;
    if (p.justCrossedLine) {
      p.justCrossedLine = false;
      if (this.lapStart != null && this.lapValid) {
        const t = this.time - this.lapStart;
        this.lastLapTime = t;
        if (this.sessionBest == null || t < this.sessionBest) this.sessionBest = t;
        if (this.bestLapTime == null || t < this.bestLapTime) {
          this.bestLapTime = t;
          recordLap(T.def.id, t);
          store.bestTraces = store.bestTraces || {};
          store.bestTraces[T.def.id] = this.curTrace.slice();
          save();
          this.bestTrace = store.bestTraces[T.def.id];
          this.flash('PERSONAL BEST  ' + fmt(t), 2.4);
        }
        if (this.mode === 'qualifying') { this.qualiTime = t; this.endQualifying(); return; }
      }
      this.lapStart = this.time;
      this.lapValid = true;
      this.curTrace = new Array(TRACE_N).fill(null);
      if (this.mode === 'qualifying' && this.phase === 'outlap') {
        this.phase = 'flying';
        this.flash('FLYING LAP', 1.6);
      }
    }

    if (this.lapStart != null) {
      const el = this.time - this.lapStart;
      const bucket = Math.min(TRACE_N - 1, Math.floor(T.lapProgress(p.frameInfo.s) / T.length * TRACE_N));
      if (this.curTrace[bucket] == null) this.curTrace[bucket] = el;
      this.delta = (this.bestTrace && this.bestTrace[bucket] != null) ? el - this.bestTrace[bucket] : null;
    }
  }

  endQualifying() {
    this.phase = 'done';
    if (this.ghostMesh) this.ghostMesh.visible = false;
    const playerTeam = teamById(this.cfg.teamId);
    const entries = this.qualiTimes.map(q => ({ name: q.name, team: q.team, time: q.time }));
    entries.push({ name: 'YOU', team: playerTeam, time: this.qualiTime ?? Infinity, isPlayer: true });
    entries.sort((a, b) => a.time - b.time);
    this.finished = true;
    this.onEvent('qualifying-done', { entries, playerTime: this.qualiTime });
  }

  stepAI(dt, ready) {
    for (const ai of this.ais) {
      const ain = ready ? ai.update(dt, this.cars) : { throttle: 0, brake: 1, steer: 0 };
      ai.car.update(dt, ain, !ready);
    }
  }

  checkFinishes(now) {
    for (const c of this.cars) {
      if (c.finishTime == null && c.lap >= this.laps + 1) {
        c.finishTime = now - this.raceStart;
        this.finishOrder.push(c);
      }
    }
  }

  endRace() {
    this.phase = 'finished';
    // Run the rest of the field to the flag so the timing sheet holds real times
    // rather than extrapolations. 21 cars cost ~0.1ms a step, so this is cheap.
    let t = this.time;
    const step = 1 / 30;
    for (let guard = 0; guard < 90 * 30 && this.finishOrder.length < this.cars.length; guard++) {
      this.stepAI(step, true);
      this.resolveCarCollisions();
      t += step;
      this.checkFinishes(t);
    }
    const results = this.classify(true);
    this.finished = true;
    this.onEvent('race-done', { results, falseStart: this.falseStart });
  }

  // Live or final classification.
  classify(final = false) {
    const done = this.finishOrder.slice();
    const rest = this.cars.filter(c => !done.includes(c));
    rest.sort((a, b) => b.totalDist - a.totalDist);
    const list = [...done, ...rest];
    const playerT = this.player.finishTime ?? (this.time - (this.raceStart ?? this.time));
    // one reference speed for everyone, so estimated gaps stay in classification order
    const refSpeed = Math.max(12, this.player.totalDist / Math.max(1, playerT));
    return list.map((c, i) => {
      let t = c.finishTime;
      if (t == null && final) {
        const behind = Math.max(0, this.player.totalDist - c.totalDist);
        t = playerT + behind / refSpeed;
      }
      if (c === this.player && this.falseStart && t != null) t += FALSE_START_PENALTY;
      return {
        pos: i + 1, name: c.name, team: c.team, teamName: c.teamName,
        isPlayer: c === this.player, time: t, laps: c.lap - 1, car: c,
      };
    });
  }

  playerPosition() {
    let pos = 1;
    for (const c of this.cars) if (c !== this.player && c.totalDist > this.player.totalDist) pos++;
    const finishedAhead = this.finishOrder.indexOf(this.player);
    return finishedAhead >= 0 ? finishedAhead + 1 : pos;
  }

  gapAhead() {
    let best = null;
    for (const c of this.cars) {
      if (c === this.player) continue;
      const d = c.totalDist - this.player.totalDist;
      if (d > 0 && (best == null || d < best)) best = d;
    }
    if (best == null) return null;
    return best / Math.max(14, this.player.vel.length());
  }

  // --- camera --------------------------------------------------------------

  chaseTargets() {
    const c = this.player;
    const f = c.forward;
    const lat = c.vel.dot(c.right);
    const back = 8.8 + Math.min(3, c.speed * 0.045);
    const pos = new THREE.Vector3(
      c.pos.x - f.x * back - lat * 0.10,
      (c.frameInfo.surfaceY || 0) + 3.4 + Math.min(0.9, c.speed * 0.011),
      c.pos.z - f.z * back - lat * 0.10,
    );
    const look = new THREE.Vector3(c.pos.x + f.x * 9, (c.frameInfo.surfaceY || 0) + 1.4, c.pos.z + f.z * 9);
    return { pos, look };
  }

  snapCamera() {
    const { pos, look } = this.chaseTargets();
    this.camPos.copy(pos); this.camLook.copy(look);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
  }

  updateCamera(dt) {
    const { pos, look } = this.chaseTargets();
    const kp = 1 - Math.exp(-7.5 * dt), kl = 1 - Math.exp(-11 * dt);
    this.camPos.lerp(pos, kp);
    this.camLook.lerp(look, kl);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const targetFov = 60 + Math.min(10, this.player.speed * 0.15);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
  }

  updateAudio() {
    const p = this.player;
    this.app.audio.updateEngine(p.rpm, p.throttle, true);
  }

  // --- hud -----------------------------------------------------------------

  flash(msg, dur = 2) { this.message = msg; this.messageUntil = this.time + dur; }

  hud() {
    const p = this.player, T = this.track;
    const cur = this.lapStart != null ? this.time - this.lapStart : null;
    const h = {
      speed: Math.round(Math.abs(p.vel.dot(p.forward)) * 3.6),
      current: cur,
      record: this.bestLapTime,
      delta: this.delta,
      message: this.time < this.messageUntil ? this.message : '',
      offTrack: p.offTrack,
      phase: this.phase,
      cars: this.cars,
      player: p,
    };
    if (this.mode === 'race') {
      h.lap = `${Math.min(this.laps, Math.max(1, p.lap))}/${this.laps}`;
      h.position = `${this.playerPosition()}/${this.cars.length}`;
      h.gap = this.gapAhead();
      if (this.phase === 'lights') h.message = h.message || 'LIGHTS OUT SOON — HOLD';
    } else if (this.mode === 'qualifying') {
      h.lap = this.phase === 'outlap' ? 'OUT LAP' : 'FLYING';
      h.target = this.ghostTime;
      h.targetName = this.ghostOwner ? this.ghostOwner.name : '';
      if (this.phase === 'outlap') h.message = h.message || 'CROSS THE LINE TO START YOUR LAP';
    } else {
      h.lap = `LAP ${Math.max(1, p.lap)}`;
    }
    return h;
  }
}

function fmt(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(3)}`;
}
