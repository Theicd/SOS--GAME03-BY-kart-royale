import * as THREE from 'three';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { RaceState, type Ctx } from '../types';
import type { Race } from '../game/Race';
import type { Kart } from '../kart/Kart';
import { netHooks } from './NetHooks';

/**
 * Online rooms, stage 1 ג€” standalone, no accounts.
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
 * Same list the SOS app ships in `config.js`: STUN for direct links, and the
 * public Open Relay TURN (UDP/TCP 80, 443, TLS 443) for networks where a
 * direct link cannot form ג€” mobile carriers, office firewalls, symmetric NAT.
 */
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
];
/** `?relay=1` forces every link through TURN ג€” for testing the fallback path. */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE,
  iceTransportPolicy: new URLSearchParams(location.search).get('relay') === '1' ? 'relay' : 'all',
};
const MAX_HUMANS = 4;
const ROOM_TTL = 20;
const HEARTBEAT_MS = 6000;
const LISTEN_MS = 2500;
const JOIN_TIMEOUT_MS = 12000;
const ICE_WAIT_MS = 4000;
const POSE_HZ = 20;
const INTERP_DELAY_MS = 110;
const POSE_BYTES = 42;

type Role = 'searching' | 'host' | 'client';

interface RoomInfo { pubkey: string; players: number; max: number; ts: number }

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

class SosNet {
  private ctx: Ctx;
  private race: Race;
  private sk = generateSecretKey();
  readonly pk = getPublicKey(this.sk);
  private pool = new SimplePool();
  private convKeys = new Map<string, Uint8Array>();
  private seen = new Set<string>();

  private role: Role = 'searching';
  private rooms = new Map<string, RoomInfo>();
  private peers = new Map<string, Peer>();
  private host: Peer | null = null;
  private joining: Peer | null = null;
  private myIdx = -1;
  private pendingStart: number | null = null;

  private samples: Sample[][] = [];
  private heartbeat = 0;
  private badge: HTMLDivElement;
  private k0 = new THREE.Vector3();
  private q0 = new THREE.Quaternion();
  private v0 = new THREE.Vector3();

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.race = ctx.race as unknown as Race;
    this.badge = document.createElement('div');
    this.badge.className = 'kr-net-badge';
    Object.assign(this.badge.style, {
      position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 6px)', left: '50%',
      transform: 'translateX(-50%)', zIndex: '60', pointerEvents: 'none',
      font: '600 12px/1 system-ui, sans-serif', letterSpacing: '0.06em',
      color: '#fff', background: 'rgba(10,20,40,0.55)', padding: '5px 10px',
      borderRadius: '999px', border: '1px solid rgba(255,255,255,0.18)',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.badge);
    this.setBadge('Looking for a roomג€¦');

    this.race.netDrive = (c, k, i, dt) => this.drive(c, k, i, dt);
    netHooks.requestStart = () => this.requestStart();

    this.listen();
    setTimeout(() => void this.matchmake(), LISTEN_MS);
    setInterval(() => this.sendPoses(), 1000 / POSE_HZ);
    setInterval(() => this.applyPendingStart(), 250);
    addEventListener('pagehide', () => this.leave());
  }

  // ------------------------------------------------------------------ nostr

  private convKey(pk: string): Uint8Array {
    let key = this.convKeys.get(pk);
    if (!key) { key = nip44.getConversationKey(this.sk, pk); this.convKeys.set(pk, key); }
    return key;
  }

  private listen() {
    this.pool.subscribeMany(RELAYS, { kinds: [KIND_ROOM], '#t': [ROOM_TAG], since: nowSec() - 60 }, {
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
          });
        } catch { /* not ours */ }
      },
    });
    this.pool.subscribeMany(RELAYS, { kinds: [KIND_SIGNAL], '#p': [this.pk], since: nowSec() - 10 }, {
      onevent: (ev) => {
        if (this.seen.has(ev.id)) return;
        this.seen.add(ev.id);
        let msg: any;
        try { msg = JSON.parse(nip44.decrypt(ev.content, this.convKey(ev.pubkey))); } catch { return; }
        void this.onSignal(ev.pubkey, msg);
      },
    });
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
    const ev = finalizeEvent({
      kind: KIND_ROOM,
      created_at: nowSec(),
      tags: [['d', ROOM_TAG], ['t', ROOM_TAG]],
      content: JSON.stringify({ v: 1, room: this.pk, players: this.humans(), max: MAX_HUMANS, closed }),
    }, this.sk);
    void Promise.allSettled(this.pool.publish(RELAYS, ev));
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
      if (await this.tryJoin(room.pubkey)) return;
    }
    this.becomeHost();
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
   * host still alone moves into the other room ג€” the fuller one wins, ties go
   * to the lower key so exactly one side moves.
   */
  private async mergeLoneHost() {
    if (this.peers.size > 0 || this.joining) return;
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
      const peer: Peer = { hostSide: false, pk: hostPk, sid: randId(), pc, ctl: null, st: null, idx: -1, open: false };
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
    clearInterval(this.heartbeat);
    this.refresh();
  }

  private async onSignal(from: string, msg: any) {
    if (!msg || typeof msg.type !== 'string' || typeof msg.sid !== 'string') return;
    if (msg.type === 'offer' && typeof msg.sdp === 'string') {
      if (this.role !== 'host' || this.peers.has(from)) return;
      if (this.humans() >= MAX_HUMANS || this.joining) { this.signal(from, { type: 'full', sid: msg.sid }); return; }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: Peer = { hostSide: true, pk: from, sid: msg.sid, pc, ctl: null, st: null, idx: -1, open: false };
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

  private onClientJoined(peer: Peer) {
    if (this.humans() > MAX_HUMANS) { this.send(peer, { t: 'full' }); this.dropPeer(peer, false); return; }
    this.announce();
    this.startAll();
  }

  /** Host: hand every human a kart and put the whole room on the grid. */
  private startAll() {
    const n = this.race.karts.length;
    if (!n) { this.pendingStart = -2; return; }
    const pool = Array.from({ length: n }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const mine = pool.pop()!;
    const remote: boolean[] = new Array(n).fill(false);
    for (const p of this.peers.values()) {
      if (!p.open) continue;
      p.idx = pool.pop()!;
      remote[p.idx] = true;
    }
    this.race.multiplayer = remote.some(Boolean);
    this.race.remote = remote;
    this.samples = [];
    this.myIdx = mine;
    for (const p of this.peers.values()) if (p.open) this.send(p, { t: 'start', idx: p.idx });
    this.begin(mine);
    this.refresh();
  }

  private onCtl(peer: Peer, m: any) {
    if (!m || typeof m.t !== 'string') return;
    if (this.role === 'client' && peer === this.host) {
      if (m.t === 'start' && Number.isInteger(m.idx)) this.clientStart(m.idx);
      return;
    }
    if (this.role === 'host' && m.t === 'req') {
      const s = this.race.state;
      if (s === RaceState.Countdown || s === RaceState.Racing) this.send(peer, { t: 'start', idx: peer.idx });
      else this.startAll();
    }
  }

  private clientStart(idx: number) {
    const n = this.race.karts.length;
    if (!n) { this.pendingStart = idx; return; }
    if (idx < 0 || idx >= n) return;
    this.myIdx = idx;
    this.race.multiplayer = true;
    this.race.remote = Array.from({ length: n }, (_, i) => i !== idx);
    this.samples = [];
    this.begin(idx);
    this.refresh();
  }

  private begin(idx: number) {
    if (!netHooks.beginRace) { this.pendingStart = idx; return; }
    this.pendingStart = null;
    netHooks.beginRace(idx);
  }

  private applyPendingStart() {
    if (this.pendingStart === null || !this.race.karts.length || !netHooks.beginRace) return;
    const p = this.pendingStart;
    this.pendingStart = null;
    if (p === -2) this.startAll();
    else if (this.role === 'client') this.clientStart(p);
    else this.begin(p);
  }

  private requestStart(): boolean {
    if (this.role === 'client' && this.host) { this.send(this.host, { t: 'req' }); return true; }
    if (this.role === 'host' && this.peers.size > 0) { this.startAll(); return true; }
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
    if (!this.race.multiplayer || this.myIdx < 0 || !this.race.karts.length) return;
    if (this.role === 'client') {
      const st = this.host?.st;
      if (st?.readyState === 'open' && st.bufferedAmount < 16384) st.send(this.packet([this.myIdx]));
      return;
    }
    if (this.role !== 'host') return;
    const n = this.race.karts.length;
    for (const p of this.peers.values()) {
      if (!p.open || p.st?.readyState !== 'open' || p.st.bufferedAmount > 16384) continue;
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

  private setBadge(text: string) {
    this.badge.textContent = text;
  }

  private refresh() {
    if (this.role === 'client') this.setBadge('ONLINE ֲ· in room');
    else if (this.role === 'host' && this.peers.size > 0) this.setBadge(`ONLINE ${this.humans()}/${MAX_HUMANS} ֲ· host`);
    else if (this.role === 'host') this.setBadge('Room open ֲ· waiting for players');
    else this.setBadge('Looking for a roomג€¦');
  }
}

let instance: SosNet | null = null;

export function startNet(ctx: Ctx) {
  if (instance) return;
  const q = new URLSearchParams(location.search);
  if (q.get('net') === '0' || q.get('solo') === '1') return;
  if (typeof RTCPeerConnection === 'undefined' || typeof WebSocket === 'undefined') return;
  try { instance = new SosNet(ctx); } catch (err) { console.warn('[net] disabled', err); }
}
