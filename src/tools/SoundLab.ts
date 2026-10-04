/**
 * Sound Lab - a standalone page (sounds.html) that plays every sound in the
 * game one by one, through the real Audio system, so each can be reviewed and
 * replaced in order. Not part of the game bundle.
 */
import { Audio } from '../audio/Audio';
import { mtof } from '../audio/Synth';
import { setSoundLevel, soundLevels, type SoundLevels } from '../audio/SoundPrefs';

type Lab = any;

interface Shot {
  name: string;
  what: string;
  when: string;
  code: string;
  play: (a: Lab, d: AudioNode) => void;
}

interface Group {
  title: string;
  shots: Shot[];
}

const GROUPS: Group[] = [
  {
    title: 'נהיגה - פגיעות, קפיצות, דריפט ובוסט',
    shots: [
      { name: 'קפיצה (הופ)', what: 'טון קצר עולה', when: 'כשהרכב קופץ קפיצה קטנה בתחילת דריפט', code: "hop()  ·  event 'hop'", play: (a, d) => a.hop(a.at(d, 'hop')) },
      { name: 'נחיתה רכה', what: 'חבטה עמומה קלה', when: 'נחיתה אחרי גבעה קטנה', code: "land(impact 0.2)  ·  event 'land'", play: (a, d) => a.land(d, 0.2) },
      { name: 'נחיתה חזקה', what: 'חבטה עמוקה עם רעש', when: 'נחיתה אחרי קפיצה גבוהה / מצוק', code: "land(impact 1)  ·  event 'land'", play: (a, d) => a.land(d, 1) },
      { name: 'מכה ברכב אחר', what: 'מכה רכה ועמומה', when: 'התנגשות רכב-ברכב', code: "impact(soft)  ·  event 'collide'", play: (a, d) => a.impact(a.at(d, 'bump'), 0.5, true) },
      { name: 'מכה בקיר / מכשול - קלה', what: 'מכת פח מתכתית קלה', when: 'שפשוף בקיר, גדר או מכשול', code: "impact(0.2, hard)  ·  event 'collide'", play: (a, d) => a.impact(a.at(d, 'wall'), 0.2, false) },
      { name: 'מכה בקיר / מכשול - חזקה', what: 'מכת פח מתכתית חזקה', when: 'כניסה חזיתית בקיר או במכשול', code: "impact(1, hard)  ·  event 'collide'", play: (a, d) => a.impact(a.at(d, 'wall'), 1, false) },
      { name: 'שפשוף צמיגים', what: 'רחש צמיג קצר', when: 'תחילת דריפט (לפני שיש ניצוצות)', code: "scrub()  ·  event 'drift-spark' tier 0", play: (a, d) => a.scrub(a.at(d, 'scrub')) },
      { name: 'ניצוץ דריפט - כחול', what: 'פינג קצר, רמה 1', when: 'דריפט מגיע לרמת טורבו 1', code: "chargeTier(1)  ·  event 'drift-spark'", play: (a, d) => a.chargeTier(d, 1, true) },
      { name: 'ניצוץ דריפט - כתום', what: 'פינג גבוה יותר, רמה 2', when: 'דריפט מגיע לרמת טורבו 2', code: "chargeTier(2)  ·  event 'drift-spark'", play: (a, d) => a.chargeTier(d, 2, true) },
      { name: 'ניצוץ דריפט - סגול', what: 'פינג הכי גבוה, רמה 3', when: 'דריפט מגיע לרמת טורבו 3', code: "chargeTier(3)  ·  event 'drift-spark'", play: (a, d) => a.chargeTier(d, 3, true) },
      { name: 'בוסט רמה 1', what: 'פיצוץ אוויר + המנוע והמוזיקה יורדים לרגע', when: 'שחרור דריפט כחול / פטרייה / משטח בוסט', code: "boost(1)  ·  event 'boost'", play: (a, d) => a.boost(a.at(d, 'boost'), 1, true) },
      { name: 'בוסט רמה 2', what: 'פיצוץ אוויר חזק יותר', when: 'שחרור דריפט כתום', code: "boost(2)  ·  event 'boost'", play: (a, d) => a.boost(a.at(d, 'boost'), 2, true) },
      { name: 'בוסט רמה 3', what: 'פיצוץ האוויר הכי חזק', when: 'שחרור דריפט סגול', code: "boost(3)  ·  event 'boost'", play: (a, d) => a.boost(a.at(d, 'boost'), 3, true) },
    ],
  },
  {
    title: 'קוביות תוספות ומטבעות',
    shots: [
      { name: 'מטבע', what: 'דינג כפול גבוה', when: 'איסוף מטבע, וגם הצליל הראשון באיסוף קובייה', code: "coin()  ·  event 'coin' / 'item-pickup'", play: (a, d) => a.coin(a.at(d, 'coin')) },
      { name: 'רולטת קובייה', what: 'וווש + תקתוקים שמאטים + אישור', when: 'השחקן אוסף קוביית תוספת (הגלגל מסתובב)', code: "roulette()  ·  event 'item-pickup'", play: (a, d) => { a.lastAt.delete('roulette'); a.roulette(a.at(d, 'roulette')); } },
      { name: 'רכב אחר אסף קובייה', what: 'ביפ קצר', when: 'יריב אוסף קוביית תוספת לידך', code: "blip(880)  ·  event 'item-pickup' (rival)", play: (a, d) => a.blip(a.at(d, 'rivalPick'), 880, 0.1, 0.12) },
    ],
  },
  {
    title: 'שימוש בפריטים (כשיורים / זורקים)',
    shots: [
      { name: 'יריית שריון ירוק', what: 'וווש + טון מסתובב', when: 'זריקת שריון ירוק', code: "shellFire(green)  ·  event 'item-use'", play: (a, d) => a.shellFire(a.at(d, 'shell'), false) },
      { name: 'יריית שריון אדום', what: 'כמו ירוק, גבוה יותר (מכוון)', when: 'זריקת שריון אדום', code: "shellFire(red)  ·  event 'item-use'", play: (a, d) => a.shellFire(a.at(d, 'shell'), true) },
      { name: 'הנחת בננה', what: '"פלופ" יורד', when: 'הנחת בננה על הכביש', code: "plop()  ·  event 'item-use'", play: (a, d) => a.plop(a.at(d, 'plop')) },
      { name: 'זריקת פצצה', what: 'וווש עולה', when: 'זריקת פצצה', code: "whoosh(up)  ·  event 'item-use'", play: (a, d) => a.whoosh(a.at(d, 'bombThrow'), 0.34, 0.32, true) },
      { name: 'כוכב', what: 'מנגינה עולה קצרה', when: 'הפעלת כוכב (חסינות)', code: "starJingle()  ·  event 'item-use'", play: (a, d) => a.starJingle(a.at(d, 'star')) },
      { name: 'ברק - הפעלה', what: 'זאפ חשמלי יורד', when: 'הפעלת ברק', code: "zap(fire)  ·  event 'item-use'", play: (a, d) => a.zap(a.at(d, 'zap'), true) },
      { name: 'פטרייה', what: 'ביפ משולש', when: 'שימוש בפטרייה / שלוש פטריות', code: "blip(660)  ·  event 'item-use'", play: (a, d) => a.blip(a.at(d, 'mushroom'), 660, 0.07, 0.16, 'triangle') },
      { name: 'פריט אחר', what: 'ביפ קצר', when: 'פריט בלי צליל משלו', code: "blip(520)  ·  event 'item-use'", play: (a, d) => a.blip(a.at(d, 'mushroom'), 520, 0.06, 0.1) },
    ],
  },
  {
    title: 'פגיעה מפריטים / מלכודות',
    shots: [
      { name: 'פגיעת פצצה', what: 'פיצוץ גדול', when: 'רכב נפגע מפצצה', code: "explosion(1)  ·  event 'hit'", play: (a, d) => a.explosion(a.at(d, 'explosion'), 1) },
      { name: 'פגיעת שריון', what: 'פיצוץ בינוני', when: 'רכב נפגע משריון ירוק/אדום', code: "explosion(0.62)  ·  event 'hit'", play: (a, d) => a.explosion(a.at(d, 'explosion'), 0.62) },
      { name: 'החלקה על בננה', what: 'סליידר קומי יורד + שפשוף', when: 'רכב עולה על בננה', code: "slip()  ·  event 'hit'", play: (a, d) => a.slip(a.at(d, 'slip')) },
      { name: 'פגיעת ברק', what: 'זאפ חשמלי עולה', when: 'רכב נפגע מברק', code: "zap(hit)  ·  event 'hit'", play: (a, d) => a.zap(a.at(d, 'zap'), false) },
      { name: 'פגיעה מרכב עם כוכב', what: 'מכת פח חזקה', when: 'רכב עם כוכב נוגע בך', code: "impact(0.8)  ·  event 'hit'", play: (a, d) => a.impact(a.at(d, 'wall'), 0.8, false) },
      { name: 'סחרחורת', what: 'טון רועד שדועך', when: 'אחרי כל פגיעה בשחקן (חוץ מכוכב)', code: "dizzy()  ·  event 'hit' (player)", play: (a, d) => { a.lastAt.delete('dizzy'); a.dizzy(a.at(d, 'dizzy')); } },
    ],
  },
  {
    title: 'מרוץ - ספירה, הקפה, סיום',
    shots: [
      { name: 'ספירה 3 / 2 / 1', what: 'ביפ נמוך', when: 'ספירה לאחור לפני הזינוק', code: "countdown(n>0)  ·  event 'countdown'", play: (a, d) => a.countdown(a.at(d, 'countdown'), 1) },
      { name: 'GO!', what: 'ביפ גבוה ארוך + וווש', when: 'הזינוק', code: "countdown(0)  ·  event 'countdown'", play: (a, d) => a.countdown(a.at(d, 'go'), 0) },
      { name: 'סיום הקפה', what: 'שלושה פעמונים', when: 'חציית קו סיום הקפה', code: "lapChime()  ·  event 'lap'", play: (a, d) => a.lapChime(a.at(d, 'lap'), false) },
      { name: 'הקפה אחרונה', what: 'פעמונים גבוהים יותר', when: 'כניסה להקפה האחרונה', code: "lapChime(final)  ·  event 'lap'", play: (a, d) => a.lapChime(a.at(d, 'lap'), true) },
      { name: 'סיום - פודיום', what: 'פנפרה שמחה', when: 'סיום במקום 1-3', code: "fanfare(good)  ·  event 'finish'", play: (a, d) => a.fanfare(a.at(d, 'finish'), true) },
      { name: 'סיום - מחוץ לפודיום', what: 'פנפרה עצובה', when: 'סיום במקום 4 ומטה', code: "fanfare(bad)  ·  event 'finish'", play: (a, d) => a.fanfare(a.at(d, 'finish'), false) },
      { name: 'פעמון (בסיס)', what: 'פעמון FM בודד', when: 'אבן הבניין של הפעמונים והפנפרה', code: 'bell()', play: (a, d) => a.bell(d, mtof(81), 0.8, 0.2, 0) },
    ],
  },
  {
    title: 'הודעות מרוץ ותפריטים',
    shots: [
      { name: 'חריקת זינוק (Burnout)', what: 'שפשוף + רעש מנוע עולה', when: 'גז על הגריד לפני הזינוק', code: "ui('burnout')", play: (a, d) => a.ui(d, 'burnout') },
      { name: 'חזרה למסלול', what: 'וווש + שני פעמונים', when: 'השחקן מוחזר למסלול (נפילה, טורנדו, תקוע)', code: "ui('respawn')", play: (a, d) => a.ui(d, 'respawn') },
      { name: 'יריב חזר למסלול', what: 'ביפ עולה קטן', when: 'רכב אחר מוחזר למסלול', code: "ui('respawn-rival')", play: (a, d) => a.ui(d, 'respawn-rival') },
      { name: 'כיוון הפוך', what: 'אזעקה דו-טונית', when: 'נוסעים נגד כיוון המסלול', code: "ui('wrong-way')", play: (a, d) => a.ui(d, 'wrong-way') },
      { name: 'כיוון תוקן', what: 'ביפ יורד רך', when: 'חזרה לכיוון הנכון', code: "ui('wrong-way-clear')", play: (a, d) => a.ui(d, 'wrong-way-clear') },
      { name: 'אישור / התחלה', what: 'שני ביפים עולים', when: 'לחיצה על כפתור בתפריט', code: "ui('confirm' / 'start')", play: (a, d) => a.ui(d, 'confirm') },
      { name: 'חזרה / ביטול', what: 'ביפ יורד', when: 'יציאה מתפריט', code: "ui('back' / 'cancel')", play: (a, d) => a.ui(d, 'back') },
      { name: 'השהיה', what: 'טון יורד', when: 'פתיחת תפריט השהיה', code: "ui('pause')", play: (a, d) => a.ui(d, 'pause') },
      { name: 'המשך', what: 'טון עולה', when: 'סגירת תפריט השהיה', code: "ui('resume')", play: (a, d) => a.ui(d, 'resume') },
      { name: 'מעבר בתפריט', what: 'טיק קצר', when: 'מעבר בין כפתורים', code: "ui('move' / 'hover')", play: (a, d) => a.ui(d, 'move') },
      { name: 'ביפ כללי (אין צליל ייעודי)', what: 'ביפ מרובע קצר', when: 'טורנדו, Frozen, Wind chill וכל הודעה בלי צליל משלה', code: "ui(default)", play: (a, d) => a.ui(d, 'tornado') },
    ],
  },
];

const TRACKS = ['golden-highway.mp3', 'golden-hour-run.mp3', 'outrun-sunset.mp3', 'sunburst-run.mp3', 'turbo-dash.mp3'];

const SURFACES: [string, number][] = [
  ['כביש', 0], ['עפר', 1], ['דשא', 2], ['חול', 3], ['משטח בוסט', 4], ['מחוץ למסלול', 5], ['מים', 6],
];
/** [tonal, formant, rough] per surface - mirrors SQUEAL_SURFACE in Audio.ts */
const SQUEAL: number[][] = [[1, 1, 0.8], [0.1, 0.62, 1.15], [0.05, 0.5, 1.1], [0.02, 1.9, 0.95], [1, 1.05, 0.8], [0.08, 0.7, 1.15], [0.03, 1.45, 1]];
const SIDECHAIN = [0.06, 0.26, 0.32, 0.4];
const TUNNEL_DRY = 0.7;

const app = document.getElementById('app')!;
const audio = new Audio() as Lab;
let s: Lab = null;

const live = {
  engine: false, rival: false, ambience: false, charge: false, tunnel: false,
  speed: 0.6, throttle: 1, brake: 0, boost: 0, air: false, stun: false,
  slip: 0, surface: 0, tier: 0, fill: 0.5,
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function toggle(label: string, key: 'engine' | 'rival' | 'ambience' | 'charge' | 'tunnel' | 'air' | 'stun', onChange?: () => void) {
  const b = el('button', 'off', '▶ ' + label);
  b.onclick = () => {
    live[key] = !live[key];
    b.className = live[key] ? '' : 'off';
    b.textContent = (live[key] ? '⏸ ' : '▶ ') + label;
    onChange?.();
  };
  return b;
}

function slider(label: string, key: 'speed' | 'throttle' | 'brake' | 'boost' | 'slip' | 'fill' | 'tier', min: number, max: number, step: number) {
  const l = el('label');
  l.append(label);
  const r = el('input');
  r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(live[key]);
  const o = el('output', '', String(live[key]));
  r.oninput = () => { live[key] = Number(r.value); o.textContent = r.value; };
  l.append(r, o);
  return l;
}

function liveCard(title: string, what: string, when: string, code: string, controls: HTMLElement[]) {
  const c = el('div', 'live');
  const head = el('div', 'row');
  head.append(el('span', 'name', title));
  c.append(head, el('div', 'what', what), el('div', 'when', '⏱ ' + when), el('div', 'code', code));
  const ctl = el('div', 'ctl');
  ctl.append(...controls);
  c.append(ctl);
  return c;
}

function applyTunnel() {
  if (!s) return;
  const now = s.now;
  s.glide(s.reverbReturn.gain, live.tunnel ? 0.8 : 0.5, 0.25, now);
  if (audio.engineSend) s.glide(audio.engineSend.gain, live.tunnel ? 0.22 : 0.025, 0.25, now);
  const side = live.charge && live.tier > 0 ? SIDECHAIN[live.tier] : 0;
  s.glide(s.engineSide.gain, (1 - side) * (live.tunnel ? TUNNEL_DRY : 1), 0.25, now);
}

function applyLevels() {
  const l = soundLevels();
  s?.setBusLevels(l.music, l.engine, l.sfx);
}

function buildLevels() {
  const head = document.querySelector('header')!;
  const names: [keyof SoundLevels, string][] = [['music', 'מוזיקה'], ['engine', 'מנועים'], ['sfx', 'אפקטים']];
  for (const [key, label] of names) {
    const l = el('label', 'hint');
    const r = el('input');
    r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.05'; r.value = String(soundLevels()[key]);
    const o = el('output', '', Math.round(soundLevels()[key] * 100) + '%');
    r.oninput = () => { setSoundLevel(key, Number(r.value)); o.textContent = Math.round(Number(r.value) * 100) + '%'; applyLevels(); };
    l.append(label + ' ', r, o);
    head.append(l);
  }
  head.append(el('span', 'hint', '(אותן הגדרות כמו במשחק)'));
}

function build() {
  let n = 0;
  buildLevels();

  app.append(el('h2', '', 'קולות רציפים (רקע) - מופעלים ומכוונים בזמן אמת'));
  const surfaceSel = el('select');
  for (const [name, v] of SURFACES) { const o = el('option', '', name); o.value = String(v); surfaceSel.append(o); }
  surfaceSel.onchange = () => { live.surface = Number(surfaceSel.value); };
  const surfLabel = el('label'); surfLabel.append('משטח', surfaceSel);

  app.append(liveCard(
    `#${++n}  מנוע השחקן + חריקת צמיגים`,
    'מנוע רציף עם 6 הילוכים, טורבו בבוסט, "בורבל" כששחררים גז במהירות. חריקת צמיגים לפי זווית ההחלקה והמשטח.',
    'כל הזמן בזמן נהיגה. בבוסט נשמעת שריקת טורבו. בפגיעה (stun) המנוע יורד.',
    'class KartVoice  ·  update() + setSqueal()',
    [toggle('מנוע', 'engine'), slider('מהירות', 'speed', 0, 1.3, 0.01), slider('גז', 'throttle', 0, 1, 0.01), slider('בלם', 'brake', 0, 1, 0.01),
      slider('בוסט', 'boost', 0, 1, 0.01), slider('החלקה (צמיגים)', 'slip', 0, 0.8, 0.01), surfLabel, toggle('באוויר', 'air'), toggle('נפגע (stun)', 'stun')],
  ));
  app.append(liveCard(
    `#${++n}  מנוע של רכב יריב (חולף סביבך)`,
    'אותו מנוע בגרסה פשוטה יותר, ממוקם בתלת-ממד, עם אפקט דופלר. כאן הוא מסתובב סביבך.',
    'כשרכבים אחרים קרובים אליך (עד 200 מ\').',
    'class KartVoice (rival)  ·  setPosition()',
    [toggle('יריב חולף', 'rival')],
  ));
  app.append(liveCard(
    `#${++n}  רעש כביש ורוח`,
    'זמזום אספלט, חריקת חצץ, רחש חול - מתחלפים לפי המשטח. רוח שמתגברת במהירות.',
    'כל הזמן בזמן נהיגה, רק לשחקן. משתמש במהירות, משטח ו"באוויר" מהכרטיס הראשון.',
    'class Ambience  ·  update()',
    [toggle('רעש כביש + רוח', 'ambience')],
  ));
  app.append(liveCard(
    `#${++n}  טון טעינת טורבו (דריפט)`,
    'טון שעולה בזמן דריפט. כל רמה (כחול/כתום/סגול) בצליל אחר. בזמן הטון המנוע והמוזיקה יורדים קצת.',
    'כל עוד מחזיקים דריפט.',
    'class DriftCharge  ·  set()',
    [toggle('טעינה', 'charge', applyTunnel), slider('רמה 0-3', 'tier', 0, 3, 1), slider('מילוי', 'fill', 0, 1, 0.01)],
  ));
  app.append(liveCard(
    `#${++n}  מנהרה (הד)`,
    'מגביר את ההד הכללי (0.5 ← 0.8) ואת ההד על המנוע, ומוריד את המנוע הישיר ל-70% - כדי שיהיה הד בלי עליית ווליום.',
    'כשהשחקן בתוך המנהרה (t 0.505-0.625). הפעל יחד עם המנוע כדי לשמוע.',
    'Audio.update()  ·  TUNNEL_DRY',
    [toggle('בתוך המנהרה', 'tunnel', applyTunnel)],
  ));

  for (const g of GROUPS) {
    app.append(el('h2', '', g.title));
    const grid = el('div', 'grid');
    for (const shot of g.shots) {
      const id = ++n;
      const c = el('div', 'card');
      const head = el('div', 'row');
      const btn = el('button', '', '▶');
      btn.onclick = () => {
        if (!s) return;
        try { shot.play(audio, s.sfx); } catch (err) { console.warn(err); }
        c.classList.add('played');
      };
      head.append(el('span', 'id', '#' + id), el('span', 'name', shot.name), btn);
      c.append(head, el('div', 'what', shot.what), el('div', 'when', '⏱ ' + shot.when), el('div', 'code', shot.code));
      grid.append(c);
    }
    app.append(grid);
  }

  app.append(el('h2', '', 'מוזיקה (קבצי MP3 בתיקייה public/music)'));
  const mg = el('div', 'grid');
  for (const t of TRACKS) {
    const id = ++n;
    const c = el('div', 'card');
    const head = el('div', 'row');
    head.append(el('span', 'id', '#' + id), el('span', 'name', t));
    const a = el('audio');
    a.controls = true; a.preload = 'none'; a.src = 'music/' + t;
    c.append(head, el('div', 'when', '⏱ אחד נבחר אקראית לתפריט ואחר למרוץ; בהקפה אחרונה מתנגן 4% מהר יותר'), a);
    mg.append(c);
  }
  app.append(mg);
}

let last = 0;
let rivalA = 0;
function frame(t: number) {
  requestAnimationFrame(frame);
  if (!s || s.ctx.state !== 'running') return;
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
  last = t;
  const now = s.now;
  const [player, rival] = audio.voices as Lab[];
  if (player) {
    if (live.engine) {
      const thr = live.stun ? 0.08 : live.boost > 0 ? 1 : live.throttle;
      player.update(dt, now, live.speed, thr, live.brake, live.air, live.boost, live.stun, 1, 1, 0.028);
      const sq = SQUEAL[live.surface];
      player.setSqueal(now, live.air ? 0 : live.slip, live.speed, sq[0], sq[1], sq[2], dt, 0.028);
    } else player.mute(now);
  }
  if (rival) {
    if (live.rival) {
      rivalA += dt * 0.9;
      rival.setPosition(Math.cos(rivalA) * 14, 0.4, Math.sin(rivalA) * 14, now);
      rival.update(dt, now, 0.85, 0.8, 0, false, 0, false, 0.72, 1 - Math.cos(rivalA) * 0.03, 0.07);
    } else rival.mute(now);
  }
  if (audio.ambience) {
    if (live.ambience) audio.ambience.update(now, live.speed, live.surface, live.air, 0.028);
    else audio.ambience.mute(now);
  }
  if (audio.charge) {
    if (live.charge) audio.charge.set(now, live.tier > 0, live.tier, live.fill, 0.03);
    else audio.charge.mute(now);
  }
  const side = live.charge && live.tier > 0 ? SIDECHAIN[live.tier] : 0;
  if (side !== audio.sidechain) {
    audio.sidechain = side;
    s.glide(s.engineSide.gain, (1 - side) * (live.tunnel ? TUNNEL_DRY : 1), 0.09, now);
  }
}

function start() {
  const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
  if (!AC) { alert('הדפדפן לא תומך ב-Web Audio'); return; }
  s = audio.bootWith(new AC(), 0.8);
  if (!s) { alert('מנוע הקול לא עלה'); return; }
  audio.music?.stop();
  applyLevels();
  s.ctx.resume().catch(() => {});
  audio.ensureVoices({ race: { karts: [{ isPlayer: true }, { isPlayer: false }] } });
  audio.tunnel = 0;
  document.getElementById('gate')!.remove();
  requestAnimationFrame(frame);
}

document.getElementById('start')!.onclick = start;
document.getElementById('stopAll')!.onclick = () => {
  for (const k of ['engine', 'rival', 'ambience', 'charge', 'tunnel', 'air', 'stun'] as const) live[k] = false;
  document.querySelectorAll<HTMLButtonElement>('.live button').forEach((b) => {
    b.className = 'off';
    b.textContent = b.textContent!.replace('⏸', '▶');
  });
  for (const a of document.querySelectorAll('audio')) a.pause();
  applyTunnel();
};

build();
