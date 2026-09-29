/**
 * Player volume per bus — music, engines, effects — each 0..1 on top of the
 * mix's own levels. Saved on this device; `version` lets the audio system poll
 * for a change with one integer compare a frame.
 */
const KEY = 'kr-sound';

export interface SoundLevels {
  music: number;
  engine: number;
  sfx: number;
}

const levels: SoundLevels = { music: 1, engine: 1, sfx: 1 };
let ver = 0;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved === 'object') {
    for (const k of ['music', 'engine', 'sfx'] as const) {
      const v = Number(saved[k]);
      if (Number.isFinite(v)) levels[k] = Math.min(1, Math.max(0, v));
    }
  }
} catch { /* storage blocked or corrupt */ }

export function soundLevels(): Readonly<SoundLevels> {
  return levels;
}

export function soundVersion(): number {
  return ver;
}

export function setSoundLevel(key: keyof SoundLevels, v: number): void {
  levels[key] = Math.min(1, Math.max(0, v));
  ver++;
  try { localStorage.setItem(KEY, JSON.stringify(levels)); } catch { /* storage blocked */ }
}
