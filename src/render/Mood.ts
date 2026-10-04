/**
 * Map mood — the same circuit under a different sky. `sunset` is the authored
 * look and changes nothing; every other mood is a set of overrides applied at
 * boot by the systems that own the values (Sky, Water, PostFX, Lite).
 *
 * Chosen with `?map=winter` / `?map=night`; a plain launch is always Sunset. Switching reloads.
 */
import * as THREE from 'three';

export type MoodId = 'sunset' | 'winter' | 'night';

export const MOOD_NAMES: Record<MoodId, string> = {
  sunset: 'Sunset Bay',
  winter: 'Winter Bay',
  night: 'Moonlight Bay',
};

function readMood(): MoodId {
  let v: string | null = null;
  try { v = new URLSearchParams(location.search).get('map'); } catch { /* no location */ }
  return v === 'winter' || v === 'night' ? v : 'sunset';
}

export const MOOD: MoodId = readMood();
export const WINTER = MOOD === 'winter';
export const NIGHT = MOOD === 'night';

/** Values a non-sunset mood overrides; optional fields default to the sunset behaviour. */
export interface MoodLook {
  overcastHorizon: THREE.Vector3;
  overcastZenith: THREE.Vector3;
  overcastAmount: number;
  cloudCover: number;
  cloudSun: THREE.Vector3;
  cloudAmbient: THREE.Vector3;
  sunDiscScale: number;
  /** replaces the disc colour outright (the moon is white, not a dimmed sun) */
  discColor?: THREE.Vector3;
  discRadiusScale?: number;
  haze: THREE.Vector3;
  ground: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  fillColor: number;
  fillIntensity: number;
  bounceColor: number;
  bounceIntensity: number;
  probeSaturation: number;
  probeIntensity: number;
  probeTint?: THREE.Vector3;
  saturation: number;
  liteAmbient: number;
  stars?: number;
}

/** Winter storm: a solid dark rain deck, no direct sun, flat cold light, muted colour. */
export const WINTER_LOOK: MoodLook = {
  // sky dome, linear
  overcastHorizon: new THREE.Vector3(0.26, 0.29, 0.34),
  overcastZenith: new THREE.Vector3(0.10, 0.115, 0.145),
  overcastAmount: 0.95,
  cloudCover: 0.5,
  cloudSun: new THREE.Vector3(0.2, 0.21, 0.24),
  cloudAmbient: new THREE.Vector3(0.1, 0.11, 0.13),
  sunDiscScale: 0,
  haze: new THREE.Vector3(0.26, 0.29, 0.34),
  ground: new THREE.Vector3(0.08, 0.09, 0.11),
  // lights
  sunColor: 0xdde4ee,
  sunIntensity: 0.2,
  fillColor: 0xaab4c2,
  fillIntensity: 1.35,
  bounceColor: 0x80848c,
  bounceIntensity: 0.6,
  probeSaturation: 0.35,
  probeIntensity: 0.9,
  // post
  saturation: 0.8,
  liteAmbient: 0xc6ced8,
};

/** Moonlight: black starry sky, white moon where the sun was, the warm glow turned to a cool mist. */
export const NIGHT_LOOK: MoodLook = {
  overcastHorizon: new THREE.Vector3(0.030, 0.040, 0.070),
  overcastZenith: new THREE.Vector3(0.002, 0.003, 0.008),
  overcastAmount: 1.0,
  cloudCover: -0.10,
  cloudSun: new THREE.Vector3(0.060, 0.070, 0.100),
  cloudAmbient: new THREE.Vector3(0.012, 0.015, 0.026),
  sunDiscScale: 1,
  discColor: new THREE.Vector3(2.6, 2.75, 3.1),
  discRadiusScale: 1.8,
  haze: new THREE.Vector3(0.036, 0.046, 0.072),
  ground: new THREE.Vector3(0.006, 0.008, 0.012),
  sunColor: 0xbccbff,
  sunIntensity: 0.34,
  fillColor: 0x46568a,
  fillIntensity: 0.5,
  bounceColor: 0x2c3448,
  bounceIntensity: 0.3,
  probeSaturation: 0.45,
  probeIntensity: 0.4,
  probeTint: new THREE.Vector3(0.75, 0.86, 1.3),
  saturation: 0.85,
  liteAmbient: 0x58689a,
  stars: 1,
};

export const MOOD_LOOK: MoodLook | null = WINTER ? WINTER_LOOK : NIGHT ? NIGHT_LOOK : null;
