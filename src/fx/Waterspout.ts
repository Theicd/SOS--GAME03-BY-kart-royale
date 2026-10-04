import * as THREE from 'three';
import { RaceState, type Ctx, type System } from '../types';
import type { Race } from '../game/Race';
import type { Kart } from '../kart/Kart';
import { WINTER } from '../render/Mood';

const HEIGHT = 460;

// Track crossings, keyed off race time so every machine in a room sees the
// same storm: it leaves the bay, crawls over the road where the pack should
// be, and goes back out to sea.
/** race seconds each crossing starts */
const CROSS_AT = [10, 34];
/** seconds from one side of the road to the other */
const CROSS_S = 14;
/** seconds to travel between the bay and the crossing line */
const LEAD_IN = 10;
const LEAD_OUT = 10;
/** lateral reach of a crossing either side of the centreline, metres */
const SWEEP = 150;
/** rough race length, to aim each crossing at where the pack will be */
const LAP_EST = 58;
/** karts this close to the funnel's axis get thrown */
const GRAB_R = 9;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  float y = uv.y;
  // a thin rope at the water flaring into the cloud base, with a lazy S-bend
  float r = mix(5.0, 70.0, pow(y, 2.4)) + 4.0 * (1.0 - smoothstep(0.0, 0.05, y));
  float a = uv.x * 6.2831853;
  vec3 p = vec3(cos(a) * r, y * ${HEIGHT.toFixed(1)}, sin(a) * r);
  p.x += sin(y * 4.0 + uTime * 0.6) * 18.0 * y;
  p.z += cos(y * 3.0 + uTime * 0.45) * 12.0 * y;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 n = normalize(normalMatrix * vec3(cos(a), 0.0, sin(a)));
  vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vRim;
void main() {
  float y = vUv.y;
  // spiral bands climbing the funnel as it spins
  float sp = sin(vUv.x * 6.2831853 * 3.0 + y * 26.0 - uTime * 5.0);
  float sp2 = sin(vUv.x * 6.2831853 * 7.0 - y * 41.0 - uTime * 7.3);
  float bands = 0.55 + 0.3 * sp + 0.15 * sp2;
  float a = (0.35 + 0.65 * vRim) * bands;
  a *= smoothstep(0.0, 0.02, y) * (1.0 - smoothstep(0.82, 1.0, y));
  vec3 col = mix(vec3(0.16, 0.18, 0.2), vec3(0.3, 0.33, 0.37), bands * 0.6 + (1.0 - y) * 0.3);
  // spray skirt where it touches the sea
  col = mix(col, vec3(0.55, 0.6, 0.64), (1.0 - smoothstep(0.0, 0.06, y)) * 0.6);
  // storm haze between it and us
  col = mix(col, vec3(0.24, 0.27, 0.31), 0.3);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * 0.82);
}
`;

/**
 * Winter only: one waterspout wandering the bay that twice a race comes
 * ashore across the circuit and throws any kart it catches.
 * A single low-poly funnel with an animated shader - one draw call.
 */
export class Waterspout implements System {
  private mesh: THREE.Mesh | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private home = new THREE.Vector2();
  private placed = false;
  private found = false;
  private level = 0;
  private hitAt = new Map<number, number>();
  private readonly imp = new THREE.Vector3();

  init(ctx: Ctx) {
    if (!WINTER) return;
    const g = new THREE.CylinderGeometry(1, 1, 1, 28, 24, true);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'waterspout';
    this.mesh.frustumCulled = false;
    // parked under the world until placed, but visible so the boot prewarm compiles it
    this.mesh.position.y = -5000;
    ctx.scene.add(this.mesh);
  }

  /** Find open water: a ring round the circuit where nothing solid stands above the sea. */
  private place(ctx: Ctx) {
    this.placed = true;
    let road: THREE.Object3D | null = null;
    let sea: THREE.Object3D | null = null;
    const solid: THREE.Object3D[] = [];
    ctx.scene.traverse((o) => {
      if (o.name === 'road') road = o;
      else if (o.name === 'sea-surface') sea = o;
      else if (o.name === 'terrain' || o.name === 'backdrop') solid.push(o);
    });
    if (!road || !sea) { this.mesh!.visible = false; return; }
    const r = road as THREE.Mesh;
    if (!r.geometry.boundingSphere) r.geometry.computeBoundingSphere();
    const c = r.geometry.boundingSphere!.center;
    const level = (sea as THREE.Object3D).position.y;
    // Candidates on three rings; one pass over the land vertices records the
    // highest ground within 45 m of each, so no per-triangle ray tests.
    const cand: { x: number; z: number; top: number }[] = [];
    for (const rad of [720, 900, 560]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + 0.2;
        cand.push({ x: c.x + Math.cos(a) * rad, z: c.z + Math.sin(a) * rad, top: -Infinity });
      }
    }
    const v = new THREE.Vector3();
    const R2 = 45 * 45;
    for (const o of solid) {
      const m = o as THREE.Mesh;
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      m.updateMatrixWorld();
      for (let i = 0; i < pos.count; i += 2) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        for (const k of cand) {
          const dx = v.x - k.x, dz = v.z - k.z;
          if (dx * dx + dz * dz < R2 && v.y > k.top) k.top = v.y;
        }
      }
    }
    const open = cand.find((k) => k.top < level + 0.5);
    if (!open) { this.mesh!.visible = false; return; }
    this.home.set(open.x, open.z);
    this.mesh!.position.y = level;
    this.level = level;
    this.found = true;
  }

  update(ctx: Ctx) {
    if (!this.mesh || !this.mat) return;
    if (!this.placed && ctx.frame > 2) this.place(ctx);
    if (!this.found) return;
    const t = ctx.time;
    this.mat.uniforms.uTime.value = t;
    // roaming the bay
    let x = this.home.x + Math.sin(t * 0.021) * 70;
    let z = this.home.y + Math.cos(t * 0.017) * 70;
    let y = this.level;
    const race = ctx.race;
    const live = race.state === RaceState.Racing || race.state === RaceState.Finished;
    if (live) {
      const rt = race.raceTime;
      for (let i = 0; i < CROSS_AT.length; i++) {
        const e = rt - CROSS_AT[i];
        if (e < -LEAD_IN || e > CROSS_S + LEAD_OUT) continue;
        const s = ctx.track.sample(Math.min(0.96, Math.max(0.04, (CROSS_AT[i] + CROSS_S / 2) / LAP_EST)));
        const side = i % 2 ? -1 : 1;
        // cubic sweep: quick out at the edges, a slow crawl over the tarmac
        const k = clamp01(e / CROSS_S) * 2 - 1;
        const u = -side * k * k * k * SWEEP;
        const w0 = e < 0 ? 1 + e / LEAD_IN : e > CROSS_S ? 1 - (e - CROSS_S) / LEAD_OUT : 1;
        const w = w0 * w0 * (3 - 2 * w0);
        x += (s.pos.x + s.binormal.x * u - x) * w;
        z += (s.pos.z + s.binormal.z * u - z) * w;
        y += (s.pos.y - 0.6 - y) * w;
        break;
      }
    }
    this.mesh.position.set(x, y, z);
    if (live) this.fling(ctx, x, y, z);
  }

  /** Throw every kart this machine simulates that strays into the funnel. */
  private fling(ctx: Ctx, x: number, y: number, z: number) {
    const race = ctx.race as unknown as Race;
    const karts = race.karts as unknown as Kart[];
    for (let i = 0; i < karts.length; i++) {
      if (race.remote[i]) continue;
      const k = karts[i];
      const dx = k.position.x - x, dz = k.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > GRAB_R || k.position.y > y + 60) continue;
      if (ctx.time - (this.hitAt.get(i) ?? -10) < 3) continue;
      const before = k.stunTime;
      k.spinOut(1.4);
      if (k.stunTime <= before) continue;
      this.hitAt.set(i, ctx.time);
      const inv = 1 / Math.max(d, 0.5);
      // round the funnel, high up, and out - a long flight the player watches
      this.imp.set(-dz * inv * 11 + dx * inv * 6, 24, dx * inv * 11 + dz * inv * 6);
      k.launch(this.imp);
      race.toss(i, 3.2);
      if (k.isPlayer) ctx.bus.emit({ type: 'ui', name: 'tornado' });
    }
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mat?.dispose();
    this.mesh?.removeFromParent();
  }
}

export const waterspout = new Waterspout();
