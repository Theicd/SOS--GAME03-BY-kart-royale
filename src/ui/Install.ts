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
.kr-install.gone{animation:kr-inst-out .5s ease both;pointer-events:none}
@keyframes kr-inst-out{to{opacity:0;transform:translateY(12px)}}
.kr-idlg{position:fixed;inset:0;z-index:140;display:none;place-items:center;padding:16px;
background:rgba(4,6,14,.66);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);pointer-events:auto}
.kr-idlg.show{display:grid}
.kr-idlg-card{width:min(420px,100%);padding:22px 22px 18px;border-radius:18px;text-align:center;
background:linear-gradient(180deg,rgba(28,32,56,.97),rgba(12,14,28,.97));
border:1px solid rgba(255,217,138,.4);box-shadow:0 18px 50px rgba(0,0,0,.6),0 0 24px rgba(255,170,60,.18);
color:#f4efe4;font:600 15px/1.5 "Avenir Next","Segoe UI",system-ui,sans-serif;animation:kr-inst-in .3s ease both}
.kr-idlg-card img{width:64px;height:64px;border-radius:14px;box-shadow:0 4px 14px rgba(0,0,0,.5)}
.kr-idlg-card h3{margin:12px 0 6px;font-size:18px;font-weight:900;letter-spacing:.14em;
text-transform:uppercase;color:#ffd98a}
.kr-idlg-card p{margin:0 0 6px;color:rgba(244,239,228,.85)}
.kr-idlg-card ul{margin:8px 0 16px;padding:0;list-style:none;font-size:13px;color:rgba(255,230,190,.8)}
.kr-idlg-card li{margin:3px 0}
.kr-idlg-card b{color:#ffd98a}
.kr-idlg-row{display:flex;gap:10px;justify-content:center}
.kr-idlg-row button{flex:1;min-height:46px;border-radius:999px;cursor:pointer;
font:900 14px/1 "Avenir Next","Segoe UI",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}
.kr-idlg-ok{border:0;color:#2a1a06;background:linear-gradient(180deg,#ffe3a3,#f4b451)}
.kr-idlg-no{border:1px solid rgba(255,255,255,.25);color:#f4efe4;background:rgba(255,255,255,.06)}
.kr-install img{width:40px;height:40px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.kr-install small{display:block;font-weight:600;font-size:11px;letter-spacing:.04em;
text-transform:none;color:rgba(255,230,190,.75);margin-top:4px}
.kr-install:active{transform:scale(.97)}
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


  const dlg = document.createElement('div');
  dlg.className = 'kr-idlg';
  document.body.appendChild(dlg);
  const closeDlg = () => dlg.classList.remove('show');
  dlg.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === dlg) closeDlg(); });
  dlg.addEventListener('click', (e) => e.stopPropagation());

  let deferred: InstallPromptEvent | null = null;
  let available = isIOS();
  let cardUntil = 0;

  const onFrontEnd = () =>
    !!document.getElementById('boot') || !!document.documentElement.dataset.menu;
  const sync = () => {
    const want = available && onFrontEnd() && !isStandalone();
    if (want && !cardUntil) {
      cardUntil = performance.now() + 5000;
      setTimeout(sync, 5000);
      setTimeout(sync, 5600);
    }
    const left = cardUntil - performance.now();
    btn.classList.toggle('show', want && left > -500);
    btn.classList.toggle('gone', left <= 0);
    document.documentElement.toggleAttribute('data-can-install', available && !isStandalone());
  };

  const runPrompt = async () => {
    if (!deferred) return;
    const d = deferred;
    deferred = null;
    await d.prompt().catch(() => {});
    const choice = await d.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') available = false;
    sync();
  };

  openDialog = () => {
    if (!available) return;
    const head =
      '<img alt="" src="icons/icon-192.png"><h3>Install Kart Royale</h3>' +
      '<p>Add the game to your device and race straight from the home screen.</p>' +
      '<ul><li>Full screen, no browser bars</li><li>Opens faster</li><li>One tap from your home screen</li></ul>';
    if (deferred) {
      dlg.innerHTML = `<div class="kr-idlg-card">${head}<p>Tap <b>Install</b> to confirm.</p>` +
        '<div class="kr-idlg-row"><button class="kr-idlg-no">Not now</button><button class="kr-idlg-ok">Install</button></div></div>';
      (dlg.querySelector('.kr-idlg-ok') as HTMLElement).onclick = () => { closeDlg(); runPrompt(); };
    } else {
      dlg.innerHTML = `<div class="kr-idlg-card">${head}` +
        '<p>Tap <b>Share</b> <span style="font-size:17px">&#x2B06;&#xFE0E;</span> at the bottom of Safari, then <b>Add to Home Screen</b>.</p>' +
        '<div class="kr-idlg-row"><button class="kr-idlg-no">Got it</button></div></div>';
    }
    (dlg.querySelector('.kr-idlg-no') as HTMLElement).onclick = closeDlg;
    dlg.classList.add('show');
  };

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    available = true;
    sync();
  });
  addEventListener('appinstalled', () => { available = false; deferred = null; closeDlg(); sync(); });

  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (deferred) runPrompt();
    else openDialog();
  });

  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-menu'] });
  setInterval(sync, 1000);
  sync();
}

let openDialog = () => {};
/** Opens the styled "install the game" confirmation. */
export function openInstallDialog() { openDialog(); }
