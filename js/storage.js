const KEY = 'formula01';

const DEFAULTS = {
  settings: { racingLine: true, engineVolume: 0.7, musicVolume: 0.5, lastTeam: 'mclaren' },
  bestLaps: {},        // trackId -> seconds
  gpHistory: [],       // most recent first
  bestTraces: {},      // trackId -> per-bucket split times for the delta panel
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const d = JSON.parse(raw);
    return {
      settings: { ...DEFAULTS.settings, ...(d.settings || {}) },
      bestLaps: d.bestLaps || {},
      gpHistory: Array.isArray(d.gpHistory) ? d.gpHistory : [],
      bestTraces: d.bestTraces || {},
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const store = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

export function recordLap(trackId, seconds) {
  const prev = store.bestLaps[trackId];
  if (prev == null || seconds < prev) {
    store.bestLaps[trackId] = seconds;
    save();
    return true;
  }
  return false;
}

export function recordGP(entry) {
  store.gpHistory.unshift({ ...entry, at: Date.now() });
  store.gpHistory = store.gpHistory.slice(0, 20);
  save();
}

export function formatTime(s) {
  if (s == null || !isFinite(s)) return '--:--.---';
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${neg ? '-' : ''}${m}:${sec < 10 ? '0' : ''}${sec.toFixed(3)}`;
}

export function formatDelta(s) {
  if (s == null || !isFinite(s)) return '';
  const sign = s >= 0 ? '+' : '-';
  return `${sign}${Math.abs(s).toFixed(3)}`;
}

export function formatGap(s) {
  if (s == null || !isFinite(s)) return '--';
  return `+${s.toFixed(3)}`;
}
