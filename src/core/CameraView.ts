/**
 * Chase or in-car view — shared by the camera rig, the touch chip and the
 * keyboard. Every visit opens in the car; the toggle lasts for the session.
 */
let cockpit = true;

const listeners = new Set<(on: boolean) => void>();

export function isCockpit(): boolean {
  return cockpit;
}

export function toggleCockpit(): void {
  cockpit = !cockpit;
  for (const fn of listeners) fn(cockpit);
}

export function onCockpitChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
