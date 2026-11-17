// Shared materials and geometries. Everything here lives for the whole session and is never disposed
// (SHARED). Per-zone baked geometry is created and disposed in world.ts.

import * as THREE from "three";

const litCache = new Map<number, THREE.MeshLambertMaterial>();
/** Plain lit material, cached by color (SHARED). */
export function lam(hex: number): THREE.MeshLambertMaterial {
  let m = litCache.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    litCache.set(hex, m);
  }
  return m;
}

// "Dyed" materials write alpha 0.5 into the scene target; the ink pass keeps their color.
const DYE: THREE.MaterialParameters = {
  side: THREE.DoubleSide,
  opacity: 0.5,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.ZeroFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.ZeroFactor,
};
const dyeCache = new Map<number, THREE.MeshLambertMaterial>();
/** Lit dyed material (keeps its color in the ink world), cached by color (SHARED). */
export function dyeMat(hex: number): THREE.MeshLambertMaterial {
  let m = dyeCache.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, ...DYE });
    dyeCache.set(hex, m);
  }
  return m;
}
const clothCache = new Map<number, THREE.MeshBasicMaterial>();
export const M_inkClothFlat = new THREE.MeshBasicMaterial({ color: 0x2b2926, side: THREE.DoubleSide });
/** Ribbons (scarf, sash tails) have no normals, so dyed cloth is unlit (SHARED). */
export function dyeCloth(hex: number | null): THREE.MeshBasicMaterial {
  if (hex == null) return M_inkClothFlat;
  let m = clothCache.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex, ...DYE });
    clothCache.set(hex, m);
  }
  return m;
}

/** Scenery palette: real colors, only seen in ink until a skill light reveals them. */
export const M = {
  path: lam(0xbcae8e),
  rock: lam(0x8a877c),
  rockDark: lam(0x5f5c55),
  bamboo: lam(0x6fae4e),
  leaf: lam(0x3f8a3a),
  trunk: lam(0x6b4a3a),
  plum: lam(0xf09ab5),
  plum2: lam(0xfbd3df),
  maple: lam(0xe0592a),
  maple2: lam(0xf0a33a),
  willow: lam(0x8fbf5a),
  pine: lam(0x2f6a46),
  pillar: lam(0xc4402a),
  roof: lam(0x3b4650),
  beam: lam(0x2f8a7a),
  stone: lam(0xd8ccb0),
  wall: lam(0xe8e0cc),
  wood: lam(0x8a6a48),
  water: lam(0x4a88b0),
  lily: lam(0x5f9a48),
  lotus: lam(0xf2a0b8),
  lantern: lam(0xd8342a),
  gold: lam(0xd9a640),
  gate: lam(0x2a2724),
  gateRoof: lam(0x3b3632),
};

/** Shared unit geometries (SHARED; never disposed). */
export const G = {
  stalk: new THREE.CylinderGeometry(0.13, 0.15, 1, 7).translate(0, 0.5, 0),
  node: new THREE.CylinderGeometry(0.17, 0.17, 0.08, 7),
  leaf: new THREE.ConeGeometry(0.3, 1.6, 4).rotateZ(-Math.PI / 2).translate(0.8, 0, 0),
  trunk: new THREE.CylinderGeometry(0.16, 0.28, 1, 7).translate(0, 0.5, 0),
  ball: new THREE.SphereGeometry(1, 9, 7),
  box: new THREE.BoxGeometry(1, 1, 1),
  pyramid: new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4),
  cone: new THREE.ConeGeometry(1, 1, 9),
  pillar: new THREE.CylinderGeometry(1, 1, 1, 10),
  disc: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
  flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  shadow: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
  seg: new THREE.CylinderGeometry(1, 1, 1, 8),
  head: new THREE.SphereGeometry(1, 16, 12),
  eye: new THREE.SphereGeometry(1, 8, 6),
  ico: new THREE.IcosahedronGeometry(1, 0),
};

export const M_shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
export const M_ink = lam(0x141312);
export const M_enemy = lam(0x1d1b1a);
export const M_flash = new THREE.MeshBasicMaterial({ color: 0xf4efe4 });
export const M_eye = new THREE.MeshBasicMaterial({ color: 0xffffff });
