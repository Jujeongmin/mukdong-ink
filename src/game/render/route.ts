// Route preview on the ground (auto-travel, or hovering 자동 진행): spaced ink dots from the player toward the
// next waypoint, an ink arrow at a portal when the target is in another zone, or a small ring at the
// destination when it's here. Drawn in the OVERLAY pass (after the ink post-process), so fog, haze, rain and
// the tone bands never wash it out; below the red telegraphs. Each mark is warm ink with a thin paper rim so it
// reads on dark and light ground alike. Dots are sized partly by screen space (they stay readable far off).
// One InstancedMesh (matrices updated in place) + four marker meshes; geometry and materials are created once
// (OWNED here, disposed in dispose()). Quality-aware spacing.

import * as THREE from "three";
import { camera, onQuality, overlay } from "./gfx";

const MAX_DOTS = 48;
const Y = 0.04;
const INK = new THREE.Color(0x1d1916);
const PAPER = new THREE.Color(0xf2e9d8);

/** A disc: ink core, thin paper rim, soft outer edge (uv distance from the centre). */
const DOT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;
const DOT_FRAG = `
uniform vec3 uInk;
uniform vec3 uPaper;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  vec3 col = d < 0.62 ? uInk : uPaper;
  float a = d < 0.62 ? 0.94 : 0.9 * (1.0 - smoothstep(0.84, 1.0, d));
  gl_FragColor = vec4(col, a);
}`;

export class RoutePreview {
  private readonly dotGeo = new THREE.CircleGeometry(0.3, 14);
  private readonly dotMat = new THREE.ShaderMaterial({
    vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uInk: { value: INK }, uPaper: { value: PAPER } },
  });
  private readonly dots = new THREE.InstancedMesh(this.dotGeo, this.dotMat, MAX_DOTS);
  private readonly inkMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false });
  private readonly rimMat = new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  private readonly arrowGeo: THREE.ShapeGeometry;
  private readonly arrow: THREE.Mesh;
  private readonly arrowRim: THREE.Mesh;
  private readonly ringGeo = new THREE.RingGeometry(0.76, 1.0, 32);
  private readonly ringRimGeo = new THREE.RingGeometry(0.68, 1.09, 32);
  private readonly ring: THREE.Mesh;
  private readonly ringRim: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private spacing = 1.1;
  private shown = false;

  constructor() {
    const a = new THREE.Shape();
    a.moveTo(0, 0.9); a.lineTo(0.55, -0.3); a.lineTo(0.18, -0.12); a.lineTo(0.18, -0.8); a.lineTo(-0.18, -0.8); a.lineTo(-0.18, -0.12); a.lineTo(-0.55, -0.3); a.closePath();
    this.arrowGeo = new THREE.ShapeGeometry(a);
    this.arrow = new THREE.Mesh(this.arrowGeo, this.inkMat);
    this.arrowRim = new THREE.Mesh(this.arrowGeo, this.rimMat);
    this.ring = new THREE.Mesh(this.ringGeo, this.inkMat);
    this.ringRim = new THREE.Mesh(this.ringRimGeo, this.rimMat);
    for (const o of [this.arrow, this.arrowRim, this.ring, this.ringRim]) o.rotation.x = -Math.PI / 2;
    // overlay pass, under the telegraphs (renderOrder -1): rims first, then ink
    this.arrowRim.renderOrder = this.ringRim.renderOrder = -4;
    this.dots.renderOrder = this.arrow.renderOrder = this.ring.renderOrder = -3;
    for (const o of [this.dots, this.arrowRim, this.arrow, this.ringRim, this.ring]) { o.frustumCulled = false; o.visible = false; overlay.add(o); }
    this.dots.count = 0;
    onQuality((l) => { this.spacing = l === "low" ? 1.8 : l === "mid" ? 1.35 : 1.1; });
  }

  /** Dots from (px, pz) toward (tx, tz); `portal`: an arrow there pointing on, else a ring. No allocation. */
  update(px: number, pz: number, tx: number, tz: number, portal: boolean, time: number): void {
    const dx = tx - px, dz = tz - pz, len = Math.hypot(dx, dz);
    if (len < 0.5) { this.hide(); return; }
    const ux = dx / len, uz = dz / len;
    const start = 1.4, end = Math.max(start, len - (portal ? 1.4 : 1.2));
    const drift = (time * 1.6) % this.spacing; // dots crawl toward the goal
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    let n = 0;
    for (let d = start + drift; d < end && n < MAX_DOTS; d += this.spacing) {
      const x = px + ux * d, z = pz + uz * d;
      // partly screen-sized: farther dots grow with camera distance so they don't vanish at the far end
      const cam = Math.hypot(x - cx, Y - cy, z - cz);
      const k = Math.min(2.2, Math.max(0.9, cam / 17)) * (0.8 + 0.2 * Math.max(0, 1 - d / 40));
      this.v.set(x, Y, z);
      this.s.set(k, k, k);
      this.m.compose(this.v, this.flat, this.s);
      this.dots.setMatrixAt(n++, this.m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.visible = n > 0;
    const pulse = 1 + Math.sin(time * (portal ? 5 : 4)) * 0.08;
    this.arrow.visible = this.arrowRim.visible = portal;
    this.ring.visible = this.ringRim.visible = !portal;
    if (portal) {
      const heading = Math.atan2(-ux, -uz);
      for (const o of [this.arrow, this.arrowRim]) { o.position.set(tx - ux * 0.6, Y, tz - uz * 0.6); o.rotation.z = heading; }
      this.arrow.scale.set(pulse, pulse, pulse);
      this.arrowRim.scale.set(pulse * 1.22, pulse * 1.22, pulse * 1.22);
    } else {
      for (const o of [this.ring, this.ringRim]) { o.position.set(tx, Y, tz); o.scale.set(pulse, pulse, pulse); }
    }
    this.shown = true;
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const o of [this.dots, this.arrow, this.arrowRim, this.ring, this.ringRim]) o.visible = false;
  }

  dispose(): void {
    for (const o of [this.dots, this.arrow, this.arrowRim, this.ring, this.ringRim]) overlay.remove(o);
    this.dots.dispose();
    this.dotGeo.dispose();
    this.arrowGeo.dispose();
    this.ringGeo.dispose();
    this.ringRimGeo.dispose();
    this.dotMat.dispose();
    this.inkMat.dispose();
    this.rimMat.dispose();
  }
}
