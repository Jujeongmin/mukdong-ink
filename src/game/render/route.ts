// Route preview on the ground (auto-travel, or hovering 자동 진행), painted like the rest of the world:
// - a line of see-through brush arrows (›) from the player toward the next waypoint, crawling toward the
//   goal and fading in at the feet and out at the far end;
// - at a portal: two brush chevrons sliding on through it;
// - at a destination here: an ensō, one thick-to-thin circular stroke with a gap.
// Drawn in the OVERLAY pass (after the ink post-process) so fog, rain and the tone bands never wash it out,
// but each fragment tests the scene's depth (`behindScene`), so figures and props stand in front of it.
// One InstancedMesh (matrices + a per-dab seed/alpha attribute updated in place) and two marker quads; all
// geometry and materials are created once (OWNED here, disposed in dispose()). Quality-aware spacing.

import * as THREE from "three";
import { GROUND_DEPTH_GLSL, camera, groundDepthU, onQuality, overlay } from "./gfx";

const MAX_DOTS = 48;
const Y = 0.04;
/** Route marks are see-through so the ground and its figures stay readable under them. */
const ROUTE_ALPHA = 0.55;
const INK = new THREE.Color(0x17130f);
const WASH = new THREE.Color(0xe9e0cf);

const NOISE_GLSL = `
#define ROUTE_ALPHA ${ROUTE_ALPHA.toFixed(2)}
float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

const VERT = `
attribute vec2 aDab;
varying vec2 vUv;
varying vec2 vDab;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING
  vDab = aDab;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vDab = vec2(0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#endif
}`;

/** Ink over a pale wash that bleeds a little past the stroke, so it reads on dark and light ground alike. */
const INK_OUT = `
  float a = max(m, halo * 0.32) * alpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(mix(uWash, uInk, smoothstep(0.0, 0.5, m)), a);`;

/** One arrow: a brush chevron (›) pointing along travel (+y), a little rough at the edges. */
const DAB_FRAG = `
uniform vec3 uInk, uWash;
varying vec2 vUv;
varying vec2 vDab; // seed, alpha
${GROUND_DEPTH_GLSL}
${NOISE_GLSL}
void main() {
  if (behindScene()) discard;
  vec2 p = vUv - 0.5;
  float ax = abs(p.x), seed = vDab.x;
  if (ax > 0.42) discard;
  // thick at the point, thinning toward the arm ends
  float th = mix(0.135, 0.05, ax / 0.42);
  float rough = (rn(vec2(ax * 28.0 + seed * 9.0, p.y * 6.0)) - 0.5) * 0.025;
  float d = abs(p.y - (0.16 - ax * 0.85)) * 0.76 + rough;
  float m = 1.0 - smoothstep(th - 0.02, th + 0.006, d);
  // the arm ends lift off dry
  m *= mix(1.0, smoothstep(0.25, 0.55, rn(vec2(p.y * 40.0 + seed, ax * 3.0))), smoothstep(0.26, 0.42, ax));
  float halo = 1.0 - smoothstep(th, th + 0.09, d);
  float alpha = vDab.y;
${INK_OUT}
}`;

/** The destination ensō: one circular stroke, thick where the brush lands, thin and dry where it lifts. */
const ENSO_FRAG = `
uniform vec3 uInk, uWash;
uniform float uTime;
varying vec2 vUv;
${GROUND_DEPTH_GLSL}
${NOISE_GLSL}
void main() {
  if (behindScene()) discard;
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float u = fract((atan(p.y, p.x) + uTime * 0.35) / 6.28318); // 0 = where the brush lands
  float len = 0.86; // the gap
  float on = 1.0 - smoothstep(len - 0.04, len, u);
  float th = mix(0.15, 0.035, smoothstep(0.0, len, u)) * on;
  float rr = 0.74 + u * 0.05 + (rn(vec2(u * 7.0, 1.3)) - 0.5) * 0.03;
  float rough = (rn(vec2(u * 40.0, r * 6.0)) - 0.5) * 0.04;
  float dist = abs(r - rr) + rough;
  float m = 1.0 - smoothstep(th - 0.025, th + 0.01, dist);
  m *= mix(1.0, smoothstep(0.3, 0.6, rn(vec2(u * 3.0, (r - rr) * 60.0))), smoothstep(0.45, len, u));
  float halo = (1.0 - smoothstep(th + 0.02, th + 0.16, dist)) * on;
  float alpha = ROUTE_ALPHA;
${INK_OUT}
}`;

/** At a portal: two brush chevrons sliding forward (y) through it, fading in and out. */
const CHEVRON_FRAG = `
uniform vec3 uInk, uWash;
uniform float uTime;
varying vec2 vUv;
${GROUND_DEPTH_GLSL}
${NOISE_GLSL}
void main() {
  if (behindScene()) discard;
  vec2 p = vUv - 0.5; // x across, y forward
  float m = 0.0, halo = 0.0;
  for (int i = 0; i < 2; i++) {
    float ph = fract(uTime * 0.7 + float(i) * 0.5);
    float c = -0.22 + ph * 0.5;
    float ax = abs(p.x);
    if (ax > 0.36) continue;
    float th = mix(0.075, 0.025, ax / 0.36);
    float rough = (rn(vec2(ax * 30.0 + float(i) * 7.0, p.y * 8.0)) - 0.5) * 0.02;
    float d = abs(p.y - (c - ax * 0.75)) * 0.8 + rough;
    float fade = smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.65, 1.0, ph));
    m = max(m, (1.0 - smoothstep(th - 0.015, th + 0.005, d)) * fade);
    halo = max(halo, (1.0 - smoothstep(th, th + 0.08, d)) * fade);
  }
  float alpha = ROUTE_ALPHA;
${INK_OUT}
}`;

export class RoutePreview {
  private readonly dabGeo = new THREE.PlaneGeometry(1, 1);
  private readonly dabAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOTS * 2), 2);
  private readonly dabMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: DAB_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uInk: { value: INK }, uWash: { value: WASH }, ...groundDepthU },
  });
  private readonly dots: THREE.InstancedMesh;
  private readonly markGeo = new THREE.PlaneGeometry(1, 1);
  private readonly time = { value: 0 };
  private readonly ensoMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: ENSO_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uInk: { value: INK }, uWash: { value: WASH }, uTime: this.time, ...groundDepthU },
  });
  private readonly chevMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: CHEVRON_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uInk: { value: INK }, uWash: { value: WASH }, uTime: this.time, ...groundDepthU },
  });
  private readonly enso: THREE.Mesh;
  private readonly chevron: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(-Math.PI / 2, 0, 0, "YXZ");
  private spacing = 1.1;
  private shown = false;

  constructor() {
    this.dabGeo.setAttribute("aDab", this.dabAttr);
    this.dots = new THREE.InstancedMesh(this.dabGeo, this.dabMat, MAX_DOTS);
    this.enso = new THREE.Mesh(this.markGeo, this.ensoMat);
    this.chevron = new THREE.Mesh(this.markGeo, this.chevMat);
    this.enso.rotation.x = -Math.PI / 2;
    this.chevron.rotation.order = "YXZ";
    this.chevron.rotation.x = -Math.PI / 2;
    // overlay pass, under the target ring (-2) and the telegraphs (-1)
    this.dots.renderOrder = this.enso.renderOrder = this.chevron.renderOrder = -3;
    for (const o of [this.dots, this.enso, this.chevron]) { o.frustumCulled = false; o.visible = false; overlay.add(o); }
    this.dots.count = 0;
    onQuality((l) => { this.spacing = l === "low" ? 1.6 : l === "mid" ? 1.3 : 1.1; });
  }

  /** Dabs from (px, pz) toward (tx, tz); `portal`: chevrons there pointing on, else an ensō. No allocation. */
  update(px: number, pz: number, tx: number, tz: number, portal: boolean, time: number): void {
    const dx = tx - px, dz = tz - pz, len = Math.hypot(dx, dz);
    if (len < 0.5) { this.hide(); return; }
    const ux = dx / len, uz = dz / len;
    const heading = Math.atan2(ux, uz) + Math.PI; // laid flat, the plane's +y then points along travel
    const start = 1.2, end = Math.max(start, len - (portal ? 1.3 : 1.1));
    const crawl = time * 1.4;
    const drift = crawl % this.spacing; // dabs crawl toward the goal
    const first = Math.floor(crawl / this.spacing); // keeps each dab's seed while it crawls
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const arr = this.dabAttr.array as Float32Array;
    let n = 0;
    for (let d = start + drift, k = 0; d < end && n < MAX_DOTS; d += this.spacing, k++) {
      const seed = fractSin(k - first);
      // a hand-laid line: each dab leans and steps aside a little
      const side = (seed - 0.5) * 0.05, lean = (fractSin(k - first + 31.7) - 0.5) * 0.08;
      const x = px + ux * d - uz * side, z = pz + uz * d + ux * side;
      const cam = Math.hypot(x - cx, Y - cy, z - cz);
      const k2 = Math.min(1.9, Math.max(0.9, cam / 18)); // farther dabs grow so they don't vanish
      this.v.set(x, Y, z);
      this.e.set(-Math.PI / 2, heading + lean, 0);
      this.q.setFromEuler(this.e);
      this.s.set(0.8 * k2, 0.8 * k2, 1);
      this.m.compose(this.v, this.q, this.s);
      this.dots.setMatrixAt(n, this.m);
      // fade in at the feet, out toward the far end
      const fadeIn = Math.min(1, (d - start) / 1.2), fadeOut = Math.min(1, (end - d) / 2.5);
      arr[n * 2] = seed;
      arr[n * 2 + 1] = ROUTE_ALPHA * Math.max(0, Math.min(fadeIn, fadeOut));
      n++;
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.dabAttr.needsUpdate = true;
    this.dots.visible = n > 0;
    this.time.value = time;
    this.chevron.visible = portal;
    this.enso.visible = !portal;
    if (portal) {
      this.chevron.position.set(tx - ux * 0.4, Y, tz - uz * 0.4);
      this.chevron.rotation.y = heading;
      this.chevron.scale.set(2.6, 2.6, 1);
    } else {
      const pulse = 2.3 * (1 + Math.sin(time * 3) * 0.04);
      this.enso.position.set(tx, Y, tz);
      this.enso.scale.set(pulse, pulse, 1);
    }
    this.shown = true;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const o of [this.dots, this.enso, this.chevron]) o.visible = false;
  }

  dispose(): void {
    for (const o of [this.dots, this.enso, this.chevron]) overlay.remove(o);
    this.dots.dispose();
    this.dabGeo.dispose();
    this.markGeo.dispose();
    this.dabMat.dispose();
    this.ensoMat.dispose();
    this.chevMat.dispose();
  }
}

function fractSin(i: number): number {
  const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
  return s - Math.floor(s);
}
