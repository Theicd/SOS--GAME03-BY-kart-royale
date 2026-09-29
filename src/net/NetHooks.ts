/**
 * The seam between the menus and network play, kept as a plain registry so
 * neither side imports the other.
 *
 *   requestStart — the player asked for a race. Returns true when the room
 *                  took the request over (the race will start via beginRace).
 *   beginRace    — installed by Menus: clear every menu flag and start a race
 *                  driving kart `index`.
 */
export const netHooks: {
  requestStart: (() => boolean) | null;
  beginRace: ((index: number) => void) | null;
} = {
  requestStart: null,
  beginRace: null,
};
