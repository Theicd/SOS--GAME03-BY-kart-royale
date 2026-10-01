import * as THREE from 'three';
import { MOOD_LOOK } from './Mood';

/**
 * Lite tier: swap the PBR materials for Lambert ones, keeping colour, texture
 * and glow. The physical family (clearcoat, IBL, specular) is by far the most
 * expensive per-pixel cost left once the composer is gone, and on a phone it
 * is most of the frame.
 *
 * Left alone, on purpose:
 *  - anything with its own `onBeforeCompile` — those carry the game's custom
 *    lighting and shading and would lose it (or fail to compile);
 *  - transparent / faded materials — other systems animate their opacity on
 *    the original instance, and a copy would stop fading.
 *
 * Runs once after the world is built and before the shader prewarm, so the
 * programs compiled up front are the cheap ones.
 */
export function applyLiteMaterials(scene: THREE.Scene): number {
  const baseHook = THREE.Material.prototype.onBeforeCompile;
  const swapped = new Map<THREE.Material, THREE.Material>();

  const convert = (mat: THREE.Material): THREE.Material => {
    const std = mat as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return mat;
    if (mat.onBeforeCompile !== baseHook) return mat;
    if (mat.transparent || mat.opacity < 1) return mat;
    let out = swapped.get(mat);
    if (!out) {
      const lam = new THREE.MeshLambertMaterial({
        name: mat.name,
        color: std.color,
        map: std.map,
        alphaMap: std.alphaMap,
        alphaTest: std.alphaTest,
        emissive: std.emissive,
        emissiveMap: std.emissiveMap,
        emissiveIntensity: std.emissiveIntensity,
        vertexColors: std.vertexColors,
        side: std.side,
        fog: std.fog,
        flatShading: std.flatShading,
        depthWrite: std.depthWrite,
        depthTest: std.depthTest,
        polygonOffset: std.polygonOffset,
        polygonOffsetFactor: std.polygonOffsetFactor,
        polygonOffsetUnits: std.polygonOffsetUnits,
        toneMapped: std.toneMapped,
      });
      lam.userData = mat.userData;
      out = lam;
      swapped.set(mat, out);
    }
    return out;
  };

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });

  // Lambert does not read `scene.environment`, which was most of the fill in
  // shade; a warm ambient stands in for it so the swapped surfaces are not dim.
  if (swapped.size) {
    const fill = new THREE.AmbientLight(MOOD_LOOK ? MOOD_LOOK.liteAmbient : 0xffe6cc, 0.9);
    fill.name = 'LiteFill';
    scene.add(fill);
  }
  return swapped.size;
}
