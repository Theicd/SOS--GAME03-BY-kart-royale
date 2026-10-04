/**
 * Arcade high-score table, kept on this device. One entry per finished
 * session: the player's session points, medals and best lap.
 */
const KEY = 'kr-hiscores';
export const HISCORE_SIZE = 10;

export interface HiScore {
  name: string;
  pts: number;
  /** gold, silver, bronze */
  medals: [number, number, number];
  /** best lap of the session, seconds, or 0 */
  lap: number;
  map: string;
  /** when it was set, ms since epoch - doubles as the entry's id */
  at: number;
}

/** A fresh cabinet is never empty: the house names to beat. */
const SEED: [string, number][] = [
  ['ACE', 44], ['MAX', 40], ['ZAP', 36], ['RUBY', 32], ['NEO', 28],
  ['KIT', 24], ['JET', 20], ['BOB', 16], ['SKY', 12], ['DOT', 8],
];

function seed(): HiScore[] {
  return SEED.map(([name, pts], i) => ({ name, pts, medals: [0, 0, 0], lap: 0, map: '', at: i + 1 }));
}

function valid(e: any): e is HiScore {
  return e && typeof e.name === 'string' && Number.isFinite(e.pts) && Array.isArray(e.medals) && Number.isFinite(e.at);
}

class HighScores {
  private list: HiScore[] = this.load();

  private load(): HiScore[] {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (Array.isArray(raw)) {
        const ok = raw.filter(valid).slice(0, HISCORE_SIZE);
        if (ok.length) return ok;
      }
    } catch { /* storage blocked or corrupt */ }
    return seed();
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.list)); } catch { /* storage blocked */ }
  }

  top(n = HISCORE_SIZE): HiScore[] {
    return this.list.slice(0, n);
  }

  /** Add a finished session. Returns the 0-based rank, or -1 if it did not make the table. */
  submit(e: HiScore): number {
    const rank = this.list.findIndex((x) => e.pts > x.pts || (e.pts === x.pts && e.medals[0] > x.medals[0]));
    const at = rank < 0 ? this.list.length : rank;
    if (at >= HISCORE_SIZE) return -1;
    this.list.splice(at, 0, e);
    this.list.length = Math.min(this.list.length, HISCORE_SIZE);
    this.save();
    return at;
  }
}

export const hiscores = new HighScores();
