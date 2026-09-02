import { TEAMS, teamById } from './teams.js';
import { TRACKS, trackById } from './tracks.js';
import { DIFFICULTY } from './ai.js';
import { store, save, formatTime, formatDelta } from './storage.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const liveryBar = (t) =>
  `<div class="livery"><i style="background:${hex(t.body)}"></i><i style="background:${hex(t.accent)}"></i><i style="background:${hex(t.trim)}"></i></div>`;

export class UI {
  constructor() {
    this.overlay = $('#overlay');
    this.hudEl = $('#hud');
    this.pauseEl = $('#pause');
    this.banner = $('#hud-banner');
    this.el = {
      pos: $('#pos-val'), posTotal: $('#pos-total'), gap: $('#gap-val'),
      posPanel: $('#hud-position'), lap: $('#lap-val'), spd: $('#spd-val'),
      record: $('#t-record'), current: $('#t-current'), delta: $('#t-delta'),
      recordLabel: $('#hud-timing .row:first-child span'),
      skip: $('#skip-btn'), minimap: $('#minimap'), lineKey: $('#line-key'),
    };
    this.map = null;
  }

  // --- minimap -------------------------------------------------------------

  // Project the circuit once per session; redrawing is then just a stroked path.
  setMinimap(track) {
    const c = this.el.minimap;
    const size = c.clientWidth || 168;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.pos) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 16;
    const s = Math.min((size - pad * 2) / Math.max(1, maxX - minX), (size - pad * 2) / Math.max(1, maxZ - minZ));
    const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
    // world -x is the driver's right and +z is ahead, so the map reads the same
    // way round as the view out of the cockpit
    const proj = (p) => [size / 2 - (p.x - mx) * s, size / 2 - (p.z - mz) * s];

    const path = new Path2D();
    track.pos.forEach((p, i) => {
      const [x, y] = proj(p);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    });
    path.closePath();

    const si = track.startIndex;
    const sp = proj(track.pos[si]);
    const r = track.right[si];
    const start = [proj({ x: track.pos[si].x - r.x * 9, z: track.pos[si].z - r.z * 9 }),
                   proj({ x: track.pos[si].x + r.x * 9, z: track.pos[si].z + r.z * 9 })];
    this.map = { ctx, size, proj, path, start, sp };
    this.drawMinimap(null, null);
  }

  drawMinimap(cars, player) {
    const m = this.map;
    if (!m) return;
    const { ctx, size, path } = m;
    ctx.clearRect(0, 0, size, size);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 7; ctx.stroke(path);
    ctx.strokeStyle = '#7d8797'; ctx.lineWidth = 3; ctx.stroke(path);

    ctx.strokeStyle = '#ffa519'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(...m.start[0]); ctx.lineTo(...m.start[1]); ctx.stroke();

    if (!cars) return;
    for (const c of cars) {
      if (c === player) continue;
      const [x, y] = m.proj(c.pos);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.284);
      ctx.fillStyle = '#' + c.team.body.toString(16).padStart(6, '0');
      ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
    }
    if (player) {
      const [x, y] = m.proj(player.pos);
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.284);
      ctx.fillStyle = '#' + player.team.body.toString(16).padStart(6, '0');
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }

  // --- plumbing ------------------------------------------------------------

  show(html, wire) {
    this.overlay.innerHTML = html;
    this.overlay.classList.add('on');
    this.overlay.scrollTop = 0;
    if (wire) wire(this.overlay);
  }
  hide() { this.overlay.classList.remove('on'); this.overlay.innerHTML = ''; }

  setHud(on, opts = {}) {
    this.hudEl.hidden = !on;
    this.el.posPanel.hidden = !opts.showPosition;
    this.el.skip.hidden = !opts.showSkip;
    this.el.minimap.hidden = !on;
    this.el.lineKey.hidden = !on || !opts.showLineKey;
    if (!on) this.map = null;
  }
  setPause(on) { this.pauseEl.hidden = !on; }
  setLoading(on) { $('#loading').hidden = !on; }

  updateHud(h) {
    this.el.spd.textContent = h.speed;
    this.el.lap.textContent = h.lap ?? '';
    this.el.current.textContent = formatTime(h.current);
    if (h.target != null) {
      this.el.recordLabel.textContent = h.targetName ? `TARGET · ${h.targetName}` : 'TARGET';
      this.el.record.textContent = formatTime(h.target);
    } else {
      this.el.recordLabel.textContent = 'RECORD';
      this.el.record.textContent = formatTime(h.record);
    }
    const d = this.el.delta;
    if (h.delta == null) { d.textContent = '--.---'; d.className = ''; }
    else { d.textContent = formatDelta(h.delta); d.className = h.delta <= 0 ? 'good' : 'bad'; }
    if (h.position) {
      const [p, t] = h.position.split('/');
      this.el.pos.textContent = p; this.el.posTotal.textContent = '/' + t;
      this.el.gap.textContent = h.gap == null ? '--' : '+' + h.gap.toFixed(2);
    }
    this.banner.textContent = h.message || '';
    this.banner.classList.toggle('on', !!h.message);
    if (h.cars) this.drawMinimap(h.cars, h.player);
  }

  // --- screens -------------------------------------------------------------

  mainMenu(h) {
    this.show(`
      <div class="panel narrow">
        <div class="title-wrap"><h1>Formula 0.1</h1><p>Low-poly arcade racing</p></div>
        <div class="stack">
          <button class="btn primary" data-a="tt">Time Trial</button>
          <button class="btn primary" data-a="gp">Grand Prix</button>
          <button class="btn" data-a="best">Personal Bests</button>
          <button class="btn" data-a="history">Race History</button>
          <button class="btn ghost" data-a="set">Settings</button>
        </div>
        <div class="controls" style="justify-content:center;margin-top:20px">
          <span><b class="kbd">W</b>/<b class="kbd">↑</b> throttle</span>
          <span><b class="kbd">S</b>/<b class="kbd">↓</b> brake</span>
          <span><b class="kbd">A</b><b class="kbd">D</b> steer</span>
          <span><b class="kbd">R</b> reset</span>
          <span><b class="kbd">Esc</b> pause</span>
        </div>
      </div>`, (r) => {
      $('[data-a=tt]', r).onclick = () => h.timeTrial();
      $('[data-a=gp]', r).onclick = () => h.grandPrix();
      $('[data-a=best]', r).onclick = () => h.bests();
      $('[data-a=history]', r).onclick = () => h.history();
      $('[data-a=set]', r).onclick = () => h.settings();
    });
  }

  teamSelect(sel, h) {
    this.show(`
      <div class="panel">
        <div class="eyebrow">Step 1 · Team</div>
        <h2>Choose your team</h2>
        <p class="sub">Liveries only — every car on the grid has identical performance.</p>
        <div class="grid teams">
          ${TEAMS.map(t => `
            <button class="card ${t.id === sel ? 'sel' : ''}" data-id="${t.id}">
              ${liveryBar(t)}
              <div class="name">${t.name}</div>
              <div class="meta">${t.drivers.join(' · ')}</div>
            </button>`).join('')}
        </div>
        <div class="foot"><button class="btn ghost small" data-a="back">‹ Back</button></div>
      </div>`, (r) => {
      $$('[data-id]', r).forEach(b => b.onclick = () => h.pick(b.dataset.id));
      $('[data-a=back]', r).onclick = () => h.back();
    });
  }

  trackSelect(h) {
    this.show(`
      <div class="panel">
        <div class="eyebrow">Step 2 · Circuit</div>
        <h2>Choose a circuit</h2>
        <div class="grid tracks">
          ${TRACKS.map(t => {
            const pb = store.bestLaps[t.id];
            return `<button class="card" data-id="${t.id}">
              <div class="name">${t.name}</div>
              <div class="meta">${t.country}</div>
              <div class="blurb">${t.blurb}</div>
              <div class="pb ${pb ? '' : 'none'}">${pb ? 'PB ' + formatTime(pb) : 'No lap set'}</div>
            </button>`;
          }).join('')}
        </div>
        <div class="foot"><button class="btn ghost small" data-a="back">‹ Back</button></div>
      </div>`, (r) => {
      $$('[data-id]', r).forEach(b => b.onclick = () => h.pick(b.dataset.id));
      $('[data-a=back]', r).onclick = () => h.back();
    });
  }

  optionSelect(step, title, sub, opts, h) {
    this.show(`
      <div class="panel narrow">
        <div class="eyebrow">${step}</div>
        <h2>${title}</h2>
        ${sub ? `<p class="sub">${sub}</p>` : ''}
        <div class="grid opts">
          ${opts.map(o => `<button class="card opt" data-v="${o.value}">
            <div class="name">${o.label}</div>
            ${o.meta ? `<div class="meta">${o.meta}</div>` : ''}
          </button>`).join('')}
        </div>
        <div class="foot"><button class="btn ghost small" data-a="back">‹ Back</button></div>
      </div>`, (r) => {
      $$('[data-v]', r).forEach(b => b.onclick = () => h.pick(b.dataset.v));
      $('[data-a=back]', r).onclick = () => h.back();
    });
  }

  practiceIntro(trackDef, h) {
    this.show(`
      <div class="panel narrow">
        <div class="eyebrow">Free Practice</div>
        <h2>${trackDef.name}</h2>
        <p class="sub">Empty track, no timing pressure. Learn the layout, then head to qualifying whenever you like.</p>
        <div class="stack">
          <button class="btn primary" data-a="go">Run Free Practice</button>
          <button class="btn" data-a="skip">Skip to Qualifying ›</button>
        </div>
      </div>`, (r) => {
      $('[data-a=go]', r).onclick = () => h.practice();
      $('[data-a=skip]', r).onclick = () => h.skip();
    });
  }

  qualiIntro(trackDef, h) {
    this.show(`
      <div class="panel narrow">
        <div class="eyebrow">Qualifying</div>
        <h2>One flying lap</h2>
        <p class="sub">You start rolling. Cross the line to arm your lap. The translucent ghost shows whoever holds the fastest time right now — it updates live as the AI set theirs.</p>
        <button class="btn primary" data-a="go">Go</button>
      </div>`, (r) => { $('[data-a=go]', r).onclick = () => h.go(); });
  }

  qualiResults(entries, h) {
    this.show(`
      <div class="panel">
        <div class="eyebrow">Qualifying Classification</div>
        <h2>Grid for the race</h2>
        <div class="scroll">${resultsTable(entries.map((e, i) => ({
          pos: i + 1, name: e.name, team: e.team, isPlayer: e.isPlayer,
          right: isFinite(e.time) ? formatTime(e.time) : 'NO TIME',
        })))}</div>
        <div class="foot">
          <span class="hint">You start P${entries.findIndex(e => e.isPlayer) + 1}</span>
          <button class="btn primary small" data-a="go">Go to the grid ›</button>
        </div>
      </div>`, (r) => { $('[data-a=go]', r).onclick = () => h.go(); });
  }

  raceResults(data, h) {
    const rows = data.results.map(r => ({
      pos: r.pos, name: r.name, team: r.team, isPlayer: r.isPlayer,
      right: r.pos === 1 ? formatTime(r.time)
        : (r.time != null && data.results[0].time != null ? '+' + (r.time - data.results[0].time).toFixed(3) : '--'),
    }));
    const me = data.results.find(r => r.isPlayer);
    this.show(`
      <div class="panel">
        <div class="eyebrow">Chequered Flag</div>
        <h2>P${me.pos} — ${me.teamName}</h2>
        <p class="sub">${data.trackName} · ${data.laps} laps · ${DIFFICULTY[data.difficulty].label}
          ${data.falseStart ? ' · <b style="color:var(--bad)">+5s jump-start penalty applied</b>' : ''}</p>
        <div class="scroll">${resultsTable(rows)}</div>
        <div class="foot">
          <span class="hint">Best lap ${formatTime(data.bestLap)}</span>
          <button class="btn primary small" data-a="go">Continue</button>
        </div>
      </div>`, (r) => { $('[data-a=go]', r).onclick = () => h.go(); });
  }

  podiumOverlay(top3, h) {
    this.show(`
      <div class="panel narrow" style="background:rgba(10,13,18,.82);text-align:center">
        <div class="eyebrow">Podium</div>
        <h2 style="margin-bottom:14px">Top three</h2>
        <div class="stack" style="gap:6px;margin-bottom:18px">
          ${top3.map((e, i) => `<div style="display:flex;gap:10px;align-items:center;justify-content:flex-start">
            <b style="width:22px;text-align:right;color:var(--accent)">${i + 1}</b>
            <span class="swatch" style="background:${hex(e.team.body)}"></span>
            <span style="flex:1;text-align:left">${e.name}</span>
            <span style="color:var(--dim);font-size:12px">${e.teamName || e.team.name}</span>
          </div>`).join('')}
        </div>
        <button class="btn primary" data-a="go">Continue</button>
      </div>`, (r) => { $('[data-a=go]', r).onclick = () => h.go(); });
    this.overlay.style.placeItems = 'end center';
    this.overlay.style.background = 'none';
    this.overlay.style.backdropFilter = 'none';
  }

  clearPodiumStyle() {
    this.overlay.style.placeItems = '';
    this.overlay.style.background = '';
    this.overlay.style.backdropFilter = '';
  }

  timeTrialResults(data, h) {
    this.show(`
      <div class="panel mid">
        <div class="eyebrow">Time Trial</div>
        <h2>${data.trackName}</h2>
        <div class="setting"><div class="label"><b>Session best</b></div>
          <div class="val" style="width:auto;font-size:16px;color:var(--text)">${formatTime(data.sessionBest)}</div></div>
        <div class="setting"><div class="label"><b>Personal best</b></div>
          <div class="val" style="width:auto;font-size:16px;color:#ffd23f">${formatTime(data.best)}</div></div>
        <div class="setting"><div class="label"><b>Delta to previous best</b>
          <span>${data.previousBest == null ? 'First time on this circuit' : ''}</span></div>
          <div class="val" style="width:auto;font-size:16px;color:${deltaColor(data)}">${sessionDelta(data)}</div></div>
        <div class="stack" style="margin-top:16px">
          <button class="btn primary" data-a="again">Drive again</button>
          <button class="btn ghost" data-a="menu">Main menu</button>
        </div>
      </div>`, (r) => {
      $('[data-a=again]', r).onclick = () => h.again();
      $('[data-a=menu]', r).onclick = () => h.menu();
    });
  }

  bests(h) {
    this.show(`
      <div class="panel">
        <div class="eyebrow">Time Trial</div>
        <h2>Personal bests</h2>
        <table class="results"><thead><tr><th></th><th>Circuit</th><th style="text-align:right">Best lap</th></tr></thead>
        <tbody>${TRACKS.map((t, i) => {
          const pb = store.bestLaps[t.id];
          return `<tr><td class="p">${i + 1}</td><td>${t.name}<div class="meta" style="color:var(--dim);font-size:12px">${t.country}</div></td>
            <td class="t" style="${pb ? 'color:#ffd23f' : 'color:var(--dim)'}">${pb ? formatTime(pb) : '—'}</td></tr>`;
        }).join('')}</tbody></table>
        <div class="foot">
          <button class="btn ghost small" data-a="clear">Clear all times</button>
          <button class="btn small" data-a="back">Back</button>
        </div>
      </div>`, (r) => {
      $('[data-a=back]', r).onclick = () => h.back();
      $('[data-a=clear]', r).onclick = () => {
        store.bestLaps = {}; store.bestTraces = {}; save(); this.bests(h);
      };
    });
  }

  history(h) {
    const rows = store.gpHistory;
    this.show(`
      <div class="panel">
        <div class="eyebrow">Grand Prix</div>
        <h2>Recent results</h2>
        ${rows.length ? `<div class="scroll"><table class="results">
          <thead><tr><th>Pos</th><th>Circuit</th><th>Laps</th><th>Difficulty</th><th style="text-align:right">Race time</th></tr></thead>
          <tbody>${rows.map(r => `<tr class="${r.pos === 1 ? 'me' : ''}">
            <td class="p">P${r.pos}</td>
            <td><span class="swatch" style="background:${hex(teamById(r.team).body)}"></span>${trackById(r.track).name}</td>
            <td>${r.laps}</td><td>${DIFFICULTY[r.difficulty]?.label || r.difficulty}</td>
            <td class="t">${formatTime(r.time)}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="sub">No Grand Prix results yet.</p>`}
        <div class="foot">
          <button class="btn ghost small" data-a="clear">Clear history</button>
          <button class="btn small" data-a="back">Back</button>
        </div>
      </div>`, (r) => {
      $('[data-a=back]', r).onclick = () => h.back();
      $('[data-a=clear]', r).onclick = () => { store.gpHistory = []; save(); this.history(h); };
    });
  }

  settings(h) {
    const s = store.settings;
    this.show(`
      <div class="panel mid">
        <div class="eyebrow">Settings</div>
        <h2>Options</h2>
        <div class="setting">
          <div class="label"><b>Racing line</b><span>Show the optimal path on track</span></div>
          <div class="toggle ${s.racingLine ? 'on' : ''}" data-a="line"></div>
        </div>
        <div class="setting">
          <div class="label"><b>Engine volume</b><span>Procedural engine + UI</span></div>
          <input type="range" min="0" max="100" value="${Math.round(s.engineVolume * 100)}" data-a="eng">
          <div class="val" data-v="eng">${Math.round(s.engineVolume * 100)}</div>
        </div>
        <div class="setting">
          <div class="label"><b>Music volume</b><span>Background track</span></div>
          <input type="range" min="0" max="100" value="${Math.round(s.musicVolume * 100)}" data-a="mus">
          <div class="val" data-v="mus">${Math.round(s.musicVolume * 100)}</div>
        </div>
        <div class="foot"><span class="hint">Saved automatically</span><button class="btn small" data-a="back">Back</button></div>
      </div>`, (r) => {
      const tog = $('[data-a=line]', r);
      tog.onclick = () => { s.racingLine = !s.racingLine; tog.classList.toggle('on', s.racingLine); save(); h.changed(); };
      for (const [key, prop] of [['eng', 'engineVolume'], ['mus', 'musicVolume']]) {
        const input = $(`input[data-a=${key}]`, r), val = $(`[data-v=${key}]`, r);
        input.oninput = () => {
          s[prop] = input.value / 100; val.textContent = input.value; save(); h.changed();
        };
      }
      $('[data-a=back]', r).onclick = () => h.back();
    });
  }
}

function sessionDelta(d) {
  if (d.previousBest == null || d.sessionBest == null) return '—';
  return formatDelta(d.sessionBest - d.previousBest);
}
function deltaColor(d) {
  if (d.previousBest == null || d.sessionBest == null) return 'var(--dim)';
  return d.sessionBest <= d.previousBest ? 'var(--good)' : 'var(--bad)';
}

function resultsTable(rows) {
  return `<table class="results">
    <thead><tr><th>Pos</th><th>Driver</th><th style="text-align:right">Time</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="${r.isPlayer ? 'me' : ''}">
      <td class="p">${r.pos}</td>
      <td><span class="swatch" style="background:${hex(r.team.body)}"></span>${r.name}
        <span style="color:var(--dim);font-size:12px"> · ${r.team.short}</span></td>
      <td class="t">${r.right}</td></tr>`).join('')}</tbody></table>`;
}
