// Shared materials and geometries. Everything here lives for the whole session and is never disposed
// (SHARED). Per-zone baked geometry is created and disposed in world.ts.

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

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
// cloth (scarf, sash tails, the scarf's neck loop) carries fold shading in its vertex colors
export const M_inkClothFlat = new THREE.MeshBasicMaterial({ color: 0x2b2926, side: THREE.DoubleSide, vertexColors: true });
/** Ribbons (scarf, sash tails) have no normals, so dyed cloth is unlit (SHARED). */
export function dyeCloth(hex: number | null): THREE.MeshBasicMaterial {
  if (hex == null) return M_inkClothFlat;
  let m = clothCache.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex, ...DYE, vertexColors: true });
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

function actorShadowGeo(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  // the shader stretches it along the light, so cull with a generous sphere
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
  return g;
}

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
  /** actor/monster shadow decal: a unit quad the M_shadow shader lays out along the light (see below) */
  shadow: actorShadowGeo(),
  seg: new THREE.CylinderGeometry(1, 1, 1, 8),
  head: new THREE.SphereGeometry(1, 16, 12),
  eye: new THREE.SphereGeometry(1, 8, 6),
  ico: new THREE.IcosahedronGeometry(1, 0),
};

/**
 * Actor and monster shadows (SHARED; actor.ts and monsters.ts place one per body at its feet, scaled to
 * its size): a soft ink contact pool plus a short tail cast away from the zone's light, with a dry-brush
 * edge. The quad is rebuilt in world space in the vertex shader, so the body's rotation never matters.
 * Only color is blended; the target's alpha (dyed / water codes) is left untouched.
 */
const actorShadowU = {
  uCastDir: { value: new THREE.Vector2(0.4, 0.9) },
  uCastLen: { value: 2.0 },
  uShadowA: { value: new THREE.Vector2(0.5, 0.32) },
};
export const M_shadow = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  uniforms: actorShadowU,
  vertexShader: /* glsl */ `
    uniform vec2 uCastDir; uniform float uCastLen;
    varying vec2 vQ; varying vec2 vW; varying float vS; varying float vLen;
    void main(){
      vec3 c = modelMatrix[3].xyz;
      float s = length(modelMatrix[0].xyz);
      vec2 C = uCastDir, P = vec2(-C.y, C.x);
      float len = s * uCastLen;
      float along = mix(-s * 1.25, len + s * 0.8, position.z * 0.5 + 0.5);
      float across = -position.x * s * 1.25; // keeps the quad's winding facing up
      vec2 q = C * along + P * across;
      vQ = vec2(along, across); vS = s; vLen = len; vW = c.xz + q;
      gl_Position = projectionMatrix * viewMatrix * vec4(c.x + q.x, c.y, c.z + q.y, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec2 uShadowA;
    varying vec2 vQ; varying vec2 vW; varying float vS; varying float vLen;
    float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
    void main(){
      float along = vQ.x, across = vQ.y, s = vS;
      float edge = (n(vW * 7.0) - 0.5) * 0.35 + (n(vW * 2.2) - 0.5) * 0.25;
      // contact pool at the feet
      float r = length(vec2(along, across)) / s + edge * 0.5;
      float pool = 1.0 - smoothstep(0.45, 1.0, r);
      // the cast: narrowing and thinning toward its tip
      float t = clamp(along / max(vLen, 0.001), 0.0, 1.0);
      float w = s * (0.62 - 0.32 * t);
      float tail = (1.0 - smoothstep(w * 0.55, w, abs(across) + edge * s * 0.4)) * step(0.0, along)
                 * (1.0 - smoothstep(0.6, 1.0, t + edge * 0.2)) * (1.0 - 0.55 * t);
      float a = max(pool * uShadowA.x, tail * uShadowA.y);
      a *= 0.8 + 0.35 * n(vW * 13.0);
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.03, 0.03, 0.05, clamp(a, 0.0, 0.92));
    }`,
});
/** Lays the actor shadows along a mood's light: sun [azimuth, elevation] deg, shade [strength, ...]. */
export function setActorShadow(sun: readonly number[], shade: readonly number[]): void {
  const az = (sun[0] * Math.PI) / 180, el = (sun[1] * Math.PI) / 180;
  // shadows fall away from the light
  actorShadowU.uCastDir.value.set(-Math.cos(az), -Math.sin(az)).normalize();
  actorShadowU.uCastLen.value = Math.min(4.6, Math.max(0.35, 2.1 / Math.tan(el)));
  // the scene is lit in linear space, so a visible ink step needs a deep multiply
  actorShadowU.uShadowA.value.set(0.8 + shade[0] * 0.15, 0.5 + shade[0] * 0.4);
}
export const M_ink = lam(0x141312);
export const M_enemy = lam(0x1d1b1a);
export const M_flash = new THREE.MeshBasicMaterial({ color: 0xf4efe4 });
export const M_eye = new THREE.MeshBasicMaterial({ color: 0xffffff });

/* ---------- ground: one lit material whose shader paints ink-wash pools, dry-brush drags, a worn path
   and flagstone cracks in world space (SHARED; setGround retunes it per zone) ---------- */
const groundU = {
  uR: { value: 30 },
  uStone: { value: 0 },
  uWash: { value: 0.4 },
  /** the zone's baked scenery shadow (world-space mask over uShadeBox: min x, min z, size) */
  tShade: { value: null as THREE.Texture | null },
  uShadeBox: { value: new THREE.Vector3(-40, -40, 80) },
  uShadeK: { value: 0 },
};
export const groundMat = new THREE.MeshLambertMaterial({ color: 0xb7b08f });
groundMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, groundU);
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vGW;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  sh.fragmentShader = sh.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `#include <common>
varying vec3 vGW;
uniform float uR, uStone, uWash, uShadeK;
uniform sampler2D tShade;
uniform vec3 uShadeBox;
float gh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1, 0)), u.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), u.x), u.y); }
float gf(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * gn(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return v / 0.9375; }
// distance to the nearest cell border (flagstones)
float cellEdge(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(gh(i + g), gh(i + g + 17.3)) * 0.8 + 0.1;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}`,
    )
    .replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
{
  vec2 w = vGW.xz;
  float f = 1.0;
  f *= 1.0 - uWash * smoothstep(0.45, 0.82, gf(w * vec2(0.04, 0.055) + 3.0)); // broad ink-wash pools
  f *= 0.84 + 0.3 * gf(w * 0.25);                                      // mottling
  f *= 1.0 - 0.12 * smoothstep(0.62, 0.92, gn(vec2(w.x * 0.14, w.y * 1.1) + 7.0)); // dry-brush drags
  // the worn way from the south gate to the north one, flagged with stones where uStone > 0
  float t = (uR - 1.0 - w.y) / (uR * 2.0 - 2.0);
  float pd = abs(w.x - sin(t * 5.0 + uR) * 2.2) + (gn(w * 0.7) - 0.5) * 1.1;
  float onPath = (1.0 - smoothstep(1.4, 2.2, pd)) * (1.0 - smoothstep(uR, uR + 3.0, abs(w.y)));
  f = mix(f, 1.16, onPath * 0.6);
  // flagstones: thin cracks, worn away in patches, each stone a slightly different wash
  float crack = 1.0 - smoothstep(0.015, 0.06, cellEdge(w * vec2(0.72, 0.95)));
  crack *= smoothstep(0.12, 0.42, gn(w * 0.45 + 11.0));
  f *= 1.0 - crack * onPath * uStone * 0.5;
  f *= 1.0 - 0.08 * (smoothstep(1.3, 1.9, pd) - smoothstep(1.9, 2.6, pd));
  // baked scenery shadow: a wash a couple of tones down, never black (the ink pass quantizes it)
  if (uShadeK > 0.0) {
    vec2 su = (w - uShadeBox.xy) / uShadeBox.z;
    float inBox = step(0.0, su.x) * step(su.x, 1.0) * step(0.0, su.y) * step(su.y, 1.0);
    f *= 1.0 - uShadeK * texture2D(tShade, clamp(su, 0.0, 1.0)).r * inBox;
  }
  diffuseColor.rgb *= f;
}`,
    );
};
/** Retunes the shared ground for a zone: base color, walkable radius (path shape), flagstones, wash. */
export function setGround(hex: number, radius: number, stone: number, wash: number): void {
  groundMat.color.setHex(hex);
  groundU.uR.value = radius;
  groundU.uStone.value = stone;
  groundU.uWash.value = wash;
}

/** Hands the ground its baked shadow mask (null = none) and how dark it paints. */
export function setGroundShade(tex: THREE.Texture | null, box: THREE.Vector3 | null, strength: number): void {
  groundU.tShade.value = tex;
  if (box) groundU.uShadeBox.value.copy(box);
  groundU.uShadeK.value = tex ? strength : 0;
}

/** Water writes alpha ~0.05: the ink pass mirrors the painted sky into it (SHARED). */
// Its color only shows where a filtered sample straddles the shore (read as "dyed"), so it is bank-dark.
export const waterMat = new THREE.MeshBasicMaterial({
  color: 0x2a3038, opacity: 0.05, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
});
/** A gate between the camera and the player turns to a pale wash (SHARED; world.ts sets its opacity). */
export const gateFadeMat = new THREE.MeshLambertMaterial({ color: 0x2a2724, transparent: true, opacity: 1, depthWrite: false });
/** Grass, reeds: thin blades seen from both sides (SHARED). */
export const M_blade = new THREE.MeshLambertMaterial({ color: 0x3a4632, side: THREE.DoubleSide });
export const M_bladeDark = new THREE.MeshLambertMaterial({ color: 0x232a20, side: THREE.DoubleSide });

/** A clump of tapered blades fanning out from one root, height 1 (SHARED geometry). */
function bladeClump(n: number, lean: number, seed: number): THREE.BufferGeometry {
  const pos: number[] = [];
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8;
    const h = 0.6 + r() * 0.4, w = 0.035 + r() * 0.03, l = lean * (0.5 + r());
    const ca = Math.cos(a), sa = Math.sin(a);
    // two segments, bending outward
    const mx = ca * l * 0.35, mz = sa * l * 0.35, tx = ca * l, tz = sa * l;
    const px = -sa * w, pz = ca * w;
    pos.push(-px, 0, -pz, px, 0, pz, mx + px * 0.6, h * 0.55, mz + pz * 0.6);
    pos.push(-px, 0, -pz, mx + px * 0.6, h * 0.55, mz + pz * 0.6, mx - px * 0.6, h * 0.55, mz - pz * 0.6);
    pos.push(mx - px * 0.6, h * 0.55, mz - pz * 0.6, mx + px * 0.6, h * 0.55, mz + pz * 0.6, tx, h, tz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}
/**
 * Low lumpy stone for walls and shores (SHARED geometry). Indexed like the baked rocks, so the baker can
 * merge both into one mesh per material.
 */
function lumpStone(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const out = mergeVertices(g, 1e-4);
  g.dispose();
  const p = out.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.82 + 0.3 * Math.abs(Math.sin(x * 3.1 + y * 5.3 + z * 2.7));
    p.setXYZ(i, x * k, (y < 0 ? y * 0.4 : y) * k, z * k);
  }
  out.computeVertexNormals();
  out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  return out;
}
export const G2 = {
  tuft: bladeClump(6, 0.22, 11),
  reed: bladeClump(9, 0.12, 29),
  stone: lumpStone(),
  /** low-poly cushion for pine crowns (many per tree, so cheap) */
  cushion: new THREE.SphereGeometry(1, 7, 4),
};

/*
 * Figures (먹동이, other players, NPCs) are painted, not modelled: one SHARED lit material whose shader
 * keeps a dark ink core, lifts a lighter wash toward the silhouette, adds grain, and frays the outermost
 * edge into dry-brush splits (noise in the stroke's own space, so it never swims). Still the darkest thing
 * on screen; the ink pass outlines it as before.
 */
export const M_body = new THREE.MeshLambertMaterial({ color: 0x121112 });
M_body.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vStroke;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStroke = position;");
  sh.fragmentShader = sh.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
varying vec3 vStroke;
float bh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bh(i), bh(i + vec3(1, 0, 0)), f.x), mix(bh(i + vec3(0, 1, 0)), bh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bh(i + vec3(0, 0, 1)), bh(i + vec3(1, 0, 1)), f.x), mix(bh(i + vec3(0, 1, 1)), bh(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`,
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
{
  float rim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
  // dry brush: the stroke's edge splits along its length
  float fray = bn(vec3(vStroke.x * 9.0, vStroke.y * 2.2, vStroke.z * 9.0));
  if (rim > 0.7 + fray * 0.22 && fray > 0.46) discard;
  float grain = bn(vStroke * 24.0), wash = bn(vec3(vStroke.x * 3.0, vStroke.y * 0.8, vStroke.z * 3.0));
  // a dark core; toward the silhouette the ink thins into a grey wash (the ink pass reads it a tone or two lighter)
  float edge = smoothstep(0.4, 0.97, rim) * (0.55 + 0.45 * wash);
  diffuseColor.rgb = mix(diffuseColor.rgb * (0.8 + 0.5 * grain), vec3(0.13, 0.125, 0.12) * (0.8 + 0.4 * grain), edge);
  // dry-brush streaks along the stroke: grey hairs where the brush ran out of ink
  float dry = bn(vec3(vStroke.x * 26.0, vStroke.y * 1.4, vStroke.z * 26.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.096, 0.09), smoothstep(0.6, 0.78, dry) * 0.55);
}`,
    );
};
