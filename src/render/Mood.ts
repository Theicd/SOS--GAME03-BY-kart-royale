/**
 * Map mood — the same circuit under a different sky. `sunset` is the authored
 * look and changes nothing; every other mood is a set of overrides applied at
 * boot by the systems that own the values (Sky, Water, PostFX, Lite).
 *
 * Chosen with `?map=winter`; a plain launch is always Sunset. Switching reloads.
 */
import * as THREE from 'three';

export type MoodId = 'sunset' | 'winter';

export const MOOD_NAMES: Record<MoodId, string> = {
  sunset: 'Sunset Bay',
  winter: 'Winter Bay',
};

function readMood(): MoodId {
  let v: string | null = null;
  try { v = new URLSearchParams(location.search).get('map'); } catch { /* no location */ }
  return v === 'winter' ? 'winter' : 'sunset';
}

export const MOOD: MoodId = readMood();
export const WINTER = MOOD === 'winter';

/** Overcast winter: grey deck, cold dim sun glowing through it, muted colour. */
export const WINTER_LOOK = {
  // sky dome, linear
  overcastHorizon: new THREE.Vector3(0.33, 0.36, 0.41),
  overcastZenith: new THREE.Vector3(0.19, 0.22, 0.27),
  overcastAmount: 0.95,
  cloudCover: 0.12,
  cloudSun: new THREE.Vector3(0.30, 0.32, 0.36),
  cloudAmbient: new THREE.Vector3(0.19, 0.21, 0.25),
  sunDiscScale: 0.05,
  haze: new THREE.Vector3(0.33, 0.36, 0.41),
  ground: new THREE.Vector3(0.10, 0.11, 0.13),
  // lights
  sunColor: 0xdde4ee,
  sunIntensity: 0.5,
  fillColor: 0xaab4c2,
  fillIntensity: 1.0,
  bounceColor: 0x80848c,
  bounceIntensity: 0.6,
  probeSaturation: 0.35,
  probeIntensity: 0.9,
  // post
  saturation: 0.8,
  liteAmbient: 0xc6ced8,
};
