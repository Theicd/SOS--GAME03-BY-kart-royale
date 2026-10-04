import { type Ctx, type System } from '../types';
import { session } from './Session';

const KEY = 'kr-name';
export const NAME_MAX = 12;

/** Arcade driver names for the bots; a fresh line-up is drawn for every session. */
const BOT_POOL = [
  'Blaze', 'Turbo', 'Nitro', 'Comet', 'Rocket', 'Viper', 'Jinx', 'Ziggy', 'Rex', 'Nova',
  'Bolt', 'Dash', 'Ace', 'Fang', 'Gizmo', 'Hex', 'Indy', 'Juno', 'Kiki', 'Loki',
  'Mako', 'Nemo', 'Ozzy', 'Pixel', 'Quake', 'Rusty', 'Sparky', 'Tango', 'Ultra', 'Vex',
  'Wasp', 'Xeno', 'Yoyo', 'Zap', 'Bandit', 'Cosmo', 'Diesel', 'Echo', 'Flash', 'Goose',
];

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
}

function load(): string {
  try { return cleanName(localStorage.getItem(KEY)); } catch { return ''; }
}

/**
 * Who is called what. The local player's name is saved on this device; bots
 * draw new names each session; online, the host's list is the truth for every
 * kart except your own.
 */
export class Names implements System {
  player = load();
  /** client: the host's names by kart index, or null when not in someone's room */
  remote: string[] | null = null;
  /** host: human peers' names by kart index */
  humans = new Map<number, string>();
  private bots: string[] = [];
  private botsGen = -1;

  init() {}

  setPlayer(v: string) {
    this.player = cleanName(v);
    try { localStorage.setItem(KEY, this.player); } catch { /* storage blocked */ }
  }

  /** This session's bot name for kart `i`. */
  bot(i: number): string {
    if (this.botsGen !== session.gen) {
      this.botsGen = session.gen;
      const pool = BOT_POOL.slice();
      for (let j = pool.length - 1; j > 0; j--) {
        const r = Math.floor(Math.random() * (j + 1));
        [pool[j], pool[r]] = [pool[r], pool[j]];
      }
      this.bots = pool;
    }
    return this.bots[i % this.bots.length];
  }

  /** Host: the full line-up by kart index, with `mine` as the host's own kart. */
  list(n: number, mine: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      out.push(i === mine ? this.player || this.bot(i) : this.humans.get(i) || this.bot(i));
    }
    return unique(out);
  }

  update(ctx: Ctx) {
    const race = ctx.race;
    const karts = race.karts;
    if (!karts.length) return;
    const remote = (race as unknown as { multiplayer?: boolean }).multiplayer ? this.remote : null;
    const mine = karts.findIndex((k) => k.isPlayer);
    const names = remote && remote.length === karts.length
      ? remote.map((n, i) => (i === mine && this.player ? this.player : n))
      : this.list(karts.length, mine);
    const fixed = unique(names);
    for (let i = 0; i < karts.length; i++) {
      if (karts[i].stats.name !== fixed[i]) karts[i].stats.name = fixed[i];
    }
  }
}

/** Session scores are keyed by name, so no two karts may share one. */
function unique(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    let v = n;
    for (let k = 2; seen.has(v.toLowerCase()); k++) v = `${n.slice(0, NAME_MAX - 1)}${k}`;
    seen.add(v.toLowerCase());
    return v;
  });
}

export const names = new Names();
