// Engine is synthesised with the Web Audio API (no samples): three detuned
// oscillators through a lowpass whose cutoff tracks throttle. Music is the
// track that shipped in the project folder.

const MUSIC_SRC = 'assets/audio/music.mp3';

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.started = false;
    this.music = new Audio(MUSIC_SRC);
    this.music.loop = true;
    this.music.volume = 0;
    this.musicWanted = false;
  }

  // Must be called from a user gesture.
  start() {
    if (this.started) return;
    this.started = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 3;
    this.filter.connect(this.master);

    this.oscs = [];
    const spec = [['sawtooth', 1, 0.5], ['square', 1.51, 0.22], ['sawtooth', 2.02, 0.28], ['sawtooth', 0.5, 0.3]];
    for (const [type, mult, gain] of spec) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g); g.connect(this.filter);
      o.start();
      this.oscs.push({ o, mult });
    }
    this.applyVolumes();
    if (this.musicWanted) this.playMusic();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  applyVolumes() {
    const s = this.settings;
    this.music.volume = Math.max(0, Math.min(1, s.musicVolume * 0.55));
    this.engineGain = s.engineVolume;
    if (!this.ctx) return;
  }

  playMusic() {
    this.musicWanted = true;
    this.applyVolumes();
    this.music.play().catch(() => {});
  }
  stopMusic() { this.musicWanted = false; this.music.pause(); }

  // rpm 0..1, load 0..1, active = a car is running
  updateEngine(rpm, load, active, dt = 0.016) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm * 235;
    for (const { o, mult } of this.oscs) {
      o.frequency.setTargetAtTime(f * mult, t, 0.03);
    }
    this.filter.frequency.setTargetAtTime(500 + rpm * 2600 + load * 1400, t, 0.05);
    const target = active ? (0.035 + 0.075 * load + 0.03 * rpm) * this.engineGain : 0;
    this.master.gain.setTargetAtTime(target, t, 0.06);
  }

  silence() { if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }

  // short synthesised blip for the start lights / UI
  beep(freq = 660, dur = 0.12, vol = 0.18) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol * this.settings.engineVolume, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }
}
