import { RaceState, type Ctx, type System } from '../types';

/** Rounds in one session; the fastest single lap across all of them takes the trophy. */
export const SESSION_ROUNDS = 5;

export interface SessionLap {
  name: string;
  time: number;
}

/** What the host mirrors to clients so a late joiner sees the same session. */
export interface SessionSnap {
  d: number;
  b: { n: string; t: number } | null;
}

/**
 * A session of SESSION_ROUNDS rounds. Anyone can join at any round: the
 * trophy goes to the fastest lap of the whole session, so a player arriving
 * for round 4 can still take it.
 */
export class Session implements System {
  /** rounds completed in this session */
  done = 0;
  /** fastest lap so far this session */
  best: SessionLap | null = null;
  /** round being raced (set when its countdown arms) */
  private playing = 1;
  private prevState: RaceState | null = null;
  private ctx: Ctx | null = null;

  init(ctx: Ctx) {
    this.ctx = ctx;
    ctx.bus.on((e) => {
      if (e.type !== 'lap' || e.time === undefined || !Number.isFinite(e.time)) return;
      const s = ctx.race.state;
      if (s !== RaceState.Racing && s !== RaceState.Finished) return;
      if (!this.best || e.time < this.best.time) this.best = { name: e.kart.stats.name, time: e.time };
    });
  }

  /** Round shown to the player: the one being raced, or the one just finished. */
  get round(): number {
    const s = this.ctx?.race.state;
    if (s === RaceState.Results) return Math.max(1, this.finished);
    return Math.min(this.playing, SESSION_ROUNDS);
  }

  /** Rounds completed, counting one whose results are on screen this frame. */
  private get finished(): number {
    const s = this.ctx?.race.state;
    return s === RaceState.Results ? Math.min(SESSION_ROUNDS, Math.max(this.done, this.playing)) : this.done;
  }

  /** The session is over and the trophy is decided. */
  get complete(): boolean {
    return this.finished >= SESSION_ROUNDS;
  }

  /** Start a fresh session if the last one is over. Safe to call repeatedly. */
  prepareNext() {
    if (!this.complete) return;
    this.done = 0;
    this.best = null;
    this.playing = 1;
  }

  update(ctx: Ctx) {
    const s = ctx.race.state;
    if (s === this.prevState) return;
    const prev = this.prevState;
    this.prevState = s;
    if (s === RaceState.Countdown && prev !== RaceState.Paused) {
      this.prepareNext();
      this.playing = this.done + 1;
    } else if (s === RaceState.Results) {
      this.done = Math.min(SESSION_ROUNDS, Math.max(this.done, this.playing));
    }
  }

  snapshot(): SessionSnap {
    return { d: this.done, b: this.best ? { n: this.best.name, t: this.best.time } : null };
  }

  /** Client: take the host's session as the truth. */
  adopt(m: unknown) {
    const o = m as Partial<SessionSnap> | null;
    if (!o || !Number.isInteger(o.d)) return;
    this.done = Math.max(0, Math.min(SESSION_ROUNDS, o.d as number));
    const b = o.b;
    this.best = b && typeof b.n === 'string' && Number.isFinite(b.t) && b.t > 0
      ? { name: b.n.slice(0, 16), time: b.t }
      : null;
    const s = this.ctx?.race.state;
    if (s !== RaceState.Results) {
      this.prepareNext();
      this.playing = this.done + 1;
    }
  }
}

export const session = new Session();
