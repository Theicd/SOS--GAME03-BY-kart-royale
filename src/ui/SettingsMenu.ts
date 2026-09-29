/**
 * Settings — graphics, sound and controls behind one title-screen button.
 * Same sheet styling as the controls screen (`kc-*`) so the overlays read as
 * one family; the controls screen itself still owns the scheme picker and its
 * live preview, and is opened from here.
 */
import { Quality, type Ctx } from '../types';
import { QUALITY_KEY } from '../core/Settings';
import type { ControlsMenu } from './ControlsMenu';
import { buildSoundRows } from './SoundMenu';
import { el } from './uiUtil';
import { MOOD, MOOD_KEY, MOOD_NAMES, type MoodId } from '../render/Mood';

const QUALITIES = [
  ['lite', 'Lite'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
] as const;

export class SettingsMenu {
  open = false;

  private root: HTMLDivElement;
  private ctx: Ctx | null = null;
  private qualityOpts: HTMLElement[] = [];
  private syncSound: () => void;

  constructor(parent: HTMLElement, private controls: ControlsMenu) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('div', 'kc-root kst-root', parent);
    const head = el('div', 'kc-head', this.root);
    el('div', 'kc-title', head, 'Settings');
    el('div', 'ks-spacer', head);
    const done = el('div', 'kc-done', head, 'Done');
    done.onclick = () => this.close();

    const body = el('div', 'kc-body kst-body', this.root);

    const map = this.section(body, 'Map');
    const mseg = el('div', 'kc-seg kst-seg', map);
    for (const id of Object.keys(MOOD_NAMES) as MoodId[]) {
      const b = el('div', 'kc-opt' + (id === MOOD ? ' sel' : ''), mseg, MOOD_NAMES[id]);
      b.onclick = () => {
        if (id === MOOD) return;
        try { localStorage.setItem(MOOD_KEY, id); } catch { /* storage blocked */ }
        const url = new URL(location.href);
        url.searchParams.delete('map');
        location.replace(url.toString());
      };
    }
    el('div', 'kst-note', map, 'Same circuit, different weather · the game reloads to apply');

    const gfx = this.section(body, 'Graphics');
    const seg = el('div', 'kc-seg kst-seg', gfx);
    for (const [value, label] of QUALITIES) {
      const b = el('div', 'kc-opt', seg, label);
      b.dataset.q = value;
      // Settings are baked into textures and shaders at boot, so a change needs a reload.
      b.onclick = () => {
        if (b.classList.contains('sel')) return;
        try { localStorage.setItem(QUALITY_KEY, value); } catch { /* storage blocked */ }
        const url = new URL(location.href);
        url.searchParams.delete('quality');
        location.replace(url.toString());
      };
      this.qualityOpts.push(b);
    }
    el('div', 'kst-note', gfx, 'Lite runs smoothest on phones · the game reloads to apply');

    const snd = this.section(body, 'Sound');
    this.syncSound = buildSoundRows(snd, () => this.close());

    const ctl = this.section(body, 'Controls');
    const row = el('div', 'kst-ctl', ctl);
    el('div', 'kst-note', row, 'Steering style, hand, throttle, assists and vibration');
    const open = el('div', 'kc-mini kst-open', row, 'Customize');
    open.onclick = () => {
      this.hide();
      this.controls.onClose = () => this.show();
      this.controls.show();
    };

    for (const n of [head, body]) {
      n.addEventListener('pointerdown', (e) => e.stopPropagation());
      n.addEventListener('pointermove', (e) => e.stopPropagation());
    }
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const s = el('div', 'kst-sec', parent);
    el('div', 'kst-h', s, title);
    return s;
  }

  attach(ctx: Ctx) {
    this.ctx = ctx;
    const q = ctx.settings.quality;
    const current = ctx.settings.lite ? 'lite'
      : q === Quality.Low ? 'low' : q === Quality.Medium ? 'medium' : 'high';
    for (const b of this.qualityOpts) b.classList.toggle('sel', b.dataset.q === current);
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.syncSound();
    this.root.classList.add('on');
    document.documentElement.dataset.kcOpen = '';
  }

  close() {
    if (!this.open) return;
    this.hide();
    this.ctx?.bus.emit({ type: 'ui', name: 'confirm' });
  }

  private hide() {
    this.open = false;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.root.classList.remove('on');
    delete document.documentElement.dataset.kcOpen;
  }
}

const CSS = `
.kst-root:not(.on) { visibility: hidden; }
.kst-body { display: flex; flex-direction: column; gap: 1.8vmin; max-width: 720px; width: 100%; margin: 0 auto; }
.kst-sec {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 14px 12px; border-radius: 14px;
  background: rgba(10,16,28,.62); border: 1.5px solid rgba(255,255,255,.14);
}
.kst-h {
  font-size: clamp(11px, 1.9vmin, 15px); font-weight: 900; letter-spacing: .2em;
  text-transform: uppercase; color: #ffd27a;
}
.kst-seg { align-self: flex-start; }
.kst-seg .kc-opt { min-width: 76px; min-height: 36px; white-space: nowrap; }
.kst-note { font-size: clamp(10px, 1.6vmin, 13px); color: #a9b6c9; letter-spacing: .03em; }
.kst-ctl { display: flex; align-items: center; gap: 12px; }
.kst-open { margin-left: auto; min-height: 38px; padding: 0 18px; font-weight: 800; letter-spacing: .08em; }
.kst-sec .ks-row { grid-template-columns: 6.5em 1fr 3.4em; }
`;
