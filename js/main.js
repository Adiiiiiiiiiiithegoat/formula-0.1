import * as THREE from './vendor/three.module.js';
import { UI } from './ui.js';
import { Session } from './session.js';
import { PodiumScene } from './podium.js';
import { AudioEngine } from './audio.js';
import { trackById } from './tracks.js';
import { DIFFICULTY } from './ai.js';
import { store, save, recordGP } from './storage.js';

// --------------------------------------------------------------- renderer --
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const cam = app.session?.camera || app.podium?.camera;
  if (cam) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ input --
const input = { up: false, down: false, left: false, right: false, reset: false };
const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'KeyR' && app.session) { input.reset = true; return; }
  const k = KEYS[e.code];
  if (k) { input[k] = true; e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (k) { input[k] = false; e.preventDefault(); }
});
addEventListener('blur', () => { input.up = input.down = input.left = input.right = false; });

// -------------------------------------------------------------------- app --
const ui = new UI();
const audio = new AudioEngine(store.settings);

const app = {
  audio, ui, session: null, podium: null,
  state: {
    teamId: store.settings.lastTeam || 'mclaren',
    trackId: 'monaco', laps: 5, difficulty: 'medium', qualiOrder: null,
  },
};

// first gesture unlocks WebAudio + music
const unlock = () => {
  audio.start();
  audio.resume();
  audio.playMusic();
  removeEventListener('pointerdown', unlock);
  removeEventListener('keydown', unlock);
};
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// ------------------------------------------------------------- session mgmt --
function buildSession(cfg, hudOpts) {
  ui.hide();
  ui.clearPodiumStyle();
  ui.setLoading(true);
  // let the spinner paint before the (synchronous, ~60ms) track build
  setTimeout(() => {
    disposeAll();
    app.session = new Session(app, cfg);
    resize();
    ui.setLoading(false);
    ui.setHud(true, { ...(hudOpts || {}), showLineKey: store.settings.racingLine });
    ui.setMinimap(app.session.track);
  }, 30);
}

function disposeAll() {
  if (app.session) { app.session.dispose(); app.session = null; }
  if (app.podium) { app.podium.dispose(); app.podium = null; }
  audio.silence();
}

function leaveSession() {
  disposeAll();
  ui.setHud(false);
  ui.setPause(false);
}

// ------------------------------------------------------------------ pause --
function togglePause() {
  if (!app.session || app.session.finished) return;
  app.session.paused = !app.session.paused;
  ui.setPause(app.session.paused);
  if (app.session.paused) audio.silence();
}
document.getElementById('hud-pause').onclick = togglePause;
document.querySelectorAll('#pause [data-act]').forEach(b => {
  b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'resume') togglePause();
    else if (a === 'restart') { ui.setPause(false); restartSession(); }
    else if (a === 'quit') { ui.setPause(false); quitSession(); }
  };
});

let lastCfg = null, lastHudOpts = null;
function restartSession() { if (lastCfg) buildSession(lastCfg, lastHudOpts); }

function quitSession() {
  const s = app.session;
  if (s && s.mode === 'timetrial') { showTimeTrialResults(); return; }
  leaveSession();
  screens.main();
}

function launch(cfg, hudOpts) {
  lastCfg = cfg; lastHudOpts = hudOpts;
  buildSession(cfg, hudOpts);
}

// ----------------------------------------------------------------- screens --
const screens = {
  main() {
    leaveSession();
    ui.clearPodiumStyle();
    ui.mainMenu({
      timeTrial: () => { app.state.mode = 'timetrial'; screens.team(); },
      grandPrix: () => { app.state.mode = 'gp'; screens.team(); },
      bests: () => ui.bests({ back: screens.main }),
      history: () => ui.history({ back: screens.main }),
      settings: () => ui.settings({
        back: screens.main,
        changed: () => {
          audio.applyVolumes();
          if (app.session) app.session.track.setRacingLineVisible(store.settings.racingLine);
        },
      }),
    });
  },

  team() {
    ui.teamSelect(app.state.teamId, {
      pick: (id) => {
        app.state.teamId = id;
        store.settings.lastTeam = id; save();
        screens.track();
      },
      back: screens.main,
    });
  },

  track() {
    ui.trackSelect({
      pick: (id) => {
        app.state.trackId = id;
        if (app.state.mode === 'timetrial') startTimeTrial();
        else screens.laps();
      },
      back: screens.team,
    });
  },

  laps() {
    ui.optionSelect('Step 3 · Race length', 'How many laps?', null, [
      { value: '3', label: '3 laps', meta: 'Sprint' },
      { value: '5', label: '5 laps', meta: 'Standard' },
      { value: '10', label: '10 laps', meta: 'Endurance' },
    ], {
      pick: (v) => { app.state.laps = +v; screens.difficulty(); },
      back: screens.track,
    });
  },

  difficulty() {
    ui.optionSelect('Step 4 · Difficulty', 'AI pace',
      'Applied uniformly to all 20 AI cars. No rubber-banding.', [
      { value: 'easy', label: 'Easy', meta: 'Relaxed pace' },
      { value: 'medium', label: 'Medium', meta: 'Competitive' },
      { value: 'hard', label: 'Hard', meta: 'On the limit' },
    ], {
      pick: (v) => { app.state.difficulty = v; screens.practiceIntro(); },
      back: screens.laps,
    });
  },

  practiceIntro() {
    ui.practiceIntro(trackById(app.state.trackId), {
      practice: startPractice,
      skip: () => screens.qualiIntro(),
    });
  },

  qualiIntro() {
    leaveSession();
    ui.qualiIntro(trackById(app.state.trackId), { go: startQualifying });
  },
};

// ---------------------------------------------------------------- launchers --
function startTimeTrial() {
  launch({
    mode: 'timetrial',
    trackDef: trackById(app.state.trackId),
    teamId: app.state.teamId,
  }, {});
}

function showTimeTrialResults() {
  const s = app.session;
  const data = {
    trackName: s.track.def.name,
    sessionBest: s.sessionBest,
    best: store.bestLaps[s.track.def.id] ?? null,
    previousBest: s.startingBest,
  };
  leaveSession();
  ui.timeTrialResults(data, { again: startTimeTrial, menu: screens.main });
}

function startPractice() {
  launch({
    mode: 'practice',
    trackDef: trackById(app.state.trackId),
    teamId: app.state.teamId,
  }, { showSkip: true });
}
document.getElementById('skip-btn').onclick = () => screens.qualiIntro();

function startQualifying() {
  launch({
    mode: 'qualifying',
    trackDef: trackById(app.state.trackId),
    teamId: app.state.teamId,
    difficulty: app.state.difficulty,
    onEvent: (ev, data) => {
      if (ev !== 'qualifying-done') return;
      app.state.qualiOrder = data.entries.map(e => ({ name: e.name, isPlayer: !!e.isPlayer }));
      ui.setHud(false);
      ui.qualiResults(data.entries, { go: startRace });
    },
  }, {});
}

function startRace() {
  launch({
    mode: 'race',
    trackDef: trackById(app.state.trackId),
    teamId: app.state.teamId,
    laps: app.state.laps,
    difficulty: app.state.difficulty,
    qualiOrder: app.state.qualiOrder,
    onEvent: (ev, data) => {
      if (ev !== 'race-done') return;
      const s = app.session;
      const me = data.results.find(r => r.isPlayer);
      recordGP({
        track: s.track.def.id, team: app.state.teamId, laps: app.state.laps,
        difficulty: app.state.difficulty, pos: me.pos, time: me.time,
      });
      const payload = {
        results: data.results, falseStart: data.falseStart,
        trackName: s.track.def.name, laps: app.state.laps,
        difficulty: app.state.difficulty, bestLap: s.sessionBest,
      };
      ui.setHud(false);
      ui.raceResults(payload, {
        go: () => (me.pos <= 3 ? showPodium(data.results) : screens.main()),
      });
    },
  }, { showPosition: true });
}

function showPodium(results) {
  const top3 = results.slice(0, 3).map(r => ({ name: r.name, team: r.team, teamName: r.teamName }));
  const sky = trackById(app.state.trackId).sky;
  leaveSession();
  app.podium = new PodiumScene(top3, sky);
  resize();
  ui.podiumOverlay(top3, { go: screens.main });
}

// -------------------------------------------------------------------- loop --
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (app.session) {
    app.session.update(dt, input);
    input.reset = false;
    if (!app.session.paused) ui.updateHud(app.session.hud());
    renderer.render(app.session.scene, app.session.camera);
  } else if (app.podium) {
    app.podium.update(dt);
    renderer.render(app.podium.scene, app.podium.camera);
  }
}

resize();
screens.main();
requestAnimationFrame(frame);
