/**
 * The sound screen — one slider per bus. Borrows the controls sheet's styling
 * (`kc-*`, injected by ControlsMenu) so the two overlays read as one family.
 */
import type { Ctx } from '../types';
import { setSoundLevel, soundLevels, type SoundLevels } from '../audio/SoundPrefs';
import { el } from './uiUtil';

const ROWS: { key: keyof SoundLevels; label: string }[] = [
  { key: 'music', label: 'Music' },
  { key: 'engine', label: 'Engine' },
  { key: 'sfx', label: 'Effects' },
];

export class SoundMenu {
  open = false;

  private root: HTMLDivElement;
  private ctx: Ctx | null = null;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = el('div', 'kc-root ks-root', parent);
    const head = el('div', 'kc-head', this.root);
    el('div', 'kc-title', head, 'Sound');
    el('div', 'ks-spacer', head);
    const done = el('div', 'kc-done', head, 'Done');
    done.onclick = () => this.close();

    const body = el('div', 'kc-body ks-body', this.root);
    for (const r of ROWS) {
      const row = el('div', 'ks-row', body);
      el('div', 'kc-row-l', row, r.label);
      const input = el('input', 'ks-range', row) as HTMLInputElement;
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '5';
      const val = el('div', 'ks-val', row);
      const show = () => {
        val.textContent = `${input.value}%`;
        input.style.setProperty('--fill', `${input.value}%`);
      };
      input.value = String(Math.round(soundLevels()[r.key] * 100));
      show();
      // Arrow keys belong to the slider while it has focus, not to the kart.
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') this.close();
      });
      input.oninput = () => {
        setSoundLevel(r.key, Number(input.value) / 100);
        show();
      };
    }

    // TouchControls listens on window; keep slider drags from steering.
    for (const n of [head, body]) {
      n.addEventListener('pointerdown', (e) => e.stopPropagation());
      n.addEventListener('pointermove', (e) => e.stopPropagation());
    }
  }

  attach(ctx: Ctx) {
    this.ctx = ctx;
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('on');
    document.documentElement.dataset.kcOpen = '';
  }

  close() {
    if (!this.open) return;
    this.open = false;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.root.classList.remove('on');
    delete document.documentElement.dataset.kcOpen;
    this.ctx?.bus.emit({ type: 'ui', name: 'confirm' });
  }
}

const CSS = `
.ks-root:not(.on) { visibility: hidden; }
.ks-spacer { flex: 1; }
.ks-body { display: flex; flex-direction: column; gap: 18px; max-width: 640px; width: 100%; margin: 4vmin auto 0; }
.ks-row { display: grid; grid-template-columns: 7em 1fr 3.4em; align-items: center; gap: 14px; }
.ks-row .kc-row-l { font-size: clamp(13px, 2.4vmin, 19px); font-weight: 700; }
.ks-val { text-align: right; font-weight: 800; color: #ffd27a; font-variant-numeric: tabular-nums; }
.ks-range {
  -webkit-appearance: none; appearance: none; width: 100%; height: 14px; margin: 0;
  border-radius: 999px; outline: none; cursor: pointer; touch-action: none;
  background: linear-gradient(90deg, #6ad2ff 0%, #ffd27a var(--fill, 100%), rgba(8,13,24,.75) var(--fill, 100%));
  border: 1.5px solid rgba(255,255,255,.18);
}
.ks-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 30px; height: 30px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #fff, #f0a93c); box-shadow: 0 2px 8px rgba(0,0,0,.5);
}
.ks-range::-moz-range-thumb {
  width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #fff, #f0a93c); box-shadow: 0 2px 8px rgba(0,0,0,.5);
}
`;
