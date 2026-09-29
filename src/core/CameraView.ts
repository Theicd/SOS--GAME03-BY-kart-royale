/**
 * Chase or in-car view — the player's choice, shared by the camera rig, the
 * touch chip and the keyboard, and remembered across visits.
 */
const KEY = 'kr-cam';

let cockpit = false;
try { cockpit = localStorage.getItem(KEY) === 'cockpit'; } catch { /* storage blocked */ }

const listeners = new Set<(on: boolean) => void>();

export function isCockpit(): boolean {
  return cockpit;
}

export function toggleCockpit(): void {
  cockpit = !cockpit;
  try { localStorage.setItem(KEY, cockpit ? 'cockpit' : 'chase'); } catch { /* storage blocked */ }
  for (const fn of listeners) fn(cockpit);
}

export function onCockpitChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
