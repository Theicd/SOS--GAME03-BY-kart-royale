/**
 * Menus — title, character select, pause and results.
 *
 * These are a *view* of `IRace.state`, never a driver of it: `state` is
 * readonly on the interface and the race director owns it. Where a menu needs
 * to act it calls the sanctioned commands (`start()` / `reset()` /
 * `setPaused()`), and where the race director does not model a state we hold
 * that screen locally instead of writing to it — `localTitle` / `localPause`
 * are the fallbacks, not the primary path.
 *
 * `?ui=title|select|pause|results` forces a screen, for capture and review.
 */
import { session, SESSION_ROUNDS, ROUND_POINTS, MEDALS } from '../game/Session';
import { names, NAME_MAX } from '../game/Names';
import { hiscores, type HiScore } from '../game/HighScores';
import { RaceState, type Ctx, type IKart, type KartStats } from '../types';
import { el, formatClock, ordinalSuffix, cssColor, clamp } from './uiUtil';
import { ControlsMenu } from './ControlsMenu';
import { SoundMenu } from './SoundMenu';
import { SettingsMenu } from './SettingsMenu';
import { openInstallDialog } from './Install';
import { MOOD, MOOD_NAMES, NIGHT, WINTER, type MoodId } from '../render/Mood';
import { netHooks } from '../net/NetHooks';
import { startNet, stopNet, watchRooms } from '../net/SosNet';

export type ScreenName = 'none' | 'title' | 'select' | 'pause' | 'results';

/** Pause between the rounds of a session before the next one rolls on its own. */
const NEXT_ROUND_MS = 10000;

/** Stat display ranges — the roster multipliers live inside these. */
const STAT_RANGE: [number, number] = [0.74, 1.24];
const STATS: { key: keyof KartStats; label: string }[] = [
  { key: 'topSpeedMul', label: 'Speed' },
  { key: 'accelMul', label: 'Accel' },
  { key: 'handlingMul', label: 'Handling' },
  { key: 'weightMul', label: 'Weight' },
];

const LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 400" class="kr-logo">
  <defs>
    <linearGradient id="krGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#fffdf2"/>
      <stop offset="32%"  stop-color="#ffe6a6"/>
      <stop offset="58%"  stop-color="#ffc23f"/>
      <stop offset="82%"  stop-color="#f28c14"/>
      <stop offset="100%" stop-color="#d1590c"/>
    </linearGradient>
    <linearGradient id="krCream" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="42%"  stop-color="#fdf1da"/>
      <stop offset="76%"  stop-color="#e8c79a"/>
      <stop offset="100%" stop-color="#bd9266"/>
    </linearGradient>
    <linearGradient id="krSwoosh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#ff7a3d" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#ff9a3d" stop-opacity="0.95"/>
      <stop offset="70%"  stop-color="#ffd05a" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#fff0c0" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="krBurst" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#ffd58a" stop-opacity="0.55"/>
      <stop offset="55%"  stop-color="#ff9a3d" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ff7a3d" stop-opacity="0"/>
    </radialGradient>
    <pattern id="krCheck" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="#f6efe0"/>
      <rect width="12" height="12" fill="#181425"/>
      <rect x="12" y="12" width="12" height="12" fill="#181425"/>
    </pattern>
    <!-- radial falloff so the sunburst dies away instead of hitting the
         viewBox edge and drawing a rectangle -->
    <radialGradient id="krFadeG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="30%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
    <mask id="krFade" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="400">
      <rect width="900" height="400" fill="url(#krFadeG)"/>
    </mask>
    <linearGradient id="krRibbonG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#000000"/>
      <stop offset="14%"  stop-color="#ffffff"/>
      <stop offset="86%"  stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
    <mask id="krRibbon" maskUnits="userSpaceOnUse" x="60" y="240" width="790" height="130">
      <rect x="60" y="240" width="790" height="130" fill="url(#krRibbonG)"/>
    </mask>
    <filter id="krDrop" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="9" stdDeviation="10" flood-color="#060a16" flood-opacity="0.62"/>
    </filter>
    <path id="krArc" d="M 196 224 Q 450 128 704 224" fill="none"/>
  </defs>

  BACKDROP

  <g filter="url(#krDrop)" transform="rotate(-2.4 450 210)">
    <!-- chequered banner, faded at both ends so it reads as a ribbon -->
    <g mask="url(#krRibbon)" opacity="0.7">
      <path d="M 104 292 L 800 266 L 795 320 L 99 346 Z" fill="url(#krCheck)"/>
      <path d="M 104 292 L 800 266 L 795 320 L 99 346 Z" fill="none" stroke="#181425" stroke-width="4.5"/>
    </g>

    <text class="kr-logo-wm" font-size="104" letter-spacing="10"
          fill="url(#krCream)" stroke="#181425" stroke-width="17"
          paint-order="stroke" stroke-linejoin="round">
      <textPath href="#krArc" startOffset="50%" text-anchor="middle">KART</textPath>
    </text>

    <text class="kr-logo-wm" x="450" y="322" font-size="152" letter-spacing="6"
          text-anchor="middle" fill="url(#krGold)" stroke="#181425" stroke-width="19"
          paint-order="stroke" stroke-linejoin="round"
          transform="skewX(-7) translate(39 0)">ROYALE</text>

    <path d="M 118 358 Q 450 386 786 344" fill="none" stroke="url(#krSwoosh)"
          stroke-width="11" stroke-linecap="round"/>
  </g>
</svg>`;

const MOON_SVG = `
  <defs>
    <radialGradient id="krMoonGlow" gradientUnits="userSpaceOnUse" cx="712" cy="104" r="420">
      <stop offset="0" stop-color="#dfe8ff" stop-opacity="0.55"/>
      <stop offset="0.22" stop-color="#8ea4ff" stop-opacity="0.22"/>
      <stop offset="0.6" stop-color="#3a4a8a" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#0b1330" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="krMoonDisc" cx="0.4" cy="0.38" r="0.65">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.7" stop-color="#e6edff"/>
      <stop offset="1" stop-color="#b4c3ec"/>
    </radialGradient>
  </defs>
  <g mask="url(#krFade)"><rect width="900" height="400" fill="url(#krMoonGlow)"/></g>
  <g fill="#eef3ff"><circle class="kr-moon-star" cx="40" cy="296" r="1.4" style="animation-delay:-0.63s"/><circle class="kr-moon-star" cx="638" cy="180" r="1.5" style="animation-delay:-2.26s"/><circle class="kr-moon-star" cx="659" cy="183" r="2.1" style="animation-delay:-1.91s"/><circle class="kr-moon-star" cx="710" cy="93" r="1.6" style="animation-delay:-2.12s"/><circle class="kr-moon-star" cx="612" cy="36" r="2.1" style="animation-delay:-1.40s"/><circle class="kr-moon-star" cx="796" cy="262" r="1.1" style="animation-delay:-1.54s"/><circle class="kr-moon-star" cx="797" cy="227" r="2.1" style="animation-delay:-1.73s"/><circle class="kr-moon-star" cx="788" cy="293" r="1.6" style="animation-delay:-1.01s"/><circle class="kr-moon-star" cx="726" cy="120" r="1.2" style="animation-delay:-0.89s"/><circle class="kr-moon-star" cx="391" cy="108" r="2.6" style="animation-delay:-1.67s"/><circle class="kr-moon-star" cx="638" cy="283" r="1.0" style="animation-delay:-0.82s"/><circle class="kr-moon-star" cx="500" cy="173" r="1.7" style="animation-delay:-0.58s"/><circle class="kr-moon-star" cx="785" cy="36" r="1.6" style="animation-delay:-1.03s"/><circle class="kr-moon-star" cx="585" cy="297" r="1.8" style="animation-delay:-0.50s"/><circle class="kr-moon-star" cx="373" cy="105" r="1.6" style="animation-delay:-1.27s"/><circle class="kr-moon-star" cx="313" cy="179" r="2.0" style="animation-delay:-0.70s"/><circle class="kr-moon-star" cx="783" cy="157" r="2.5" style="animation-delay:-1.91s"/><circle class="kr-moon-star" cx="560" cy="175" r="1.8" style="animation-delay:-2.07s"/><circle class="kr-moon-star" cx="810" cy="139" r="2.2" style="animation-delay:-0.75s"/><circle class="kr-moon-star" cx="521" cy="125" r="1.5" style="animation-delay:-1.17s"/><circle class="kr-moon-star" cx="692" cy="283" r="1.1" style="animation-delay:-2.46s"/><circle class="kr-moon-star" cx="104" cy="142" r="1.2" style="animation-delay:-0.23s"/><circle class="kr-moon-star" cx="857" cy="86" r="2.0" style="animation-delay:-0.43s"/><circle class="kr-moon-star" cx="415" cy="198" r="1.1" style="animation-delay:-2.77s"/><circle class="kr-moon-star" cx="765" cy="287" r="2.5" style="animation-delay:-2.72s"/><circle class="kr-moon-star" cx="664" cy="103" r="0.9" style="animation-delay:-0.74s"/><circle class="kr-moon-star" cx="102" cy="20" r="2.0" style="animation-delay:-0.69s"/><circle class="kr-moon-star" cx="648" cy="167" r="2.1" style="animation-delay:-0.71s"/><circle class="kr-moon-star" cx="763" cy="91" r="1.6" style="animation-delay:-2.68s"/><circle class="kr-moon-star" cx="137" cy="167" r="0.9" style="animation-delay:-2.74s"/><circle class="kr-moon-star" cx="562" cy="297" r="0.9" style="animation-delay:-2.70s"/><circle class="kr-moon-star" cx="194" cy="311" r="1.9" style="animation-delay:-2.04s"/><circle class="kr-moon-star" cx="258" cy="87" r="1.3" style="animation-delay:-1.69s"/><circle class="kr-moon-star" cx="83" cy="251" r="2.2" style="animation-delay:-2.14s"/></g>
  <g class="kr-moon">
    <circle cx="712" cy="104" r="50" fill="url(#krMoonDisc)"/>
    <circle cx="694" cy="92" r="9" fill="#9fb0dc" opacity="0.35"/>
    <circle cx="726" cy="120" r="12" fill="#9fb0dc" opacity="0.28"/>
    <circle cx="730" cy="86" r="5" fill="#9fb0dc" opacity="0.3"/>
  </g>`;

const MOOD_BLURB: Record<MoodId, string> = {
  sunset: 'Golden hour by the sea',
  winter: 'Overcast skies, cold light',
  night: 'Starry sky, moonlit sea',
};

function buildBackdrop() {
  if (WINTER) return STORM_SVG;
  if (NIGHT) return MOON_SVG;
  return `<g mask="url(#krFade)">
    <g class="kr-logo-rays" opacity="0.8">${buildRays()}</g>
  </g>
  <ellipse cx="450" cy="200" rx="420" ry="200" fill="url(#krBurst)"/>`;
}

const STORM_CLOUDS: [number, number, number, number][] = [
  [180, 190, 150, 62], [300, 150, 170, 74], [450, 130, 200, 82], [600, 150, 170, 74], [720, 190, 150, 62],
  [240, 245, 170, 56], [450, 235, 230, 66], [660, 245, 170, 56], [370, 190, 150, 60], [540, 190, 150, 60],
];

const STORM_SVG = `
  <defs>
    <radialGradient id="krCloudG" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#e6eef8" stop-opacity="0.8"/>
      <stop offset="60%" stop-color="#8797b0" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#3e4a60" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="krFlashG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#cfeaff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#cfeaff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="krColdG" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#132238" stop-opacity="0.85"/>
      <stop offset="65%" stop-color="#132238" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#132238" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="krCloudDark" cx="50%" cy="60%" r="60%">
      <stop offset="0%" stop-color="#2a3448" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#2a3448" stop-opacity="0"/>
    </radialGradient>
    <filter id="krCloudBlur" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="krBoltGlow" x="-50%" y="-20%" width="200%" height="140%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <ellipse cx="450" cy="200" rx="440" ry="200" fill="url(#krColdG)"/>
  <g mask="url(#krFade)">
    <ellipse class="kr-storm-flash" cx="260" cy="190" rx="260" ry="170" fill="url(#krFlashG)"/>
    <ellipse class="kr-storm-flash kr-storm-flash-2" cx="660" cy="180" rx="260" ry="170" fill="url(#krFlashG)"/>
    <g class="kr-storm-drift" filter="url(#krCloudBlur)">
      ${STORM_CLOUDS.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y + ry * 0.35}" rx="${rx}" ry="${ry * 0.8}" fill="url(#krCloudDark)"/>`).join('')}
      ${STORM_CLOUDS.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#krCloudG)"/>`).join('')}
    </g>
    <g fill="none" stroke="#eaf7ff" stroke-linejoin="round" stroke-linecap="round" filter="url(#krBoltGlow)">
      <path class="kr-bolt" stroke-width="4" d="M 262 70 L 238 138 L 262 142 L 226 214 L 250 218 L 208 300"/>
      <path class="kr-bolt" stroke-width="2.5" d="M 244 176 L 204 208 L 190 246"/>
      <path class="kr-bolt kr-bolt-2" stroke-width="4" d="M 652 60 L 676 128 L 652 134 L 694 204 L 668 210 L 716 296"/>
      <path class="kr-bolt kr-bolt-2" stroke-width="2.5" d="M 684 186 L 730 214 L 748 250"/>
    </g>
  </g>`;

function buildRays() {
  let s = '';
  for (let i = 0; i < 24; i += 2) {
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = ((i + 0.85) / 24) * Math.PI * 2;
    const R = 560;
    const x0 = 450 + Math.cos(a0) * R, y0 = 200 + Math.sin(a0) * R * 0.62;
    const x1 = 450 + Math.cos(a1) * R, y1 = 200 + Math.sin(a1) * R * 0.62;
    s += `<path d="M450 200 L${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="#ffbe62" opacity="0.11"/>`;
  }
  return s;
}

export class Menus {
  /** The screen currently shown — HUD reads this to decide how to fade out. */
  screen: ScreenName = 'none';
  /** True while a full-screen menu owns the frame (HUD hides entirely). */
  blocking = false;
  /**
   * Set by a tap on a blocking screen. Touch devices have no Enter key, and the
   * title screen's only affordance was a keyboard hint — so a tap anywhere on
   * the title, select or results screen counts as confirm.
   */
  private tapConfirm = false;

  private root: HTMLDivElement;
  private screens: Record<Exclude<ScreenName, 'none'>, HTMLDivElement>;
  private ctx!: Ctx;
  private forced: ScreenName | null = null;

  /** Local pause, used when the race director does not model RaceState.Paused. */
  private localPause = false;
  private localTitle = false;

  private selected = 0;
  private cards: HTMLDivElement[] = [];
  private buttons: { pause: HTMLDivElement[]; results: HTMLDivElement[] } = { pause: [], results: [] };
  private btnIndex = 0;

  private prevSteer = 0;
  private resultsBuilt = false;
  /** How many karts were classified when the board was last built. */
  private resultsFinished = -1;
  private resultsPending = true;
  /** session the win celebration last played for */
  private celebratedGen = -1;
  /** between rounds: countdown panel that replaces the results buttons */
  private nextHead!: HTMLSpanElement;
  private nextFill!: HTMLElement;
  private nextEta!: HTMLDivElement;
  private nextAt = 0;
  private nextFired = false;
  private finishTimes = new Map<number, number>();
  private lastRaceTime = 0;

  /** the controls screen — its own overlay, not one of the four `screens` */
  private controls: ControlsMenu;
  private sound: SoundMenu;
  private settings: SettingsMenu;
  /** title-screen copy follows the device actually in use; see `syncTouchCopy` */
  private titlePrompt!: HTMLDivElement;
  private titleHint!: HTMLDivElement;
  private titleGlyphs!: HTMLDivElement;
  private touchCopy: boolean | null = null;
  /** title: play-mode buttons; see `setOnline` */
  private playBtn!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private waitHead!: HTMLSpanElement;
  private waitBox!: HTMLDivElement;
  private waitSub!: HTMLDivElement;
  private joinLeft = -1;
  private autoJoined = false;
  private autoJoinUntil = 0;
  private waitFill!: HTMLElement;
  private waitEta!: HTMLDivElement;
  private online = false;

  private rosterEl!: HTMLDivElement;
  private standingsEl!: HTMLDivElement;
  /** the in-race running order, shown on the pause screen (see buildPause) */
  private pauseOrderEl!: HTMLDivElement;
  /** throttle on the pause board rebuild — it only changes when places do */
  private pauseOrderKey = '';
  private lapsEl!: HTMLDivElement;
  private resultTitle!: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'kr-screens', parent);
    // Sibling of `.kr-screens`, not a child: the tap-anywhere-confirm listener
    // below is on `this.root`, and a tap on a SETTING must not also start the
    // race. Its own listeners stop propagation before the touch pad sees it.
    this.controls = new ControlsMenu(parent);
    this.sound = new SoundMenu(parent);
    this.settings = new SettingsMenu(parent, this.controls);
    this.screens = {
      title: this.buildTitle(),
      select: this.buildSelect(),
      pause: this.buildPause(),
      results: this.buildResults(),
    };
    // one delegated listener rather than a handler per control
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.kr-btn')) this.ui('confirm');
      else if (t.closest('.kr-card')) this.ui('move');
    });

    // Tap-anywhere confirm. A real control that was tapped handles itself via
    // its own click handler, so those are excluded to avoid confirming twice.
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.blocking) return;
      // the title offers a choice of mode, so a stray tap must not pick one
      if (this.screen === 'title') return;
      const t = e.target as HTMLElement;
      if (t.closest('.kr-btn, .kr-card')) return;
      this.tapConfirm = true;
    });

    const forced = new URLSearchParams(location.search).get('ui');
    if (forced === 'title' || forced === 'select' || forced === 'pause' || forced === 'results') {
      this.forced = forced;
    }
  }

  init(ctx: Ctx) {
    this.ctx = ctx;
    netHooks.beginRace = (index) => this.beginRace(ctx, index);
    watchRooms();
    // finish times are not on IRace, so we stamp them off the bus ourselves
    ctx.bus.on((e) => {
      if (e.type === 'finish') this.finishTimes.set(e.kart.id, ctx.race.raceTime);
    });
    this.fillRoster(ctx);
    this.controls.attach(ctx);
    this.sound.attach(ctx);
    this.settings.attach(ctx);
    // `?online=1` opens straight into online mode — the entry a lobby page links to.
    if (new URLSearchParams(location.search).get('online') === '1') this.setOnline(true);
  }

  // ------------------------------------------------------------------ frame

  update(ctx: Ctx, _dt: number) {
    const race = ctx.race;
    const input = ctx.input.state;

    // A race reset rewinds the clock; drop stale results so they rebuild.
    if (race.raceTime < this.lastRaceTime - 0.25) {
      this.resultsBuilt = false;
      this.resultsFinished = -1;
      this.finishTimes.clear();
    }
    this.lastRaceTime = race.raceTime;

    // The title copy follows the device actually in use, and `input.touch` can
    // flip mid-session (the iPadOS lazy mount, or a keyboard being pressed on a
    // tablet). Cached on the value, so this is a compare per frame.
    this.syncTouchCopy(ctx.input.touch);
    this.syncWatch();

    // The controls screen owns input while it is up: it is a sibling overlay,
    // not one of the four screens, so nothing below it may act on a confirm.
    this.controls.update(ctx);
    if (this.controls.open || this.sound.open || this.settings.open) {
      this.tapConfirm = false;
      this.prevSteer = input.steer;
      return;
    }

    const inRace = race.state === RaceState.Racing || race.state === RaceState.Countdown;

    // Confirm is `itemPressed` — Enter / Space / E / gamepad face button — which
    // is what the on-screen hint actually promises. It used to read
    // `pausePressed`, i.e. Escape or P alone, so the title screen said "PRESS
    // ENTER TO START" and Enter did nothing at all.
    //
    // It is gated on a screen actually being up. Without that gate the same
    // keypress that fires a shell also opens the pause menu, because with no
    // screen showing `onConfirm` falls through to its pause branch.
    if (this.screen !== 'none') {
      if (input.itemPressed || this.tapConfirm) this.onConfirm(ctx, inRace);
    } else if (input.pausePressed && inRace) {
      this.localPause = true;
      this.ui('pause');
    }
    this.tapConfirm = false;

    // steer edges drive menu navigation on keyboard/gamepad
    const st = input.steer;
    if (st > 0.55 && this.prevSteer <= 0.55) this.nav(1);
    else if (st < -0.55 && this.prevSteer >= -0.55) this.nav(-1);
    this.prevSteer = st;

    let want: ScreenName;
    if (this.forced) want = this.forced;
    else if (race.state === RaceState.Menu || this.localTitle) want = this.selecting ? 'select' : 'title';
    else if (race.state === RaceState.Paused || this.localPause) want = 'pause';
    else if (race.state === RaceState.Finished || race.state === RaceState.Results) want = 'results';
    else want = 'none';

    // The board is not final the moment it appears. It goes up `RESULTS_DELAY`
    // after the *player* crosses, and on a three-lap race the field behind them
    // is still running for up to half a minute. Building it once meant a
    // winning player saw a classification frozen at their own crossing: every
    // row below them ordered by distance-on-track, printing a metre gap instead
    // of a finish time, and never corrected. Rebuild while anyone is still out
    // there — `finishedCount` only moves 7 more times, so this is a handful of
    // rebuilds, not a per-frame one.
    if (want === 'results') {
      const done = ctx.race.karts.reduce((n, k) => n + (k.finished ? 1 : 0), 0);
      if (!this.resultsBuilt || done !== this.resultsFinished || session.pending !== this.resultsPending) {
        this.resultsPending = session.pending;
        this.resultsFinished = done;
        this.fillResults(ctx);
      }
      this.syncNext(ctx);
    } else if (want === 'pause') {
      this.fillPauseOrder(ctx);
    }

    if (want !== this.screen) {
      if (this.screen !== 'none') this.screens[this.screen].classList.remove('on');
      if (want !== 'none') this.screens[want].classList.add('on');
      this.screen = want;
      this.btnIndex = 0;
      this.syncButtons();
    }
    this.blocking = want === 'title' || want === 'select' || want === 'results';

    // Inline, not stylesheet: the HUD layer sets `pointer-events: none` with
    // enough specificity that an appended `.kr-screen.on` rule loses, and a
    // blocking screen that cannot receive a tap is unstartable on a phone —
    // there is no Enter key to fall back to. Inline always wins, and reverting
    // to 'none' the moment the screen clears keeps the canvas clickable.
    const pe = this.blocking ? 'auto' : 'none';
    this.root.style.pointerEvents = pe;
    // Clear the OUTGOING screen too. This used to only ever set the incoming
    // one, so a screen that had been shown kept `pointer-events: auto` as an
    // inline style — which outranks any stylesheet — for the rest of the
    // session. Every `.kr-screen` stays displayed, so the title screen sat over
    // the race as a live, invisible pointer target from the first frame on.
    for (const name of Object.keys(this.screens) as ScreenName[]) {
      const el = this.screens[name];
      if (el) el.style.pointerEvents = name === want ? pe : 'none';
    }

    // Tell the touch layer a menu owns the screen. Without this the stick, the
    // drift/brake cluster and the item button stay drawn over every menu — the
    // results board shipped with a live DRIFT button on top of it and the item
    // button sitting across the TOTAL row. Driving controls over a screen you
    // cannot drive from are decoration at best and a mis-tap at worst.
    //
    // Signalled as an attribute rather than a direct call because `Menus` must
    // not depend on `TouchControls`: the controls mount lazily, and on a
    // browser that lies about being a desktop they may not exist yet when this
    // first runs. CSS applies retroactively; a method call would have to be
    // replayed. Same shape as the existing `html[data-touch]` HUD reflow.
    if (want === 'none') delete document.documentElement.dataset.menu;
    else document.documentElement.dataset.menu = want;
  }

  private selecting = false;

  // ------------------------------------------------------------------ input

  private nav(dir: number) {
    if (this.screen === 'select') {
      this.selected = (this.selected + dir + this.cards.length) % this.cards.length;
      this.syncCards();
    } else if (this.screen === 'pause' || this.screen === 'results') {
      const list = this.screen === 'pause' ? this.buttons.pause : this.buttons.results;
      this.btnIndex = (this.btnIndex + dir + list.length) % list.length;
      this.syncButtons();
    } else {
      return;
    }
    this.ui('move');
  }

  /**
   * Keyboard confirm routes through the same `click()` the mouse uses, so the
   * 'confirm' SFX is emitted once, by the delegated listener in the ctor.
   */
  private onConfirm(ctx: Ctx, inRace: boolean) {
    switch (this.screen) {
      case 'title':
        this.startRace(ctx);
        this.ui('confirm');
        return;
      case 'select':
        this.startRace(ctx);
        this.ui('confirm');
        return;
      case 'pause':
        this.buttons.pause[this.btnIndex]?.click();
        return;
      case 'results':
        this.buttons.results[this.btnIndex]?.click();
        return;
      default:
        if (inRace) { this.localPause = true; this.ui('pause'); }
    }
  }

  /** Menu SFX hook — the audio system listens for these on the bus. */
  private ui(name: string) {
    this.ctx?.bus.emit({ type: 'ui', name });
  }

  private startRace(ctx: Ctx) {
    this.setOnline(true);
    if (netHooks.requestStart?.()) return;
    const n = ctx.race.karts.length;
    this.beginRace(ctx, n > 0 ? Math.floor(Math.random() * n) : 0);
  }

  private beginRace(ctx: Ctx, index: number) {
    this.forced = null;
    this.localTitle = false;
    this.selecting = false;
    this.localPause = false;
    this.resultsBuilt = false;
    this.resultsFinished = -1;
    this.finishTimes.clear();
    this.selected = index;
    // Hand the choice over BEFORE resetting. This line is the whole point of
    // the select screen: without it `this.selected` only ever moved a CSS
    // highlight, and every race was driven in kart 0 whatever was clicked.
    ctx.race.selectKart(this.selected);
    ctx.race.reset();
  }

  // ------------------------------------------------------------------ build

  private makeScreen(cls: string) {
    const s = el('div', 'kr-screen ' + cls, this.root);
    el('div', 'kr-screen-in', s);
    return s;
  }

  private buildTitle() {
    const s = this.makeScreen('kr-s-title');
    this.titleEl = s;
    const inner = s.firstElementChild as HTMLDivElement;
    const wrap = el('div', 'kr-stage', inner);
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.innerHTML = LOGO_SVG.replace('BACKDROP', buildBackdrop());
    const ids = Object.keys(MOOD_NAMES) as MoodId[];
    const box = el('div', 'kr-track-box kr-track-' + MOOD, wrap);
    el('div', 'kr-track-label', box, 'Select map');
    const pick = el('div', 'kr-track', box);
    const prev = el('div', 'kr-track-arrow', pick, '\u2039');
    el('div', 'kr-track-name', pick, MOOD_NAMES[MOOD]);
    const next = el('div', 'kr-track-arrow', pick, '\u203A');
    const dots = el('div', 'kr-track-dots', box);
    for (const id of ids) el('i', id === MOOD ? 'on' : '', dots);
    const load = (id: MoodId) => {
      const url = new URL(location.href);
      if (id === 'sunset') url.searchParams.delete('map');
      else url.searchParams.set('map', id);
      location.replace(url.toString());
    };
    const go = (step: number) => (e: Event) => {
      e.stopPropagation();
      load(ids[(ids.indexOf(MOOD) + step + ids.length) % ids.length]);
    };
    prev.onclick = go(-1);
    next.onclick = go(1);
    for (const a of [prev, next]) a.onpointerdown = (e) => e.stopPropagation();
    // Built empty; `syncTouchCopy` fills it from `ctx.input.touch` every time
    // that flips. This used to run its OWN `matchMedia('(pointer: coarse)')`
    // probe once, in the constructor — which is exactly the check that fails on
    // the documented iPadOS "Request Desktop Website" case, where Safari claims
    // `pointer: fine` and `maxTouchPoints: 0`. `Input` already handles that with
    // a lazy capture-phase mount on the first real finger; the menu copy was
    // never brought along, so an iPad in desktop mode got on-screen controls and
    // the words "Press Enter to Start" above them.
    this.titlePrompt = el('div', 'kr-prompt', wrap);
    // driver name: saved on this device, shown on the board and in the session table
    const mode = el('div', 'kr-mode', wrap);
    const nameBox = el('label', 'kr-name', mode);
    el('span', 'kr-name-label', nameBox, 'Driver');
    const nameIn = el('input', 'kr-name-input', nameBox);
    nameIn.type = 'text';
    nameIn.maxLength = NAME_MAX;
    nameIn.placeholder = 'Your name';
    nameIn.autocomplete = 'off';
    nameIn.spellcheck = false;
    nameIn.value = names.player;
    nameIn.oninput = () => names.setPlayer(nameIn.value);
    nameIn.onblur = () => { nameIn.value = names.player; };
    for (const ev of ['pointerdown', 'click', 'touchstart', 'keyup'] as const) nameIn.addEventListener(ev, (e) => e.stopPropagation());
    nameIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') nameIn.blur();
    });
    this.playBtn = el('div', 'kr-btn kr-btn-mode kr-btn-online', mode, 'PLAY');
    this.playBtn.onclick = (e) => {
      e.stopPropagation();
      this.startRace(this.ctx);
    };
    const hsBtn = el('div', 'kr-btn kr-btn-hs kr-hs-corner', s, '\u{1F3C6} Scores');
    hsBtn.onpointerdown = (e) => e.stopPropagation();
    hsBtn.onclick = (e) => { e.stopPropagation(); this.showHiscores(s); };
    const wait = this.waitBox = el('div', 'kr-wait', wrap);
    const head = el('div', 'kr-wait-head', wait);
    el('span', 'kr-wait-dot', head);
    this.waitHead = el('span', '', head);
    this.waitSub = el('div', 'kr-wait-sub', wait);
    this.waitFill = el('i', '', el('div', 'kr-wait-bar', wait));
    this.waitEta = el('div', 'kr-wait-eta', wait);
    // every other map, so the original Sunset Bay is one tap away from the new ones too
    const fresh = ids.filter((id) => id !== MOOD);
    if (fresh.length) {
      const label = MOOD === 'sunset' ? (fresh.length > 1 ? 'New maps' : 'New map') : 'More maps';
      const drawer = el('div', 'kr-drawer', s);
      const tab = el('div', 'kr-drawer-tab', drawer);
      el('span', 'kr-drawer-dot', tab);
      el('span', 'kr-drawer-tab-txt', tab, label);
      const card = el('div', 'kr-drawer-card', drawer);
      const close = el('div', 'kr-drawer-close', card);
      close.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
      close.setAttribute('aria-label', 'Close');
      el('div', 'kr-drawer-tag', card, label);
      for (const id of fresh) {
        const item = el('div', 'kr-drawer-item kr-drawer-' + id, card);
        el('div', 'kr-drawer-name', item, MOOD_NAMES[id]);
        el('div', 'kr-drawer-sub', item, MOOD_BLURB[id]);
        const play = el('div', 'kr-btn kr-drawer-play', item, 'Play \u203A');
        play.onclick = () => load(id);
      }
      const setOpen = (open: boolean) => drawer.classList.toggle('open', open);
      drawer.onpointerdown = (e) => e.stopPropagation();
      drawer.onclick = (e) => e.stopPropagation();
      tab.onclick = () => setOpen(true);
      close.onclick = () => setOpen(false);
      if (MOOD === 'sunset') {
        let touched = false;
        drawer.addEventListener('pointerenter', () => { touched = true; });
        drawer.addEventListener('pointerdown', () => { touched = true; });
        setTimeout(() => setOpen(true), 900);
        setTimeout(() => { if (!touched) setOpen(false); }, 7900);
      }
    }
    const top = el('div', 'kr-topbar', s);
    const help = el('div', 'kr-topbar-help', top);
    this.titleGlyphs = el('div', 'kr-glyphs', help);
    this.titleHint = el('div', 'kr-hint', help);
    const dl = el('div', 'kr-gear kr-dl', top);
    dl.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';
    dl.title = 'Install game';
    dl.setAttribute('role', 'button');
    dl.setAttribute('aria-label', 'Install game');
    dl.onpointerdown = (e) => e.stopPropagation();
    dl.onclick = (e) => { e.stopPropagation(); openInstallDialog(); };
    const sbtn = el('div', 'kr-gear', top);
    sbtn.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    sbtn.title = 'Settings';
    sbtn.setAttribute('role', 'button');
    sbtn.setAttribute('aria-label', 'Settings');
    sbtn.onclick = (e) => { e.stopPropagation(); this.settings.show(); };
    const credit = el('a', 'kr-credit', s);
    credit.href = 'https://github.com/ryancampbell/kart-royale';
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.title = 'Original game by Ryan Campbell on GitHub';
    credit.setAttribute('aria-label', credit.title);
    credit.innerHTML = '<svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
    credit.onpointerdown = (e) => e.stopPropagation();
    credit.onclick = (e) => e.stopPropagation();
    this.syncTouchCopy(false);
    return s;
  }

  /**
   * DEFECT D6. The only touch onboarding was one line of `kr-hint` at
   * `clamp(9px, 1.4vmin, 18px)` — 1.4 vmin is 5.5 px on a 390-tall phone so it
   * clamped to 9 px — at 44% opacity: 1.5 mm of glyph, NAMING controls without
   * showing where any of them are, while the floating stick is invisible at
   * rest. A first-run player had no visual evidence a steering control existed.
   *
   * On touch that line is replaced by three miniature renderings of the ACTUAL
   * controls at their actual colours, each with one word beneath it at >= 14 px
   * and full opacity. Same information; nothing to read. The breathing ghost
   * stick in `TouchControls` is the other half of this, and it is on the frame
   * the player is looking at rather than on a screen they are leaving.
   */
  /**
   * Nothing touches the network until the player presses PLAY; from then on
   * every start is routed through the room (joined, or opened with AI rivals).
   */
  private setOnline(on: boolean) {
    if (on === this.online) return;
    this.online = on;
    if (on) startNet(this.ctx);
    else stopNet();
    this.syncPrompt();
  }

  /** Queued behind a live race: drop the logo, show the race and a live ETA. */
  private syncWatch() {
    // A room is mid-race with a free seat: queue for it straight away, no PLAY.
    if (!this.online && !this.autoJoined && this.screen === 'title' && netHooks.liveRace && !netHooks.openRoom) {
      this.autoJoined = true;
      this.autoJoinUntil = performance.now() + 15000;
      this.startRace(this.ctx);
    }
    if (netHooks.wait || this.screen !== 'title') this.autoJoinUntil = 0;
    const joining = this.autoJoinUntil > performance.now()
      ? { etaAt: 0, total: 60, phase: 'race' as const }
      : null;
    const w = this.screen === 'title' ? netHooks.wait ?? joining : null;
    const lobby = w?.phase === 'lobby';
    this.titleEl.classList.toggle('kr-watch', !!w && !lobby);
    this.titleEl.classList.toggle('kr-lobby', lobby);
    this.syncJoin();
    if (!w) return;
    this.waitBox.classList.toggle('lobby', lobby);
    this.waitHead.textContent = lobby ? 'Waiting for players'
      : w.phase === 'race' ? 'Live · race in progress' : 'Round over · next race soon';
    this.waitSub.textContent = lobby ? 'Others can still join — get ready!'
      : "You're in line — you race in the next round";
    if (!w.etaAt) {
      this.waitEta.textContent = 'Estimating time…';
      this.waitFill.style.width = '0%';
      return;
    }
    const left = Math.max(0, Math.round((w.etaAt - performance.now()) / 1000));
    this.waitEta.textContent = left <= 0 ? 'Starting…'
      : lobby ? `Race starts in ${left}s`
      : `Next race in ~${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    this.waitFill.style.width = `${Math.min(100, Math.max(0, (1 - left / w.total) * 100))}%`;
  }

  /** A lobby nearby is counting down: PLAY becomes "JOIN · Ns". */
  private syncJoin() {
    const r = this.online ? null : netHooks.openRoom;
    const left = r ? Math.max(0, Math.ceil((r.startsAt - Date.now()) / 1000)) : 0;
    if (left === this.joinLeft) return;
    this.joinLeft = left;
    this.playBtn.textContent = left ? `JOIN · ${left}s` : 'PLAY';
    this.playBtn.classList.toggle('kr-btn-join', !!left);
    if (left) this.titlePrompt.textContent = 'A race is about to start — join now!';
    else this.syncPrompt();
  }

  private syncPrompt() {
    this.titlePrompt.textContent = this.online
      ? 'Online — players join automatically'
      : this.touchCopy ? 'Tap PLAY to race' : 'Enter to play';
  }

  private syncTouchCopy(touch: boolean) {
    if (this.touchCopy === touch) return;
    this.touchCopy = touch;
    this.syncPrompt();
    if (touch) {
      this.titleGlyphs.innerHTML =
        '<div class="kr-gl"><span class="kr-gl-stick"><i></i><b></b></span>Steer</div>' +
        '<div class="kr-gl"><span class="kr-gl-drift">DRIFT</span>Slide</div>' +
        '<div class="kr-gl"><span class="kr-gl-item">+</span>Fire</div>';
      this.titleHint.innerHTML = '';
    } else {
      this.titleGlyphs.innerHTML = '';
      this.titleHint.innerHTML =
        '<b>&#8592;</b><b>&#8594;</b> steer &nbsp;&nbsp; <b>&#8593;</b> accelerate &nbsp;&nbsp; ' +
        '<b>Shift</b> drift &nbsp;&nbsp; <b>Space</b> item &nbsp;&nbsp; <b>C</b> camera &nbsp;&nbsp; <b>Esc</b> pause';
    }
  }

  private buildSelect() {
    const s = this.makeScreen('kr-s-select');
    const inner = s.firstElementChild as HTMLDivElement;
    const head = el('div', 'kr-stage', inner);
    el('div', 'kr-title kr-gold', head, 'Choose your racer');
    this.rosterEl = el('div', 'kr-roster kr-stage', inner);
    const go = el('div', 'kr-menu-list kr-stage', inner);
    const btn = el('div', 'kr-btn sel', go, 'Start race');
    btn.onclick = () => this.startRace(this.ctx);
    return s;
  }

  private fillRoster(ctx: Ctx) {
    const karts = ctx.race.karts;
    this.rosterEl.textContent = '';
    this.cards.length = 0;
    karts.forEach((k, i) => {
      const c = el('div', 'kr-card', this.rosterEl);
      const col = cssColor(k.stats.color);
      c.style.setProperty('--c', col);
      const chip = el('div', 'kr-card-chip', c);
      el('div', 'kr-card-init', chip, k.stats.name.charAt(0).toUpperCase());
      if (k.isPlayer) el('div', 'kr-card-you', c, 'You');
      el('div', 'kr-card-name', c, k.stats.name);
      const stats = el('div', 'kr-stats', c);
      for (const def of STATS) {
        const row = el('div', 'kr-stat', stats);
        el('span', undefined, row, def.label);
        const bar = el('div', 'kr-bar', row);
        const raw = k.stats[def.key] as number;
        const v = clamp((raw - STAT_RANGE[0]) / (STAT_RANGE[1] - STAT_RANGE[0]), 0.08, 1);
        const fill = el('i', undefined, bar);
        // staggered so the bars cascade rather than snapping in together
        fill.style.setProperty('--v', (v * 100).toFixed(1) + '%');
        fill.style.transitionDelay = (0.12 + i * 0.04 + STATS.indexOf(def) * 0.06).toFixed(2) + 's';
      }
      c.onclick = () => { this.selected = i; this.syncCards(); };
      this.cards.push(c);
    });
    this.selected = karts.findIndex((k) => k.isPlayer);
    if (this.selected < 0) this.selected = 0;
    this.syncCards();
  }

  private syncCards() {
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].classList.toggle('sel', i === this.selected);
    }
  }

  /**
   * Pause. ROUND 8: this screen now carries the full running order.
   *
   * The eight-driver order used to be a permanent 200x320 timing tower pinned
   * to the right-centre of the in-race HUD — the largest single element on
   * screen, sitting on the outside of every right-hand corner, occluding the
   * rivals it was describing. It belongs here and on the results screen, where
   * the race is stopped and eight rows are actually readable. Same rows, same
   * type, same rules as the results board: one standings object in the game.
   */
  private buildPause() {
    const s = this.makeScreen('kr-s-pause');
    const inner = s.firstElementChild as HTMLDivElement;
    const box = el('div', 'kr-stage', inner);
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.width = '100%';
    el('div', 'kr-pause-badge', box, 'Race suspended');
    el('div', 'kr-title kr-gold', box, 'Paused');

    const grid = el('div', 'kr-pause-grid', box);
    const left = el('div', undefined, grid);
    el('div', 'kr-order-title', left, 'Running order');
    this.pauseOrderEl = el('div', 'kr-standings', left);
    const right = el('div', undefined, grid) as HTMLDivElement;
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    right.style.justifyContent = 'center';
    right.style.height = '100%';
    const list = el('div', 'kr-menu-list', right);

    const resume = el('div', 'kr-btn', list, 'Resume');
    // Clearing `localPause` alone is not enough: on a real race the director
    // owns the pause and `race.state` is `Paused`, which keeps `want` pinned to
    // this screen no matter what the UI's own flag says. Resume has to tell the
    // director too, or the button does nothing — which is exactly what it did.
    resume.onclick = () => {
      this.localPause = false;
      this.forced = null;
      this.ctx?.race.setPaused(false);
    };
    // Reachable MID-RACE, deliberately. `setScheme` releases every pointer and
    // zeroes the command and never touches `IRace`, so a player who cannot
    // steer can fix that without abandoning the race they are in.
    const ctrl = el('div', 'kr-btn', list, 'Controls');
    ctrl.onclick = () => this.controls.show();
    const sound = el('div', 'kr-btn', list, 'Sound');
    sound.onclick = () => this.sound.show();
    const restart = el('div', 'kr-btn', list, 'Restart race');
    restart.onclick = () => { this.localPause = false; this.forced = null; this.startRace(this.ctx); };
    const quit = el('div', 'kr-btn', list, 'Quit to title');
    quit.onclick = () => {
      this.localPause = false;
      this.forced = null;
      this.localTitle = true;
      this.selecting = false;
      this.ctx.race.reset();
    };
    this.buttons.pause = [resume, ctrl, sound, restart, quit];
    return s;
  }

  private buildResults() {
    const s = this.makeScreen('kr-s-results');
    const inner = s.firstElementChild as HTMLDivElement;
    this.resultTitle = el('div', 'kr-title kr-gold kr-stage', inner, 'Race complete');
    const grid = el('div', 'kr-results-grid kr-stage', inner);
    this.standingsEl = el('div', 'kr-standings', grid);
    const right = el('div', undefined, grid) as HTMLDivElement;
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    this.lapsEl = el('div', 'kr-laps', right);

    // mid-session: a countdown to the next round instead of the two buttons
    const next = el('div', 'kr-wait lobby kr-next kr-stage', inner);
    const nh = el('div', 'kr-wait-head', next);
    el('span', 'kr-wait-dot', nh);
    this.nextHead = el('span', '', nh);
    this.nextFill = el('i', '', el('div', 'kr-wait-bar', next));
    this.nextEta = el('div', 'kr-wait-eta', next);

    const list = el('div', 'kr-menu-list kr-stage', inner);
    const again = el('div', 'kr-btn', list, 'Race again');
    again.onclick = () => this.startRace(this.ctx);
    const title = el('div', 'kr-btn', list, 'Back to title');
    title.onclick = () => { this.localTitle = true; this.selecting = false; this.forced = null; this.ctx.race.reset(); };
    this.buttons.results = [again, title];
    return s;
  }

  private syncButtons() {
    const list = this.screen === 'pause' ? this.buttons.pause
      : this.screen === 'results' ? this.buttons.results : null;
    for (const group of [this.buttons.pause, this.buttons.results]) {
      for (let i = 0; i < group.length; i++) {
        group[i].classList.toggle('sel', group === list && i === this.btnIndex);
      }
    }
  }

  /**
   * The running order, on the pause screen. Rebuilt only when the order (or
   * the lap the leader is on) actually changes — the pause screen is static
   * and a per-frame rebuild of eight rows would be eight allocations a frame
   * for nothing.
   */
  private fillPauseOrder(ctx: Ctx) {
    const race = ctx.race;
    const player = race.player;
    const order: IKart[] = race.standings.length ? race.standings : race.karts;

    let key = '';
    for (let i = 0; i < order.length; i++) key += order[i].id + ':' + order[i].lap + '|';
    if (key === this.pauseOrderKey) return;
    this.pauseOrderKey = key;

    // Rebuilt rows must not re-deal the entrance animation on every reorder.
    this.pauseOrderEl.classList.add('settled');
    this.pauseOrderEl.textContent = '';
    order.forEach((k, i) => {
      const row = el('div', 'kr-row' + (k === player ? ' you' : ''), this.pauseOrderEl);
      row.style.setProperty('--c', cssColor(k.stats.color));
      const p = el('div', 'kr-row-p', row);
      p.innerHTML = `${i + 1}<sup>${ordinalSuffix(i + 1)}</sup>`;
      el('div', 'kr-row-c', row);
      // Full names, never truncated: the roster's longest name is authored and
      // the row is sized for it. `text-overflow: ellipsis` on content whose
      // maximum length you control is the loudest "unfinished" tell there is,
      // and the old in-race tower shipped "BRAMB…" and "MARLO…" in all ten
      // review frames.
      el('div', 'kr-row-n', row, k.stats.name);
      el('div', 'kr-row-t', row, `Lap ${clamp(k.lap + 1, 1, race.totalLaps)}/${race.totalLaps}`);
    });
  }

  private fillResults(ctx: Ctx) {
    // Second and subsequent builds land on a board the player is already
    // reading; only the first one gets the staggered entrance.
    this.standingsEl.classList.toggle('settled', this.resultsBuilt);
    this.resultsBuilt = true;
    const race = ctx.race;
    const player = race.player;
    const order: IKart[] = race.standings.length ? race.standings : race.karts;

    const place = player ? player.place : 1;
    this.resultTitle.textContent = place === 1 ? 'Winner'
      : place <= 3 ? `Podium \u00b7 ${place}${ordinalSuffix(place)} place`
        : `${place}${ordinalSuffix(place)} place`;
    const lead = order[0];

    this.standingsEl.textContent = '';
    order.forEach((k, i) => {
      const row = el('div', 'kr-row kr-pts-on' + (k === player ? ' you' : '') + (i < 3 ? ` kr-podium kr-podium-${i + 1}` : ''), this.standingsEl);
      row.style.setProperty('--c', cssColor(k.stats.color));
      row.style.setProperty('--d', (0.14 + i * 0.055).toFixed(3) + 's');
      const p = el('div', 'kr-row-p', row);
      p.innerHTML = `${i + 1}<sup>${ordinalSuffix(i + 1)}</sup>`;
      el('div', 'kr-row-c', row);
      el('div', 'kr-row-n', row, k.stats.name);
      const t = this.finishTimes.get(k.id);
      const gap = lead ? Math.max(0, lead.raceDistance - k.raceDistance) : 0;
      el('div', 'kr-row-t', row, t !== undefined ? formatClock(t) : `+${Math.round(gap)} m`);
      // this round's medal and points, and the running session total
      const gain = ROUND_POINTS[i] ?? 0;
      const total = (session.score(k.stats.name)?.pts ?? 0) + (session.pending ? gain : 0);
      const sc = el('div', 'kr-row-s', row);
      el('b', undefined, sc, `${MEDALS[i] ?? ''} +${gain}`);
      el('em', undefined, sc, `${total} pts`);
    });

    // lap times + best-lap callout
    this.lapsEl.textContent = '';
    const laps = race.lapTimes;
    let best = -1;
    for (let i = 0; i < laps.length; i++) if (best < 0 || laps[i] < laps[best]) best = i;

    if (race.totalLaps > 1) {
      const callout = el('div', 'kr-best', this.lapsEl);
      el('b', undefined, callout, 'Best lap');
      el('em', undefined, callout, best >= 0 ? formatClock(laps[best], 3) : '—:—.———');
    }

    for (let i = 0; race.totalLaps > 1 && i < race.totalLaps; i++) {
      const line = el('div', 'kr-lapline' + (i === best ? ' best' : ''), this.lapsEl);
      el('b', undefined, line, `Lap ${i + 1}`);
      el('em', undefined, line, i < laps.length ? formatClock(laps[i], 3) : '—');
    }
    const total = el('div', 'kr-lapline kr-lapline-total', this.lapsEl);
    el('b', undefined, total, 'Total');
    el('em', undefined, total,
      formatClock(player ? (this.finishTimes.get(player.id) ?? race.raceTime) : race.raceTime, 3));

    // session: round counter, the lap to beat, and the trophy after the last round
    const sb = session.best;
    const round = el('div', 'kr-lapline', this.lapsEl);
    el('b', undefined, round, 'Round');
    el('em', undefined, round, `${session.round}/${SESSION_ROUNDS}`);
    const fast = el('div', 'kr-lapline best', this.lapsEl);
    el('b', undefined, fast, session.complete ? '\u{1F3C6} Champion' : 'Lap to beat');
    el('em', undefined, fast, sb ? `${sb.name} \u00b7 ${formatClock(sb.time, 3)}` : '-');
    if (session.complete && sb) this.resultTitle.textContent = `\u{1F3C6} ${sb.name} wins the session`;

    // session points table, top 5
    const table = session.table;
    if (table.length) {
      el('div', 'kr-pts-head', this.lapsEl).textContent = 'Session points';
      const grid = el('div', 'kr-pts-grid', this.lapsEl);
      table.slice(0, 6).forEach((s, i) => {
        const line = el('div', 'kr-pts-line' + (player && s.name === player.stats.name ? ' you' : ''), grid);
        const m = s.medals.map((c, j) => (c ? MEDALS[j] + (c > 1 ? '\u00d7' + c : '') : '')).filter(Boolean).join(' ');
        el('b', undefined, line, `${i + 1}. ${s.name} ${m}`);
        el('em', undefined, line, `${s.pts}`);
      });
    }

    if (session.complete && !session.pending && this.celebratedGen !== session.gen) {
      this.celebratedGen = session.gen;
      this.celebrate(ctx);
    }

    // last round: the arcade table, with this session's entry lit up
    if (session.complete) {
      const f = session.filed;
      const head = el('div', 'kr-pts-head kr-hs-head', this.lapsEl);
      head.textContent = f && f.rank >= 0 ? `\u2B50 New high score \u00b7 #${f.rank + 1}` : 'High scores';
      const grid = el('div', 'kr-pts-grid', this.lapsEl);
      hiscores.top(4).forEach((h, i) => this.hiscoreLine(grid, h, i, f?.at));
    }
  }

  /**
   * End of session: a slot machine that lands on what the player won - three
   * trophies for the champion, three golds for the points leader, otherwise
   * their best medal. Tap or wait and it clears off the results board.
   */
  private celebrate(ctx: Ctx) {
    const screen = this.screens.results;
    screen.querySelector('.kr-slot-veil')?.remove();
    const player = ctx.race.player;
    const me = player ? player.stats.name : '';
    const champ = session.best?.name ?? '';
    const table = session.table;
    const leader = table[0]?.name ?? '';
    const mine = table.find((s) => s.name === me);
    const TROPHY = '\u{1F3C6}', STAR = '\u2B50';
    let sym = STAR, head = 'Session over';
    if (me && me === champ) { sym = TROPHY; head = 'Jackpot! Fastest lap'; }
    else if (me && me === leader) { sym = MEDALS[0]; head = 'Points leader'; }
    else if (mine) {
      const j = mine.medals.findIndex((c) => c > 0);
      if (j >= 0) { sym = MEDALS[j]; head = 'Medal haul'; }
    }
    const pool = [TROPHY, MEDALS[0], MEDALS[1], MEDALS[2], STAR, '\u{1F3C1}', '\u{1F352}', '\u{1F48E}'];

    const veil = el('div', 'kr-slot-veil', screen);
    const box = el('div', 'kr-slot', veil);
    el('div', 'kr-slot-head', box, head);
    const reels = el('div', 'kr-slot-reels', box);
    for (let r = 0; r < 3; r++) {
      const reel = el('div', 'kr-slot-reel', reels);
      const strip = el('div', 'kr-slot-strip', reel);
      const n = 14 + r * 4;
      for (let i = 0; i < n; i++) el('span', undefined, strip, pool[Math.floor(Math.random() * pool.length)]);
      el('span', undefined, strip, sym);
      strip.style.setProperty('--n', String(n));
      strip.style.animationDuration = (1.1 + r * 0.4).toFixed(2) + 's';
    }
    el('div', 'kr-slot-win', box, champ ? `${TROPHY} ${champ} wins the session` : '');
    const f = session.filed;
    const line = mine ? `${me} \u00b7 ${mine.pts} pts` + (f && f.rank >= 0 ? ` \u00b7 high score #${f.rank + 1}` : '') : '';
    el('div', 'kr-slot-you', box, line);
    el('div', 'kr-slot-hint', box, 'Tap to continue');
    const coins = el('div', 'kr-slot-coins', veil);
    for (let i = 0; i < 26; i++) {
      const c = el('i', undefined, coins, '\u{1FA99}');
      c.style.left = (Math.random() * 100).toFixed(1) + '%';
      c.style.animationDelay = (2.2 + Math.random() * 1.4).toFixed(2) + 's';
      c.style.animationDuration = (1.4 + Math.random() * 1.2).toFixed(2) + 's';
    }
    ctx.bus.emit({ type: 'ui', name: 'jackpot' });
    const close = () => { veil.classList.add('out'); window.setTimeout(() => veil.remove(), 400); };
    const auto = window.setTimeout(close, 7000);
    veil.onpointerdown = (e) => e.stopPropagation();
    veil.onclick = (e) => { e.stopPropagation(); window.clearTimeout(auto); close(); };
  }

  /** Between rounds the results board counts down and rolls the next round itself. */
  private syncNext(ctx: Ctx) {
    const between = !session.complete;
    this.screens.results.classList.toggle('kr-between', between);
    if (!between) { this.nextAt = 0; return; }
    const round = Math.min(SESSION_ROUNDS, session.round + 1);
    if (ctx.race.state !== RaceState.Results) {
      this.nextAt = 0;
      this.nextHead.textContent = 'Waiting for the field';
      this.nextEta.textContent = '';
      this.nextFill.style.width = '0%';
      return;
    }
    const t = performance.now();
    if (!this.nextAt) { this.nextAt = t + NEXT_ROUND_MS; this.nextFired = false; }
    const left = Math.max(0, this.nextAt - t);
    this.nextHead.textContent = `Round ${round} of ${SESSION_ROUNDS}`;
    this.nextEta.textContent = left > 0 ? `Starts in ${Math.ceil(left / 1000)}s` : 'Starting\u2026';
    this.nextFill.style.width = `${Math.min(100, (1 - left / NEXT_ROUND_MS) * 100).toFixed(1)}%`;
    if (left <= 0 && !this.nextFired) { this.nextFired = true; this.startRace(ctx); }
  }

  private hiscoreLine(parent: HTMLElement, h: HiScore, i: number, mine?: number) {
    const line = el('div', 'kr-pts-line' + (h.at === mine ? ' you kr-hs-new' : ''), parent);
    const m = h.medals.map((c, j) => (c ? MEDALS[j] + (c > 1 ? '\u00d7' + c : '') : '')).filter(Boolean).join(' ');
    el('b', undefined, line, `${i + 1}. ${h.name} ${m}`);
    el('em', undefined, line, `${h.pts}`);
  }

  /** Title: the full arcade table in an overlay; any tap closes it. */
  private showHiscores(parent: HTMLElement) {
    const veil = el('div', 'kr-hs-veil', parent);
    const card = el('div', 'kr-hs-card', veil);
    el('div', 'kr-title kr-gold kr-hs-title', card, 'High scores');
    const list = el('div', 'kr-hs-list', card);
    hiscores.top().forEach((h, i) => {
      const row = el('div', 'kr-hs-row' + (i < 3 ? ` kr-hs-top${i + 1}` : ''), list);
      el('span', 'kr-hs-rank', row, `${i + 1}`);
      el('span', 'kr-hs-name', row, h.name);
      el('span', 'kr-hs-medals', row, h.medals.map((c, j) => (c ? MEDALS[j] + (c > 1 ? '\u00d7' + c : '') : '')).filter(Boolean).join(' '));
      el('span', 'kr-hs-lap', row, h.lap > 0 ? formatClock(h.lap, 3) : '');
      el('span', 'kr-hs-pts', row, `${h.pts}`);
    });
    el('div', 'kr-hs-hint', card, 'Tap to close');
    const close = (e: Event) => { e.stopPropagation(); veil.remove(); };
    veil.onclick = close;
    veil.onpointerdown = (e) => e.stopPropagation();
  }
}
