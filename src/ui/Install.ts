/**
 * "Install" button for the home screen: shown on the boot curtain and the
 * front-end menus, never over a race. Chrome/Edge/Samsung get the native
 * prompt; iOS Safari has none, so it gets the two-step Share instructions.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
  (navigator as any).standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const CSS = `
.kr-install{position:fixed;z-index:120;right:calc(env(safe-area-inset-right,0px) + 14px);
bottom:calc(env(safe-area-inset-bottom,0px) + 14px);display:none;align-items:center;gap:10px;
padding:10px 16px 10px 10px;border-radius:16px;border:1px solid rgba(255,210,122,.55);
background:linear-gradient(180deg,rgba(40,30,20,.92),rgba(12,10,8,.92));color:#fff;
font:800 14px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
box-shadow:0 6px 24px rgba(0,0,0,.5),0 0 18px rgba(255,170,60,.25);pointer-events:auto;
-webkit-tap-highlight-color:transparent;animation:kr-inst-in .45s ease both}
.kr-install.show{display:flex}
.kr-install img{width:40px;height:40px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.kr-install small{display:block;font-weight:600;font-size:11px;letter-spacing:.04em;
text-transform:none;color:rgba(255,230,190,.75);margin-top:4px}
.kr-install:active{transform:scale(.97)}
.kr-ios{position:fixed;inset:0;z-index:130;display:none;place-items:end center;
background:rgba(0,0,0,.55);pointer-events:auto}
.kr-ios.show{display:grid}
.kr-ios div{margin:0 12px calc(env(safe-area-inset-bottom,0px) + 18px);max-width:420px;
padding:18px 20px;border-radius:18px;background:#15110c;color:#fff;border:1px solid rgba(255,210,122,.5);
font:600 15px/1.5 system-ui,sans-serif;text-align:center}
.kr-ios b{color:#ffd27a}
@keyframes kr-inst-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
`;

export function installAppButton() {
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
  if (isStandalone()) return;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = document.createElement('div');
  btn.className = 'kr-install';
  btn.innerHTML =
    '<img alt="" src="icons/icon-192.png">' +
    `<div>Install game<small>Add to home screen</small></div>`;
  document.body.appendChild(btn);

  const ios = document.createElement('div');
  ios.className = 'kr-ios';
  ios.innerHTML =
    '<div>To install: tap <b>Share</b> <span style="font-size:18px">&#x2B06;&#xFE0E;</span> ' +
    'at the bottom of Safari, then <b>Add to Home Screen</b>.</div>';
  document.body.appendChild(ios);
  ios.addEventListener('pointerdown', (e) => { e.stopPropagation(); ios.classList.remove('show'); });

  let deferred: InstallPromptEvent | null = null;
  let available = isIOS();

  const onFrontEnd = () =>
    !!document.getElementById('boot') || !!document.documentElement.dataset.menu;
  const sync = () => btn.classList.toggle('show', available && onFrontEnd() && !isStandalone());

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    available = true;
    sync();
  });
  addEventListener('appinstalled', () => { available = false; deferred = null; sync(); });

  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (deferred) {
      const d = deferred;
      deferred = null;
      await d.prompt().catch(() => {});
      const choice = await d.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') available = false;
      sync();
    } else if (isIOS()) {
      ios.classList.add('show');
    }
  });

  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-menu'] });
  setInterval(sync, 1000);
  sync();
}
