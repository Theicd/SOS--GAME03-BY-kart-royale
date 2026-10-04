import * as THREE from 'three';
import type { Ctx, System } from '../types';
import { WINTER } from '../render/Mood';

/** Half-size of the wrap box that follows the camera, metres. */
const BOX = new THREE.Vector3(70, 14, 70);

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec2 uWind;
uniform float uPx;
varying float vKind;
varying float vFade;
varying float vSpin;
void main() {
  // all snow; the leaf branch is kept off (1.0 = a dry leaf, bigger, slower, tumbling)
  float leaf = 0.0;
  // snowflake pace: ~1 m/s down, a gentle sideways drift
  float spd = mix(1.3, 8.0, leaf) * (0.75 + aSeed.w * 0.5);
  float gust = 1.0 + 0.3 * sin(uTime * 0.4 + aSeed.x * 6.0);
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * spd * gust * uTime;
  drift.y = -uTime * mix(0.8 + aSeed.y * 0.5, 0.4, leaf) + sin(uTime * 0.9 + aSeed.y * 20.0) * mix(0.15, 1.8, leaf);
  vec3 swirl = vec3(sin(uTime * 0.8 + aSeed.y * 31.0), 0.0, cos(uTime * 0.7 + aSeed.x * 17.0)) * mix(0.45, 2.2, leaf);
  vec3 size = uBox * 2.0;
  vec3 p = aSeed.xyz * size + drift + swirl - (uCam - uBox);
  p = mod(p, size) + uCam - uBox;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  vKind = leaf;
  vSpin = uTime * (3.0 + aSeed.x * 5.0) + aSeed.z * 6.28;
  // fade at the wrap edges and very close to the lens
  vec3 rel = abs(p - uCam) / uBox;
  vFade = (1.0 - smoothstep(0.75, 1.0, max(rel.x, max(rel.y, rel.z)))) * smoothstep(0.6, 2.5, dist);
  gl_PointSize = clamp(uPx * mix(0.09, 0.22, leaf) / max(dist, 0.1), 1.5, mix(13.0, 26.0, leaf));
}
`;

const FRAG = /* glsl */ `
varying float vKind;
varying float vFade;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a;
  vec3 col;
  if (vKind > 0.5) {
    // a tumbling leaf: an ellipse whose width flips with the spin
    float s = sin(vSpin), k = cos(vSpin);
    vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
    r.x /= 0.25 + 0.75 * abs(sin(vSpin * 0.7));
    a = 1.0 - smoothstep(0.3, 0.5, length(r * vec2(1.0, 1.9)));
    col = mix(vec3(0.33, 0.24, 0.14), vec3(0.5, 0.38, 0.2), abs(s));
  } else {
    a = 1.0 - smoothstep(0.1, 0.5, length(c));
    col = vec3(0.86, 0.9, 0.96);
  }
  a *= vFade;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a * (vKind > 0.5 ? 0.95 : 0.7));
}
`;

/**
 * Winter only: snow blowing through the shot on the storm wind.
 * One draw call; every particle's path is a function of time evaluated on the
 * GPU inside a box that wraps round the camera, so there is no CPU update.
 */
export class WinterWind implements System {
  private pts: THREE.Points | null = null;
  private mat: THREE.ShaderMaterial | null = null;

  init(ctx: Ctx) {
    if (!WINTER) return;
    const n = ctx.settings.lite ? 380 : 900;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uWind: { value: new THREE.Vector2(0.86, 0.51) },
        uPx: { value: 600 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.name = 'winter-wind';
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 9;
    ctx.scene.add(this.pts);
  }

  update(ctx: Ctx) {
    if (!this.mat) return;
    const u = this.mat.uniforms;
    u.uTime.value = ctx.time;
    (u.uCam.value as THREE.Vector3).copy(ctx.camera.position);
    u.uPx.value = ctx.height * 1.1;
  }

  dispose() {
    this.pts?.geometry.dispose();
    this.mat?.dispose();
    this.pts?.removeFromParent();
  }
}

export const winterWind = new WinterWind();
