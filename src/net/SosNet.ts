import * as THREE from 'three';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { RaceState, type Ctx } from '../types';
import type { Race } from '../game/Race';
import type { Kart } from '../kart/Kart';
import { netHooks } from './NetHooks';
import { session } from '../game/Session';

/**
 * Online rooms, stage 1 — standalone, no accounts.
 *
 * Same shape as the SOS zombie lobby: the first player in opens a room, the
 * next ones find it and join. Up to four humans share one race of eight karts;
 * the host's machine drives every kart nobody claimed, so the field is always
 * full. Topology is a star: clients talk only to the host, the host relays.
 *
 *   discovery  Nostr kind 33212 (replaceable per host), tag `sos_kart_v1`,
 *              heartbeat while hosting. A room is alive for ROOM_TTL seconds.
 *   signalling Nostr kind 25212 (ephemeral), NIP-44 encrypted to the peer,
 *              one full SDP each way (ICE gathered before sending).
 *   transport  WebRTC data channels: 'ctl' reliable JSON, 'st' unreliable
 *              binary poses at POSE_HZ.
 *
 * Every visitor gets a throwaway key per page load; nothing is stored.
 */

export const ROOM_TAG = 'sos_kart_v1';
const KIND_ROOM = 33212;
const KIND_SIGNAL = 25212;
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
];
/**
 * STUN for direct links, TURN for networks where a direct link cannot form
 * (mobile carriers, office firewalls, symmetric NAT). freeTURN's public
 * account is capped at 2 Mbit/s per peer; a full room's poses are ~7 KB/s.
 * The Open Relay static account SOS lists in `config.js` no longer authenticates.
 */
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:freeturn.net:3478', 'turn:freeturn.net:3478?transport=tcp'], username: 'free', credential: 'free' },
  { urls: 'turns:freeturn.net:5349', username: 'free', credential: 'free' },
];
/** `?relay=1` forces every link through TURN — for testing the fallback path. */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE,
  iceTransportPolicy: new URLSearchParams(location.search).get('relay') === '1' ? 'relay' : 'all',
};
const MAX_HUMANS = 4;
const ROOM_TTL = 30;
const HEARTBEAT_MS = 10000;
/** Room updates closer together than this are folded into one publish. */
const ANNOUNCE_GAP_MS = 2000;
/** A relay that refused a connection is left alone this long, doubling per failure. */
const RELAY_BACKOFF_MS = 60000;
const RELAY_BACKOFF_MAX_MS = 600000;
const LISTEN_MS = 2500;
const JOIN_TIMEOUT_MS = 12000;
const ICE_WAIT_MS = 4000;
const POSE_HZ = 20;
const INTERP_DELAY_MS = 110;
const POSE_BYTES = 42;
/** Lobby: never start sooner than this after the first call, to catch arrivals a beat apart. */
const GATHER_MIN_MS = 1500;
/** Lobby: stop waiting for players still loading after this; they join the next race. */
const GATHER_MAX_MS = 15000;
/** Host sitting on the results board rolls the next race after this. */
const AUTO_NEXT_MS = 12000;
/** Typical one-lap race, used for the spectators' "next race in" estimate. */
const EST_RACE_S = 60;
/** Spectating one race longer than this means the host has stalled (hidden tab): drop it. */
const STUCK_RACE_MS = 150000;
/** First PLAY opens a lobby this long, so players arriving seconds later race too. */
const LOBBY_MS = 15000;

type Role = 'searching' | 'host' | 'client';

const LAMP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="3.2"/><path d="M1.8 15c.4-3.6 3-5.6 6.2-5.6s5.8 2 6.2 5.6z"/></svg>';

const LAMP_CSS = `
.kr-net-lamp {
  position: fixed; z-index: 60; pointer-events: none;
  top: calc(env(safe-area-inset-top, 0px) + 12px); left: calc(50% + 120px);
  min-width: 24px; height: 24px; padding: 0 6px; box-sizing: border-box; border-radius: 999px;
  display: flex; align-items: center; justify-content: center; gap: 3px;
  font: 800 12px/1 system-ui, sans-serif; color: #062312;
  background: #3aa0ff; box-shadow: 0 0 10px #3aa0ff, 0 0 0 2px rgba(255, 255, 255, 0.35);
  animation: kr-lamp 1.2s ease-in-out infinite;
}
.kr-net-lamp.on {
  background: #38d86b; box-shadow: 0 0 12px #38d86b, 0 0 0 2px rgba(255, 255, 255, 0.45);
  animation: none;
}
.kr-net-lamp svg { width: 13px; height: 13px; display: block; fill: currentColor; }
.kr-net-lamp.hide { display: none; }
@keyframes kr-lamp { 50% { opacity: 0.3; } }
`;

interface RoomInfo { pubkey: string; players: number; max: number; ts: number; startsAt?: number; racing?: boolean }

interface Peer {
  /** true on the host's end of the link */
  hostSide: boolean;
  pk: string;
  sid: string;
  pc: RTCPeerConnection;
  ctl: RTCDataChannel | null;
  st: RTCDataChannel | null;
  idx: number;
  open: boolean;
  /** host side: the client has finished loading and can race */
  ready: boolean;
}

interface Sample {
  at: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  flags: number;
}

const now = () => performance.now();
const nowSec = () => Math.floor(Date.now() / 1000);
const randId = () => Math.random().toString(36).slice(2, 10);

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, ICE_WAIT_MS);
  });
}

function packFlags(k: Kart): number {
  const dir = k.driftDir < 0 ? 1 : k.driftDir > 0 ? 2 : 0;
  const tier = Math.max(0, Math.min(3, k.driftTier | 0));
  return dir | (tier << 2) | (k.boostTime > 0 ? 16 : 0) | (k.stunTime > 0 ? 32 : 0) | (k.airborne ? 64 : 0);
}

const relayDown = new Map<string, { until: number; fails: number }>();
/** One relay pool for the whole page: the title-screen watcher and the room share sockets. */
let sharedPool: SimplePool | null = null;
function relayPool(): SimplePool {
  sharedPool ??= new SimplePool({
    allowConnectingToRelay: (url: string) => {
      const d = relayDown.get(url);
      if (!d || d.until <= Date.now()) return true;
      // Never cut the page off entirely: with every relay benched, try anyway.
      return [...relayDown.values()].filter((x) => x.until > Date.now()).length >= RELAYS.length;
    },
    onRelayConnectionFailure: (url: string) => {
      const fails = (relayDown.get(url)?.fails ?? 0) + 1;
      relayDown.set(url, { fails, until: Date.now() + Math.min(RELAY_BACKOFF_MAX_MS, RELAY_BACKOFF_MS * 2 ** (fails - 1)) });
    },
    onRelayConnectionSuccess: (url: string) => { relayDown.delete(url); },
  } as any);
  return sharedPool;
}

class SosNet {
  private ctx: Ctx;
  private race: Race;
  private sk = generateSecretKey();
  readonly pk = getPublicKey(this.sk);
  private pool = relayPool();
  private subs: { close(): void }[] = [];
  private lastAnnounce = 0;
  private announceTimer = 0;
  private convKeys = new Map<string, Uint8Array>();
  private seen = new Set<string>();

  private role: Role = 'searching';
  private rooms = new Map<string, RoomInfo>();
  private peers = new Map<string, Peer>();
  private host: Peer | null = null;
  private joining: Peer | null = null;
  private myIdx = -1;
  private pendingStart: { idx: number; cd: number } | null = null;
  /** host: lobby window — 0 when not gathering */
  private gatherFrom = 0;
  private gatherMs = LOBBY_MS;
  private resultsSince = 0;
  /** client: 'ready' has been sent to the current host */
  private sentReady = false;
  private spectating = false;
  private lobbyText = '';
  /** host: asked for another race while still Finished; roll it when the board is up */
  private wantNext = false;
  /** PLAY pressed while still looking for a room — start as soon as the role is known. */
  private wantStart = false;
  /** client: humans in the room, as last told by the host */
  private roomCount = 2;
  private sentCount = 0;
  private lastEta = 0;
  private eta: { at: number; total: number; phase: 'race' | 'next' | 'lobby' } | null = null;
  /** client: when the current stretch of watching a live race began, 0 otherwise */
  private watchSince = 0;

  private samples: Sample[][] = [];
  private heartbeat = 0;
  private badge: HTMLDivElement;
  private k0 = new THREE.Vector3();
  private q0 = new THREE.Quaternion();
  private v0 = new THREE.Vector3();

  constructor(ctx: Ctx, seed: RoomInfo[] = []) {
    this.ctx = ctx;
    this.race = ctx.race as unknown as Race;
    if (!document.getElementById('kr-net-lamp-css')) {
      const st = document.createElement('style');
      st.id = 'kr-net-lamp-css';
      st.textContent = LAMP_CSS;
      document.head.appendChild(st);
    }
    this.badge = document.createElement('div');
    this.badge.className = 'kr-net-lamp hide';
    document.body.appendChild(this.badge);
    this.setBadge('Looking for a room…');

    this.race.netDrive = (c, k, i, dt) => this.drive(c, k, i, dt);
    netHooks.requestStart = () => this.requestStart();

    for (const r of seed) this.rooms.set(r.pubkey, r);
    this.listen();
    this.timers.push(
      window.setTimeout(() => void this.matchmake(), this.liveRooms().length ? 300 : LISTEN_MS),
      window.setInterval(() => this.sendPoses(), 1000 / POSE_HZ),
      window.setInterval(() => { this.tick(); this.placeLamp(); }, 250),
    );
    addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private timers: number[] = [];
  private disposed = false;
  private onPageHide = () => this.leave();
  /** A hidden tab stops animating, so its race freezes: hand the room back rather than hold everyone. */
  private onVisibility = () => {
    if (this.disposed) return;
    if (document.hidden) {
      if (this.role !== 'host') return;
      clearInterval(this.heartbeat);
      this.leave();
      for (const p of [...this.peers.values()]) this.dropPeer(p, false);
      this.role = 'searching';
    } else if (this.role === 'searching' && !this.joining) {
      this.becomeHost();
    }
  };

  /** Leave the room and put the race back to plain single-player. */
  dispose() {
    this.disposed = true;
    this.leave();
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    clearInterval(this.heartbeat);
    removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.peers.clear();
    this.host = null;
    this.joining = null;
    this.clearRemote();
    this.race.netDrive = null;
    netHooks.requestStart = null;
    netHooks.wait = null;
    clearTimeout(this.announceTimer);
    const subs = this.subs;
    this.subs = [];
    setTimeout(() => { for (const sub of subs) try { sub.close(); } catch { /* already closed */ } }, 1500);
    this.badge.remove();
  }

  // ------------------------------------------------------------------ nostr

  private convKey(pk: string): Uint8Array {
    let key = this.convKeys.get(pk);
    if (!key) { key = nip44.getConversationKey(this.sk, pk); this.convKeys.set(pk, key); }
    return key;
  }

  private listen() {
    this.subs.push(this.pool.subscribeMany(RELAYS, { kinds: [KIND_ROOM], '#t': [ROOM_TAG], since: nowSec() - 60 }, {
      onevent: (ev) => {
        if (ev.pubkey === this.pk) return;
        try {
          const c = JSON.parse(ev.content);
          if (c.closed) { this.rooms.delete(ev.pubkey); return; }
          const prev = this.rooms.get(ev.pubkey);
          if (prev && prev.ts > ev.created_at) return;
          this.rooms.set(ev.pubkey, {
            pubkey: ev.pubkey,
            players: Math.max(1, Math.min(MAX_HUMANS, Number(c.players) || 1)),
            max: MAX_HUMANS,
            ts: ev.created_at,
            startsAt: Number(c.startsAt) || 0,
          });
        } catch { /* not ours */ }
      },
    }));
    this.subs.push(this.pool.subscribeMany(RELAYS, { kinds: [KIND_SIGNAL], '#p': [this.pk], since: nowSec() - 10 }, {
      onevent: (ev) => {
        if (this.seen.has(ev.id)) return;
        this.seen.add(ev.id);
        let msg: any;
        try { msg = JSON.parse(nip44.decrypt(ev.content, this.convKey(ev.pubkey))); } catch { return; }
        void this.onSignal(ev.pubkey, msg);
      },
    }));
  }

  private signal(to: string, msg: object) {
    const ev = finalizeEvent({
      kind: KIND_SIGNAL,
      created_at: nowSec(),
      tags: [['p', to], ['t', ROOM_TAG]],
      content: nip44.encrypt(JSON.stringify(msg), this.convKey(to)),
    }, this.sk);
    void Promise.allSettled(this.pool.publish(RELAYS, ev));
  }

  private announce(closed = false) {
    clearTimeout(this.announceTimer);
    this.announceTimer = 0;
    const wait = closed ? 0 : this.lastAnnounce + ANNOUNCE_GAP_MS - now();
    if (wait > 0) {
      this.announceTimer = window.setTimeout(() => { if (!this.disposed) this.announce(); }, wait);
      return;
    }
    this.lastAnnounce = now();
    const ev = finalizeEvent({
      kind: KIND_ROOM,
      created_at: nowSec(),
      tags: [['d', ROOM_TAG], ['t', ROOM_TAG]],
      content: JSON.stringify({ v: 1, room: this.pk, players: this.humans(), max: MAX_HUMANS, closed, startsAt: closed ? 0 : this.startsAt(), racing: !closed && this.role === 'host' && this.isRacing() }),
    }, this.sk);
    void Promise.allSettled(this.pool.publish(RELAYS, ev));
  }

  /** Host: when the next race will start (epoch ms), 0 while racing or idle. */
  private startsAt(): number {
    if (this.role !== 'host') return 0;
    if (this.gatherFrom) return Date.now() + Math.max(0, this.gatherFrom + this.gatherMs - now());
    if (this.race.state === RaceState.Results && this.resultsSince) {
      return Date.now() + Math.max(0, AUTO_NEXT_MS + GATHER_MIN_MS - (now() - this.resultsSince));
    }
    return 0;
  }

  // ------------------------------------------------------------ matchmaking

  private liveRooms(): RoomInfo[] {
    const cut = nowSec() - ROOM_TTL;
    return [...this.rooms.values()]
      .filter((r) => r.ts >= cut && r.players < r.max)
      .sort((a, b) => b.players - a.players || b.ts - a.ts);
  }

  private async matchmake() {
    for (const room of this.liveRooms()) {
      if (this.disposed) return;
      if (await this.tryJoin(room.pubkey)) return;
    }
    if (!this.disposed) this.becomeHost();
  }

  private becomeHost() {
    this.role = 'host';
    this.host = null;
    this.announce();
    clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => {
      if (this.role !== 'host') return;
      this.announce();
      void this.mergeLoneHost();
    }, HEARTBEAT_MS);
    this.refresh();
  }

  /**
   * Two players arriving at once both find nothing and both open a room. A
   * host still alone moves into the other room — the fuller one wins, ties go
   * to the lower key so exactly one side moves.
   */
  private async mergeLoneHost() {
    if (this.peers.size > 0 || this.joining || this.isRacing()) return;
    const target = this.liveRooms().find((r) => r.players > 1 || r.pubkey < this.pk);
    if (!target) return;
    if (await this.tryJoin(target.pubkey)) {
      clearInterval(this.heartbeat);
      this.announce(true);
    }
  }

  private tryJoin(hostPk: string): Promise<boolean> {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: Peer = { hostSide: false, pk: hostPk, sid: randId(), pc, ctl: null, st: null, idx: -1, open: false, ready: false };
      this.joining = peer;
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.joining === peer) this.joining = null;
        if (!ok) { try { pc.close(); } catch { /* closed */ } }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), JOIN_TIMEOUT_MS);
      (peer as any).fail = () => finish(false);

      peer.ctl = pc.createDataChannel('ctl', { ordered: true });
      peer.st = pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 });
      peer.st.binaryType = 'arraybuffer';
      peer.ctl.onopen = () => {
        peer.open = true;
        this.becomeClient(peer);
        finish(true);
      };
      this.wireChannels(peer);

      void (async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          await waitIce(pc);
          this.signal(hostPk, { type: 'offer', sid: peer.sid, sdp: pc.localDescription?.sdp });
        } catch { finish(false); }
      })();
    });
  }

  private becomeClient(peer: Peer) {
    for (const p of this.peers.values()) this.dropPeer(p, false);
    this.role = 'client';
    this.host = peer;
    this.sentReady = false;
    this.gatherFrom = 0;
    clearInterval(this.heartbeat);
    this.refresh();
  }

  private async onSignal(from: string, msg: any) {
    if (!msg || typeof msg.type !== 'string' || typeof msg.sid !== 'string') return;
    if (msg.type === 'offer' && typeof msg.sdp === 'string') {
      if (this.role !== 'host' || this.peers.has(from)) return;
      if (this.humans() >= MAX_HUMANS || this.joining) { this.signal(from, { type: 'full', sid: msg.sid }); return; }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: Peer = { hostSide: true, pk: from, sid: msg.sid, pc, ctl: null, st: null, idx: -1, open: false, ready: false };
      this.peers.set(from, peer);
      pc.ondatachannel = (e) => {
        if (e.channel.label === 'ctl') peer.ctl = e.channel;
        else if (e.channel.label === 'st') { peer.st = e.channel; peer.st.binaryType = 'arraybuffer'; }
        this.wireChannels(peer);
      };
      setTimeout(() => { if (!peer.open) this.dropPeer(peer, true); }, JOIN_TIMEOUT_MS);
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        this.signal(from, { type: 'answer', sid: msg.sid, sdp: pc.localDescription?.sdp });
      } catch { this.dropPeer(peer, true); }
      return;
    }
    const j = this.joining;
    if (!j || j.pk !== from || j.sid !== msg.sid) return;
    if (msg.type === 'answer' && typeof msg.sdp === 'string') {
      try { await j.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }); } catch { (j as any).fail?.(); }
    } else if (msg.type === 'full') {
      (j as any).fail?.();
    }
  }

  // ----------------------------------------------------------------- peers

  private wireChannels(peer: Peer) {
    const { ctl, st, pc } = peer;
    if (ctl && !(ctl as any).__wired) {
      (ctl as any).__wired = true;
      ctl.onmessage = (e) => {
        let m: any;
        try { m = JSON.parse(String(e.data)); } catch { return; }
        this.onCtl(peer, m);
      };
      ctl.onclose = () => this.lost(peer);
      if (peer.hostSide) {
        ctl.onopen = () => { peer.open = true; this.onClientJoined(peer); };
        if (ctl.readyState === 'open') { peer.open = true; this.onClientJoined(peer); }
      }
    }
    if (st && !(st as any).__wired) {
      (st as any).__wired = true;
      st.onmessage = (e) => { if (e.data instanceof ArrayBuffer) this.onPoses(peer, e.data); };
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.lost(peer);
    };
  }

  private lost(peer: Peer) {
    if (this.disposed) return;
    if (this.role === 'client' && this.host === peer) {
      this.host = null;
      this.clearRemote();
      this.becomeHost();
      return;
    }
    if (this.peers.get(peer.pk) === peer) this.dropPeer(peer, true);
  }

  private dropPeer(peer: Peer, announce: boolean) {
    this.peers.delete(peer.pk);
    try { peer.pc.close(); } catch { /* closed */ }
    if (peer.idx >= 0) {
      this.race.remote[peer.idx] = false;
      this.samples[peer.idx] = [];
    }
    if (this.peers.size === 0) this.clearRemote();
    if (announce && this.role === 'host') this.announce();
    this.refresh();
  }

  private clearRemote() {
    this.race.remote = [];
    this.race.multiplayer = false;
    this.samples = [];
    this.myIdx = -1;
    this.spectating = false;
    this.lobbyText = '';
    this.wantNext = false;
  }

  private send(peer: Peer, m: object) {
    if (peer.ctl?.readyState === 'open') peer.ctl.send(JSON.stringify(m));
  }

  private humans(): number {
    if (this.role === 'client') return 0;
    let n = 1;
    for (const p of this.peers.values()) if (p.open) n++;
    return n;
  }

  // ------------------------------------------------------------ race flow

  /*
   * Start rules (host decides, clients follow):
   *   - Nobody is put in a race before their game has finished loading
   *     (`ready`). Connecting happens seconds before that.
   *   - Starting a race opens a lobby window: it waits until every connected
   *     player is ready (and at least GATHER_MIN_MS), or GATHER_MAX_MS for
   *     anyone still loading. Latecomers never reset the room:
   *       · ready during the countdown  -> take a free AI kart and join the
   *                                        same countdown where it stands;
   *       · ready once the race is on   -> watch it live, race the next one.
   *   - With others in the room the host's results board rolls the next race
   *     after AUTO_NEXT_MS.
   */

  private onClientJoined(peer: Peer) {
    if (this.humans() > MAX_HUMANS) { this.send(peer, { t: 'full' }); this.dropPeer(peer, false); return; }
    this.race.multiplayer = true;
    this.announce();
    this.refresh();
  }

  private isRacing(): boolean {
    const s = this.race.state;
    return s === RaceState.Countdown || s === RaceState.Racing || s === RaceState.Finished;
  }

  private onPeerReady(peer: Peer) {
    if (peer.ready) return;
    peer.ready = true;
    const s = this.race.state;
    if (s === RaceState.Countdown && this.race.countdownLeft > 1) this.joinCountdown(peer);
    else if (this.isRacing()) this.spectate(peer);
    else this.gather();
    this.refresh();
  }

  private gather(ms = LOBBY_MS) {
    if (this.gatherFrom) return;
    this.gatherFrom = now();
    this.gatherMs = ms;
    this.announce();
  }

  private readyCount(): { ready: number; total: number } {
    let ready = netHooks.booted ? 1 : 0, total = 1;
    for (const p of this.peers.values()) {
      if (!p.open) continue;
      total++;
      if (p.ready) ready++;
    }
    return { ready, total };
  }

  private freeKart(): number {
    const n = this.race.karts.length;
    const taken = new Set<number>([this.race.selectedKart]);
    for (const p of this.peers.values()) if (p.idx >= 0) taken.add(p.idx);
    const free = Array.from({ length: n }, (_, i) => i).filter((i) => !taken.has(i));
    return free.length ? free[Math.floor(Math.random() * free.length)] : -1;
  }

  private joinCountdown(peer: Peer) {
    const idx = this.freeKart();
    if (idx < 0) { this.spectate(peer); return; }
    peer.idx = idx;
    this.race.remote[idx] = true;
    this.samples[idx] = [];
    this.send(peer, { t: 'sess', ...session.snapshot() });
    this.send(peer, { t: 'start', idx, cd: this.race.countdownLeft });
  }

  private spectate(peer: Peer) {
    if (peer.idx >= 0) { this.race.remote[peer.idx] = false; this.samples[peer.idx] = []; }
    peer.idx = -1;
    this.send(peer, { t: 'sess', ...session.snapshot() });
    this.send(peer, { t: 'spectate' });
  }

  /** Host: hand every ready human a kart and put the whole room on the grid. */
  private startAll() {
    const n = this.race.karts.length;
    if (!n || !netHooks.beginRace) return;
    this.gatherFrom = 0;
    this.resultsSince = 0;
    const pool = Array.from({ length: n }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const mine = pool.pop()!;
    session.prepareNext();
    const remote: boolean[] = new Array(n).fill(false);
    for (const p of this.peers.values()) {
      p.idx = -1;
      if (!p.open || !p.ready) continue;
      p.idx = pool.pop()!;
      remote[p.idx] = true;
    }
    this.race.multiplayer = this.peers.size > 0;
    this.race.remote = remote;
    this.samples = [];
    this.myIdx = mine;
    for (const p of this.peers.values()) {
      this.send(p, { t: 'sess', ...session.snapshot() });
      if (p.idx >= 0) this.send(p, { t: 'start', idx: p.idx, cd: 0 });
    }
    netHooks.beginRace(mine);
    netHooks.wait = null;
    this.lobbyText = '';
    this.announce();
    this.refresh();
  }

  /** Host: lobby window and the results auto-roll, polled from `tick`. */
  /** Host: once a second, tell queued spectators roughly when they will race. */
  private sendEta() {
    if (!this.peers.size || now() - this.lastEta < 1000) return;
    this.lastEta = now();
    const next = AUTO_NEXT_MS / 1000 + 2;
    let total = EST_RACE_S + next;
    const s = this.race.state;
    let left: number, phase: 'race' | 'next' | 'lobby' = 'race';
    if (s === RaceState.Countdown) left = total + this.race.countdownLeft;
    else if (this.isRacing()) left = Math.max(4, EST_RACE_S - this.race.raceTime) + next;
    else if (this.gatherFrom) {
      phase = this.gatherMs >= LOBBY_MS ? 'lobby' : 'next';
      left = Math.max(0, (this.gatherFrom + this.gatherMs - now()) / 1000);
      total = this.gatherMs / 1000;
    } else {
      phase = 'next';
      left = this.resultsSince ? Math.max(2, (AUTO_NEXT_MS - (now() - this.resultsSince)) / 1000 + 2) : 3;
    }
    for (const p of this.peers.values()) {
      if (p.ready && p.idx < 0) this.send(p, { t: 'eta', s: Math.round(left), total: Math.round(total), phase });
    }
  }

  private hostTick() {
    this.sendEta();
    const s = this.race.state;
    if (this.wantStart && netHooks.booted) {
      this.wantStart = false;
      if (!this.isRacing()) this.gather();
    }
    if (s === RaceState.Results && !this.gatherFrom) {
      if (this.wantNext) { this.wantNext = false; this.gather(GATHER_MIN_MS); }
      else if (!this.resultsSince) {
        this.resultsSince = now();
        this.announce();
        for (const p of this.peers.values()) this.send(p, { t: 'sess', ...session.snapshot() });
      }
      else if (now() - this.resultsSince > AUTO_NEXT_MS) this.gather(GATHER_MIN_MS);
      else {
        this.setLobby(`Next race in ${Math.ceil((AUTO_NEXT_MS - (now() - this.resultsSince)) / 1000)}s`);
      }
    } else if (s !== RaceState.Results) {
      this.resultsSince = 0;
      if (!this.gatherFrom) this.setLobby('');
    }
    if (!this.gatherFrom) { netHooks.wait = null; return; }
    const { ready, total } = this.readyCount();
    const pending = [...this.peers.values()].some((p) => !p.open);
    const waited = now() - this.gatherFrom;
    const left = Math.ceil((this.gatherMs - waited) / 1000);
    this.setLobby(left > 0 ? `Race starts in ${left}s \u00b7 ${total}/${MAX_HUMANS} players` : 'Waiting for players to load\u2026');
    netHooks.wait = this.gatherMs >= LOBBY_MS
      ? { etaAt: this.gatherFrom + this.gatherMs, total: this.gatherMs / 1000, phase: 'lobby' }
      : null;
    if (!netHooks.booted) return;
    const allIn = ready >= total && !pending;
    const full = total >= MAX_HUMANS && waited >= GATHER_MIN_MS;
    if ((allIn && (waited >= this.gatherMs || full)) || waited >= Math.max(this.gatherMs + 6000, GATHER_MAX_MS)) this.startAll();
  }

  /** Host: lobby / next-race line, mirrored to every client's badge. */
  private setLobby(text: string) {
    if (text === this.lobbyText) return;
    this.lobbyText = text;
    for (const p of this.peers.values()) this.send(p, { t: 'wait', text });
    this.refresh();
  }

  private onCtl(peer: Peer, m: any) {
    if (!m || typeof m.t !== 'string') return;
    if (this.role === 'client' && peer === this.host) {
      if (m.t === 'start' && Number.isInteger(m.idx)) {
        this.clientStart(m.idx, Number(m.cd) || 0);
      } else if (m.t === 'spectate') {
        this.clientSpectate();
      } else if (m.t === 'sess') {
        session.adopt(m);
      } else if (m.t === 'n' && Number.isInteger(m.n)) {
        this.roomCount = Math.max(2, Math.min(MAX_HUMANS, m.n));
        this.refresh();
      } else if (m.t === 'eta' && Number.isFinite(m.s) && Number.isFinite(m.total)) {
        this.eta = {
          at: performance.now() + Math.max(0, Math.min(600, m.s)) * 1000,
          total: Math.max(1, Math.min(600, m.total)),
          phase: m.phase === 'next' || m.phase === 'lobby' ? m.phase : 'race',
        };
      } else if (m.t === 'wait' && typeof m.text === 'string') {
        this.lobbyText = m.text.slice(0, 40);
        this.refresh();
      }
      return;
    }
    if (this.role !== 'host') return;
    if (m.t === 'ready') this.onPeerReady(peer);
    else if (m.t === 'req') {
      if (!peer.ready) return;
      if (this.isRacing()) { if (peer.idx < 0) this.spectate(peer); }
      else this.gather();
    }
  }

  private clientStart(idx: number, cd: number) {
    const n = this.race.karts.length;
    if (!n || !netHooks.beginRace) { this.pendingStart = { idx, cd }; return; }
    if (idx < 0 || idx >= n) return;
    this.pendingStart = null;
    this.spectating = false;
    this.eta = null;
    netHooks.wait = null;
    this.lobbyText = '';
    this.myIdx = idx;
    this.race.multiplayer = true;
    this.race.remote = Array.from({ length: n }, (_, i) => i !== idx);
    this.samples = [];
    netHooks.beginRace(idx);
    if (cd > 0) this.race.syncCountdown(cd - 0.15);
    this.refresh();
  }

  /** Client: the room is mid-race — show it live behind the title, race the next one. */
  private clientSpectate() {
    const n = this.race.karts.length;
    this.spectating = true;
    this.lobbyText = '';
    this.myIdx = -1;
    this.race.multiplayer = true;
    this.race.remote = Array.from({ length: n }, () => true);
    this.samples = [];
    this.refresh();
  }

  private tick() {
    if (this.role === 'client') {
      this.wantStart = false;
      const e = this.eta;
      const watching = this.spectating && (!e || e.phase === 'race');
      if (!watching) this.watchSince = 0;
      else if (!this.watchSince) this.watchSince = now();
      else if (now() - this.watchSince > STUCK_RACE_MS && this.host) {
        this.watchSince = 0;
        try { this.host.pc.close(); } catch { /* closed */ }
        this.lost(this.host);
        this.wantStart = true;
        return;
      }
      netHooks.wait = this.spectating || e?.phase === 'lobby'
        ? { etaAt: e ? e.at : 0, total: e ? e.total : EST_RACE_S, phase: e ? e.phase : 'race' }
        : null;
      const h = this.host;
      if (h && !this.sentReady && netHooks.booted && this.race.karts.length && h.ctl?.readyState === 'open') {
        this.sentReady = true;
        this.send(h, { t: 'ready' });
      }
      const p = this.pendingStart;
      if (p && this.race.karts.length && netHooks.beginRace) this.clientStart(p.idx, p.cd);
    } else if (this.role === 'host') {
      this.hostTick();
    }
  }

  private requestStart(): boolean {
    if (this.role === 'searching') { this.wantStart = true; return true; }
    if (this.role === 'client' && this.host) {
      this.send(this.host, { t: 'req' });
      return true;
    }
    if (this.role === 'host') {
      // Finished = this player is over the line but others may still be
      // driving; the next race is rolled once the board is up.
      if (this.race.state === RaceState.Finished) { if (!this.peers.size) return false; this.wantNext = true; }
      else if (!this.isRacing()) this.gather(this.race.state === RaceState.Results ? GATHER_MIN_MS : LOBBY_MS);
      return true;
    }
    return false;
  }

  // ----------------------------------------------------------------- poses

  private writePose(dv: DataView, off: number, i: number) {
    const s = this.race.remote[i] ? this.samples[i]?.[this.samples[i].length - 1] : null;
    const k = this.race.karts[i] as unknown as Kart;
    const pos = s ? s.pos : k.position, q = s ? s.quat : k.quaternion, v = s ? s.vel : k.velocity;
    dv.setUint8(off, i);
    dv.setUint8(off + 1, s ? s.flags : packFlags(k));
    const f = [pos.x, pos.y, pos.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z];
    for (let j = 0; j < 10; j++) dv.setFloat32(off + 2 + j * 4, f[j], true);
  }

  private packet(indices: number[]): ArrayBuffer {
    const buf = new ArrayBuffer(2 + indices.length * POSE_BYTES);
    const dv = new DataView(buf);
    dv.setUint8(0, 1);
    dv.setUint8(1, indices.length);
    indices.forEach((i, n) => this.writePose(dv, 2 + n * POSE_BYTES, i));
    return buf;
  }

  private sendPoses() {
    if (!this.race.multiplayer || !this.race.karts.length) return;
    if (this.role === 'client') {
      if (this.myIdx < 0) return;
      const st = this.host?.st;
      if (st?.readyState === 'open' && st.bufferedAmount < 16384) st.send(this.packet([this.myIdx]));
      return;
    }
    if (this.role !== 'host') return;
    const n = this.race.karts.length;
    for (const p of this.peers.values()) {
      if (!p.ready || p.st?.readyState !== 'open' || p.st.bufferedAmount > 16384) continue;
      const list: number[] = [];
      for (let i = 0; i < n; i++) {
        if (i === p.idx) continue;
        if (this.race.remote[i] && !this.samples[i]?.length) continue;
        list.push(i);
      }
      p.st.send(this.packet(list));
    }
  }

  private onPoses(peer: Peer, buf: ArrayBuffer) {
    if (buf.byteLength < 2) return;
    const dv = new DataView(buf);
    if (dv.getUint8(0) !== 1) return;
    const count = dv.getUint8(1);
    if (buf.byteLength < 2 + count * POSE_BYTES) return;
    const n = this.race.karts.length;
    for (let c = 0; c < count; c++) {
      const off = 2 + c * POSE_BYTES;
      const i = dv.getUint8(off);
      if (i >= n || !this.race.remote[i]) continue;
      if (this.role === 'host' && i !== peer.idx) continue;
      const f: number[] = [];
      for (let j = 0; j < 10; j++) f.push(dv.getFloat32(off + 2 + j * 4, true));
      if (!f.every(Number.isFinite)) continue;
      const list = (this.samples[i] ??= []);
      list.push({
        at: now(),
        flags: dv.getUint8(off + 1),
        pos: new THREE.Vector3(f[0], f[1], f[2]),
        quat: new THREE.Quaternion(f[3], f[4], f[5], f[6]).normalize(),
        vel: new THREE.Vector3(f[7], f[8], f[9]),
      });
      if (list.length > 8) list.shift();
    }
  }

  /** Race calls this instead of physics for every remote kart, every frame. */
  private drive(ctx: Ctx, k: Kart, i: number, dt: number) {
    const list = this.samples[i];
    if (!list?.length) {
      this.v0.set(0, 0, 0);
      k.netPose(ctx, dt, this.k0.copy(k.position), this.q0.copy(k.quaternion), this.v0, 0, 0, false, false, false);
      return;
    }
    const at = now() - INTERP_DELAY_MS;
    let a = list[0], b = list[list.length - 1];
    for (let n = list.length - 1; n > 0; n--) {
      if (list[n - 1].at <= at) { a = list[n - 1]; b = list[n]; break; }
    }
    if (at >= b.at) {
      const ahead = Math.min((at - b.at) / 1000, 0.15);
      this.k0.copy(b.pos).addScaledVector(b.vel, ahead);
      this.q0.copy(b.quat);
      this.v0.copy(b.vel);
    } else if (at <= a.at) {
      this.k0.copy(a.pos); this.q0.copy(a.quat); this.v0.copy(a.vel);
    } else {
      const u = (at - a.at) / Math.max(1, b.at - a.at);
      this.k0.lerpVectors(a.pos, b.pos, u);
      this.q0.slerpQuaternions(a.quat, b.quat, u);
      this.v0.lerpVectors(a.vel, b.vel, u);
    }
    const fl = b.flags;
    const dir = (fl & 3) === 1 ? -1 : (fl & 3) === 2 ? 1 : 0;
    k.netPose(ctx, dt, this.k0, this.q0, this.v0, dir, (fl >> 2) & 3, !!(fl & 16), !!(fl & 32), !!(fl & 64));
  }

  // ---------------------------------------------------------------- misc

  private leave() {
    if (this.role === 'host') this.announce(true);
    for (const p of this.peers.values()) try { p.pc.close(); } catch { /* closed */ }
    try { this.host?.pc.close(); } catch { /* closed */ }
  }

  /** Online lamp: blinking blue while alone, steady green with the head count once others are in. */
  private setBadge(text: string) {
    this.badge.title = text;
    const n = this.role === 'client' ? this.roomCount : this.role === 'host' ? this.humans() : 1;
    const on = n > 1;
    this.badge.classList.toggle('on', on);
    this.badge.innerHTML = LAMP_ICON + (on ? `<b>${n}</b>` : '');
    if (this.role === 'host' && n !== this.sentCount) {
      this.sentCount = n;
      for (const p of this.peers.values()) this.send(p, { t: 'n', n });
    }
  }

  private placeLamp() {
    const r = document.querySelector('.kr-map')?.getBoundingClientRect();
    this.badge.style.left = r && r.width ? `${Math.round(r.right + 10)}px` : '';
    const s = this.race.state;
    this.badge.classList.toggle('hide', s !== RaceState.Countdown && s !== RaceState.Racing);
  }

  private refresh() {
    if (this.role === 'client') {
      if (this.lobbyText) this.setBadge(`ONLINE · ${this.lobbyText}`);
      else if (this.spectating) this.setBadge('ONLINE · watching live — you race the next round');
      else if (!netHooks.booted) this.setBadge('ONLINE · in room · loading…');
      else this.setBadge('ONLINE · in room');
    } else if (this.role === 'host' && this.peers.size > 0) {
      this.setBadge(`ONLINE ${this.humans()}/${MAX_HUMANS} · host${this.lobbyText ? ' · ' + this.lobbyText : ''}`);
    }
    else if (this.role === 'host') this.setBadge(this.lobbyText ? `ONLINE · ${this.lobbyText}` : 'Room open · waiting for players');
    else this.setBadge('Looking for a room…');
  }
}

let instance: SosNet | null = null;

let watcher: { rooms: Map<string, RoomInfo>; close: () => void } | null = null;

const netAllowed = () => {
  const q = new URLSearchParams(location.search);
  return q.get('net') !== '0' && q.get('solo') !== '1' && typeof WebSocket !== 'undefined';
};

/**
 * Before PLAY: read-only view of the room announcements, so the title can
 * offer "JOIN · 7s" while a lobby nearby is counting down. Joins nothing.
 */
export function watchRooms() {
  if (watcher || instance || !netAllowed()) return;
  const pool = relayPool();
  const rooms = new Map<string, RoomInfo>();
  const pick = () => {
    const cut = nowSec() - ROOM_TTL, t = Date.now();
    let best: RoomInfo | null = null, live = false;
    for (const r of rooms.values()) {
      if (r.ts < cut || r.players >= MAX_HUMANS) continue;
      if (r.racing) live = true;
      if (!r.startsAt || r.startsAt <= t) continue;
      if (!best || r.startsAt < best.startsAt!) best = r;
    }
    netHooks.openRoom = best ? { startsAt: best.startsAt! } : null;
    netHooks.liveRace = live;
  };
  const sub = pool.subscribeMany(RELAYS, { kinds: [KIND_ROOM], '#t': [ROOM_TAG], since: nowSec() - 60 }, {
    onevent: (ev) => {
      try {
        const c = JSON.parse(ev.content);
        const prev = rooms.get(ev.pubkey);
        if (prev && prev.ts > ev.created_at) return;
        if (c.closed) rooms.delete(ev.pubkey);
        else rooms.set(ev.pubkey, {
          pubkey: ev.pubkey,
          players: Math.max(1, Math.min(MAX_HUMANS, Number(c.players) || 1)),
          max: MAX_HUMANS,
          ts: ev.created_at,
          startsAt: Number(c.startsAt) || 0,
          racing: !!c.racing,
        });
        pick();
      } catch { /* not ours */ }
    },
  });
  const timer = window.setInterval(pick, 1000);
  watcher = {
    rooms,
    close: () => {
      clearInterval(timer);
      try { sub.close(); } catch { /* closed */ }
      netHooks.openRoom = null;
      netHooks.liveRace = false;
    },
  };
}

export function startNet(ctx: Ctx) {
  if (instance) return;
  if (!netAllowed() || typeof RTCPeerConnection === 'undefined') return;
  const seed = watcher ? [...watcher.rooms.values()] : [];
  watcher?.close();
  watcher = null;
  try { instance = new SosNet(ctx, seed); } catch (err) { console.warn('[net] disabled', err); }
}

export function stopNet() {
  instance?.dispose();
  instance = null;
}
