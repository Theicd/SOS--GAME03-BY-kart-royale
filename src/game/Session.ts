import { RaceState, type Ctx, type System } from '../types';
import { MOOD } from '../render/Mood';
import { hiscores } from './HighScores';

/** Rounds in one session; the fastest single lap across all of them takes the trophy. */
export const SESSION_ROUNDS = 5;

/** Points by finishing place each round (1st..8th). */
export const ROUND_POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
export const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

/** One driver's session tally. */
export interface SessionScore {
  name: string;
  pts: number;
  /** gold, silver, bronze */
  medals: [number, number, number];
}

export interface SessionLap {
  name: string;
  time: number;
}

/** What the host mirrors to clients so a late joiner sees the same session. */
export interface SessionSnap {
  d: number;
  b: { n: string; t: number } | null;
  /** last round already scored */
  a?: number;
  /** [name, points, gold, silver, bronze] */
  p?: [string, number, number, number, number][];
}

/**
 * A session of SESSION_ROUNDS rounds. Anyone can join at any round: the
 * trophy goes to the fastest lap of the whole session, so a player arriving
 * for round 4 can still take it.
 */
export class Session implements System {
  /** rounds completed in this session */
  done = 0;
  /** bumps every time a fresh session starts (bot names re-roll on it) */
  gen = 0;
  /** fastest lap so far this session */
  best: SessionLap | null = null;
  /** round being raced (set when its countdown arms) */
  private playing = 1;
  private prevState: RaceState | null = null;
  /** driver tallies, keyed by name */
  private scores = new Map<string, SessionScore>();
  /** last round whose points were handed out */
  private scored = 0;
  /** this player's best lap of the session, seconds */
  private mineBest = 0;
  /** session the high-score table was last written for */
  private filedGen = -1;
  /** where the finished session landed on the high-score table: entry id and rank, or null */
  filed: { at: number; rank: number } | null = null;
  private ctx: Ctx | null = null;

  init(ctx: Ctx) {
    this.ctx = ctx;
    ctx.bus.on((e) => {
      if (e.type !== 'lap' || e.time === undefined || !Number.isFinite(e.time)) return;
      const s = ctx.race.state;
      if (s !== RaceState.Racing && s !== RaceState.Finished) return;
      if (!this.best || e.time < this.best.time) this.best = { name: e.kart.stats.name, time: e.time };
      if (e.kart.isPlayer && (!this.mineBest || e.time < this.mineBest)) this.mineBest = e.time;
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
    this.scores.clear();
    this.scored = 0;
    this.gen++;
    this.mineBest = 0;
    this.filed = null;
  }

  /** Once the last round is scored, put the player's session on the high-score table. */
  private file() {
    if (this.scored < SESSION_ROUNDS || this.filedGen === this.gen) return;
    const player = this.ctx?.race.player;
    const s = player ? this.scores.get(player.stats.name) : undefined;
    if (!player || !s) return;
    this.filedGen = this.gen;
    const at = Date.now();
    const rank = hiscores.submit({ name: s.name, pts: s.pts, medals: [...s.medals], lap: this.mineBest, map: MOOD, at });
    this.filed = { at, rank };
  }

  /** True while the round on screen has not been added to the tallies yet. */
  get pending(): boolean {
    return this.scored < this.playing;
  }

  score(name: string): SessionScore | undefined {
    return this.scores.get(name);
  }

  /** Tallies, best first: points, then golds, silvers, bronzes. */
  get table(): SessionScore[] {
    return [...this.scores.values()].sort((x, y) =>
      y.pts - x.pts || y.medals[0] - x.medals[0] || y.medals[1] - x.medals[1] || y.medals[2] - x.medals[2]);
  }

  /** Hand out the finished round's points and medals, once. */
  private settle() {
    const race = this.ctx?.race;
    if (!race || race.state !== RaceState.Results || !this.pending) return;
    const order = race.standings.length ? race.standings : race.karts;
    if (!order.length) return;
    this.scored = this.playing;
    order.forEach((k, i) => {
      const name = k.stats.name;
      let s = this.scores.get(name);
      if (!s) { s = { name, pts: 0, medals: [0, 0, 0] }; this.scores.set(name, s); }
      s.pts += ROUND_POINTS[i] ?? 0;
      if (i < 3) s.medals[i]++;
    });
    this.file();
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
      this.settle();
    }
  }

  snapshot(): SessionSnap {
    this.settle();
    return {
      d: this.done,
      b: this.best ? { n: this.best.name, t: this.best.time } : null,
      a: this.scored,
      p: [...this.scores.values()].map((s) => [s.name, s.pts, s.medals[0], s.medals[1], s.medals[2]]),
    };
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
    if (Array.isArray(o.p)) {
      this.scores.clear();
      for (const r of o.p.slice(0, 16)) {
        if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
        const n = (i: number) => Math.max(0, Math.min(999, Math.floor(Number(r[i]) || 0)));
        const name = r[0].slice(0, 16);
        this.scores.set(name, { name, pts: n(1), medals: [n(2), n(3), n(4)] });
      }
    }
    if (Number.isInteger(o.a)) this.scored = Math.max(0, Math.min(SESSION_ROUNDS, o.a as number));
    this.file();
    const s = this.ctx?.race.state;
    if (s !== RaceState.Results) {
      this.prepareNext();
      this.playing = this.done + 1;
    }
  }
}

export const session = new Session();
