/**
 * The seam between the menus and network play, kept as a plain registry so
 * neither side imports the other.
 *
 *   requestStart — the player asked for a race. Returns true when the room
 *                  took the request over (the race will start via beginRace).
 *   beginRace    — installed by Menus: clear every menu flag and start a race
 *                  driving kart `index`.
 *   booted       — the first real frame is on screen (shaders compiled). Until
 *                  then this machine cannot race, so the room must not start
 *                  a countdown for it.
 */
export const netHooks: {
  requestStart: (() => boolean) | null;
  beginRace: ((index: number) => void) | null;
  booted: boolean;
  /** Set while this player is queued behind a live race; `etaAt` 0 = no estimate yet. */
  wait: { etaAt: number; total: number; phase: 'race' | 'next' | 'lobby' } | null;
  /** A room nearby is about to start (epoch ms) — the title offers JOIN until then. */
  openRoom: { startsAt: number } | null;
  /** A room with a free seat is mid-race — a new visitor goes straight into its queue. */
  liveRace: boolean;
} = {
  requestStart: null,
  beginRace: null,
  booted: false,
  wait: null,
  openRoom: null,
  liveRace: false,
};
