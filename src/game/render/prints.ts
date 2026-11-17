// Ink footprints: as a 먹동이 walks or runs it leaves small ink-wash dabs, left and right, at each foot plant,
// fading over ~2.5 s; a roll leaves one long dry-brush smear. One InstancedMesh used as a ring buffer (PN prints,
// oldest overwritten); per-print birth/strength/kind live in an instanced attribute and the shader does the
// fade, so nothing moves per frame (only uTime). Drawn on the ground above the ground and its baked shadows,
// under the route preview (route.ts, renderOrder -2) and the telegraphs (overlay). Colour only is blended so the
// scene target's alpha codes (ink, dye, water) stay as they are.
// Geometry and material are module-level, OWNED here and alive all session (like fx.ts decals).

import * as THREE from "three";
import { camFocus, feel, onQuality, scene } from "./gfx";
import { ring } from "./fx";

const PN = 40;
const LIFE = 2.5;
/** a remote player's prints show only this close to the camera's focus (the local player) */
const REMOTE_NEAR = 15;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // local z = along the step, x = across
const info = new THREE.InstancedBufferAttribute(new Float32Array(PN * 4).fill(-100), 4); // birth, strength, kind, life
geo.setAttribute("aInfo", info);
const mat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    attribute vec4 aInfo; uniform float uTime;
    varying vec2 vP; varying float vAge, vU, vStr, vKind, vSeed;
    void main(){
      vP = vec2(position.x, -position.z) * 2.0; // -1..1, +y toward where the foot was going
      vAge = uTime - aInfo.x; vU = vAge / aInfo.w; vStr = aInfo.y; vKind = aInfo.z; vSeed = fract(aInfo.x * 3.71);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vP; varying float vAge, vU, vStr, vKind, vSeed;
    float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
    void main(){
      if (vU < 0.0 || vU > 1.0) discard;
      vec2 p = vP;
      float a;
      if (vKind < 0.5) {
        // a dab: an egg a little wider at the toe, ink pooling at the rim, the rim broken by dry-brush streaks
        float r = length(vec2(p.x / (0.86 + 0.14 * p.y), p.y));
        float edge = 0.8 + 0.18 * n(vec2(atan(p.y, p.x) * 2.5 + vSeed * 17.0, vSeed * 5.0));
        float m = 1.0 - smoothstep(edge - 0.16, edge, r);
        float dry = n(vec2(p.x * 8.0 + vSeed * 31.0, p.y * 1.4));
        m *= mix(1.0, smoothstep(0.28, 0.62, dry), smoothstep(0.3, 0.9, r));
        a = m * (0.6 + 0.3 * smoothstep(0.25, 0.85, r)) * (0.85 + 0.3 * n(p * 5.0 + vSeed * 9.0));
      } else {
        // a roll's smear: swells in the middle and thins to both ends, drawn out along its length as the roll goes
        float t = p.y * 0.5 + 0.5;
        if (t > clamp(vAge / 0.32, 0.0, 1.0)) discard;
        float w = 0.3 + 0.7 * pow(sin(t * 3.14159), 0.6);
        float m = 1.0 - smoothstep(w - 0.3, w, abs(p.x));
        float dry = n(vec2(p.x * 6.0 + vSeed * 13.0, t * 2.5));
        m *= smoothstep(0.2, 0.55, dry + 0.4 * (1.0 - abs(p.x) / max(w, 0.05)));
        a = m * 0.68;
      }
      a *= vStr * (1.0 - smoothstep(0.45, 1.0, vU));
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.05, 0.047, 0.05, a);
    }`,
});
const mesh = new THREE.InstancedMesh(geo, mat, PN);
mesh.frustumCulled = false;
mesh.renderOrder = -3; // under the route preview (-2)
for (let i = 0; i < PN; i++) mesh.setMatrixAt(i, ZERO);
mesh.onBeforeRender = () => { mat.uniforms.uTime.value = feel.time; };
scene.add(mesh);

const dummy = new THREE.Object3D();
let next = 0;
/** low: own prints only, fewer of them (a shorter ring) and shorter-lived */
let cap = PN, life = LIFE, remoteKeep = 3, ripples = true;
onQuality((l) => {
  cap = l === "low" ? 20 : PN;
  life = l === "low" ? 1.6 : LIFE;
  remoteKeep = l === "low" ? 0 : l === "mid" ? 2 : 3; // of every 5 remote steps
  ripples = l !== "low";
  if (next >= cap) next = 0;
});

/** the zone's still water as flat ellipses [x, z, rx, rz, ...]: no prints there, a ripple instead */
let water: readonly number[] | null = null;
export function setPrintWater(list: readonly number[] | null): void {
  water = list;
}
function onWater(x: number, z: number): boolean {
  if (!water) return false;
  for (let i = 0; i < water.length; i += 4) {
    const ex = (x - water[i]) / water[i + 2], ez = (z - water[i + 1]) / water[i + 3];
    if (ex * ex + ez * ez < 1) return true;
  }
  return false;
}
const RIPPLE: [number, number, number] = [0.32, 0.34, 0.38];

function put(x: number, z: number, dx: number, dz: number, w: number, len: number, str: number, kind: number, lf: number): void {
  dummy.position.set(x, 0.028, z);
  dummy.rotation.set(0, Math.atan2(dx, dz) + Math.PI, 0); // local -z (the dab's +y) along (dx, dz)
  dummy.scale.set(w, 1, len);
  dummy.updateMatrix();
  mesh.setMatrixAt(next, dummy.matrix);
  info.setXYZW(next, feel.time, str, kind, lf);
  next = (next + 1) % cap;
  mesh.instanceMatrix.needsUpdate = true;
  info.needsUpdate = true;
}

/**
 * A foot plants at step `k` (alternate feet by parity) of an actor at (x, z) moving along the unit (dx, dz).
 * `dark`: the first step after landing. Remote players: lighter, sparser, only near the local player.
 */
export function footPrint(x: number, z: number, dx: number, dz: number, k: number, remote: boolean, dark: boolean): void {
  if (remote) {
    if ((k * 7) % 5 >= remoteKeep) return;
    if (Math.abs(x - camFocus.x) > REMOTE_NEAR || Math.abs(z - camFocus.z) > REMOTE_NEAR) return;
  }
  const side = k & 1 ? 0.17 : -0.17;
  const px = x + dx * 0.22 - dz * side, pz = z + dz * 0.22 + dx * side;
  if (onWater(px, pz)) {
    if (ripples && !remote) ring(px, pz, 0.32, RIPPLE, 0.5);
    return;
  }
  const str = (remote ? 0.55 : 1) * (dark ? 1.45 : 1) * (0.9 + Math.random() * 0.2);
  put(px, pz, dx, dz, 0.34, 0.52, str, 0, life * (dark ? 1.2 : 1));
}

/** A roll from (x, z) along the unit (dx, dz) for `len` metres: one long smear drawn out as it goes. */
export function rollPrint(x: number, z: number, dx: number, dz: number, len: number, remote: boolean): void {
  if (remote && (remoteKeep === 0 || Math.abs(x - camFocus.x) > REMOTE_NEAR || Math.abs(z - camFocus.z) > REMOTE_NEAR)) return;
  const cx = x + dx * len * 0.5, cz = z + dz * len * 0.5;
  if (onWater(cx, cz)) {
    if (ripples && !remote) ring(cx, cz, 0.6, RIPPLE, 0.6);
    return;
  }
  put(cx, cz, dx, dz, 0.62, len, remote ? 0.55 : 1, 1, life * 1.3);
}

/** Zone change: every print goes. */
export function clearPrints(): void {
  for (let i = 0; i < PN; i++) { mesh.setMatrixAt(i, ZERO); info.setX(i, -100); }
  mesh.instanceMatrix.needsUpdate = true;
  info.needsUpdate = true;
  next = 0;
}
